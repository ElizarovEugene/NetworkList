"""Periodic re-scanning — checks every few minutes for any network whose
auto-scan interval has elapsed and kicks off a scan for it, reusing the
exact same scan pipeline as a manually-started one."""
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.database import SessionLocal
from app.models import HostCheck, Network, ScanJob
from app.services.scanner import start_scan_async

# Tick at 1 minute so minute-granularity auto-scan intervals fire close to on time.
CHECK_INTERVAL_MINUTES = 1
CHECK_CLEANUP_INTERVAL_HOURS = 24

scheduler = BackgroundScheduler()


def _due(network: Network, now: datetime) -> bool:
    if not network.last_auto_scan_at:
        return True
    elapsed = now - network.last_auto_scan_at
    return elapsed >= timedelta(minutes=network.auto_scan_interval_minutes)


def check_and_run_due_scans():
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        for net in db.query(Network).filter_by(auto_scan_enabled=True).all():
            if not _due(net, now):
                continue
            already_running = (
                db.query(ScanJob)
                .filter(ScanJob.network_id == net.id, ScanJob.status.in_(["running", "pending"]))
                .first()
            )
            if already_running:
                continue
            scan_types = ["ping", "dns", "snmp", "ssh"]
            if net.auto_scan_nmap:
                scan_types.append("nmap")
            job = ScanJob(
                target=net.cidr,
                network_id=net.id,
                scan_types=",".join(scan_types),
                status="pending",
            )
            db.add(job)
            net.last_auto_scan_at = now
            db.commit()
            db.refresh(job)
            start_scan_async(job.id)
            print(f"[networklist] Auto-scan started for {net.cidr} (job #{job.id})")
    finally:
        db.close()


def cleanup_old_checks():
    # host_checks gets one row per host per scan phase — with auto-scan now
    # able to run every few minutes, this is the one table that grows
    # without bound if nothing ever trims it.
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=settings.host_check_retention_days)
        deleted = (
            db.query(HostCheck)
            .filter(HostCheck.checked_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        if deleted:
            print(f"[networklist] Cleaned up {deleted} check record(s) older than {settings.host_check_retention_days}d")
    finally:
        db.close()


def start_scheduler():
    scheduler.add_job(check_and_run_due_scans, "interval", minutes=CHECK_INTERVAL_MINUTES, id="auto_scan_check")
    scheduler.add_job(cleanup_old_checks, "interval", hours=CHECK_CLEANUP_INTERVAL_HOURS, id="check_cleanup")
    scheduler.start()
    cleanup_old_checks()


def stop_scheduler():
    scheduler.shutdown(wait=False)
