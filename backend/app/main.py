from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base, SessionLocal
from app.models import *  # noqa: ensure all models are imported before create_all
from app.models import ScanJob, User
from app.core.config import settings
from app.security import hash_password, get_current_user
from app.scheduler import start_scheduler, stop_scheduler
from app.api import networks, hosts, scan, topology, links, auth, users


def _migrate_auto_scan_interval_to_minutes():
    # auto_scan_interval_hours -> auto_scan_interval_minutes, switching the
    # auto-scan interval from hour to minute/hour/day granularity. No
    # migration framework here, so do it by hand and keep it idempotent.
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(networks)")}
        if "auto_scan_interval_hours" not in cols:
            return
        if "auto_scan_interval_minutes" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE networks ADD COLUMN auto_scan_interval_minutes INTEGER NOT NULL DEFAULT 1440"
            )
        conn.exec_driver_sql(
            "UPDATE networks SET auto_scan_interval_minutes = auto_scan_interval_hours * 60"
        )
        conn.exec_driver_sql("ALTER TABLE networks DROP COLUMN auto_scan_interval_hours")
        conn.commit()


def _migrate_scan_job_change_counts():
    # New denormalized counters on scan_jobs for the "what changed" summary
    # — added after the table already existed in deployed databases.
    with engine.connect() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(scan_jobs)")}
        for col in ("new_hosts_count", "down_hosts_count", "changed_hosts_count"):
            if col not in cols:
                conn.exec_driver_sql(f"ALTER TABLE scan_jobs ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0")
        conn.commit()


_migrate_auto_scan_interval_to_minutes()
Base.metadata.create_all(bind=engine)
_migrate_scan_job_change_counts()


def _fail_orphaned_scan_jobs():
    # Any job still "running"/"pending" at startup belongs to a process that
    # died (crash or reload) — its background thread is gone, so it can
    # never progress further.
    db = SessionLocal()
    try:
        orphaned = db.query(ScanJob).filter(ScanJob.status.in_(["running", "pending"])).all()
        for job in orphaned:
            job.status = "failed"
            job.error = "Interrupted by backend restart"
            job.finished_at = datetime.now(timezone.utc)
        db.commit()
    finally:
        db.close()


def _seed_admin():
    # First boot, no users yet — create one so there's a way to log in at all.
    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            admin = User(
                username=settings.admin_username,
                password_hash=hash_password(settings.admin_password),
                language=settings.admin_language,
            )
            db.add(admin)
            db.commit()
            print(f"[networklist] Created initial user: {settings.admin_username}")
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _fail_orphaned_scan_jobs()
    _seed_admin()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="NetworkList", version="0.1.0", redirect_slashes=False, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(networks.router, dependencies=[Depends(get_current_user)])
app.include_router(hosts.router, dependencies=[Depends(get_current_user)])
app.include_router(scan.router, dependencies=[Depends(get_current_user)])
app.include_router(topology.router, dependencies=[Depends(get_current_user)])
app.include_router(links.router, dependencies=[Depends(get_current_user)])


@app.get("/health")
def health():
    return {"status": "ok"}
