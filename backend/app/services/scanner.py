"""Orchestrates discovery for a ScanJob: ping → dns → nmap → snmp → ssh (virtualization)."""
import ipaddress
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Host, HostPort, HostCheck, Link, ScanJob, ScanJobChange, Network
from app.services.discovery import ping, dns_lookup, nmap_scan, snmp_probe, lldp_probe, virt_probe
from app.core.config import settings


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _upsert_host(db: Session, ip: str, network_id: Optional[int]) -> Host:
    host = db.query(Host).filter_by(ip_address=ip).first()
    if not host:
        host = Host(ip_address=ip, network_id=network_id)
        db.add(host)
        db.flush()
    return host


def _add_check(db: Session, host_id: int, check_type: str, success: bool,
               detail: Optional[str] = None, scan_job_id: Optional[int] = None):
    db.add(HostCheck(host_id=host_id, check_type=check_type,
                     is_success=success, detail=detail, scan_job_id=scan_job_id))


def _find_link(db: Session, a_id: int, b_id: int) -> Optional[Link]:
    return db.query(Link).filter(
        or_(
            and_(Link.source_id == a_id, Link.target_id == b_id),
            and_(Link.source_id == b_id, Link.target_id == a_id),
        )
    ).first()


def _upsert_neighbor_links(db: Session, local_host: Host, neighbors: list,
                            seen_pairs: set[frozenset]) -> None:
    """Creates/refreshes Link rows for LLDP/CDP neighbors matched to a known
    Host. Never touches a manually-drawn link — auto-discovery only adds to
    or refreshes its own kind."""
    for n in neighbors:
        remote = None
        if n.remote_mac:
            remote = db.query(Host).filter_by(mac_address=n.remote_mac).first()
        elif n.remote_ip:
            remote = db.query(Host).filter_by(ip_address=n.remote_ip).first()
        if not remote or remote.id == local_host.id:
            continue

        seen_pairs.add(frozenset((local_host.id, remote.id)))
        existing = _find_link(db, local_host.id, remote.id)
        if existing:
            if existing.link_type == "manual":
                continue
            existing.link_type = n.protocol
            if existing.source_id == local_host.id:
                existing.source_iface, existing.target_iface = n.local_port, n.remote_port
            else:
                existing.source_iface, existing.target_iface = n.remote_port, n.local_port
        else:
            db.add(Link(
                source_id=local_host.id, target_id=remote.id,
                source_iface=n.local_port, target_iface=n.remote_port,
                link_type=n.protocol,
            ))


def _guest_is_up(status: Optional[str]) -> Optional[bool]:
    if not status:
        return None
    s = status.lower()
    # Check the "down" list first — "disconnected" contains "connected", so
    # checking the "up" list first would misclassify it.
    if any(k in s for k in ("exited", "stopped", "off", "down", "disconnected", "notresponding", "suspended")):
        return False
    if any(k in s for k in ("up", "running", "started", "poweredon", "connected")):
        return True
    return None


def _sync_hostnames_by_mac(db: Session) -> None:
    """A device with two interfaces (e.g. a VM's real LAN-facing vNIC plus a
    second adapter vCenter reports under a different IP) ends up as two
    separate Host rows, one per IP — there's no merging by MAC. Only
    whichever row a name happened to get discovered on (DNS PTR, SNMP,
    vCenter's VM inventory, ...) shows it; the other sits nameless even
    though it's the same machine. Once any row for a MAC has a name, copy
    it onto the others that don't — never onto one with its own name
    (manual or auto-detected differs from this MAC's other IP for a
    reason) and never overwriting a manually-locked name."""
    groups: dict[str, list[Host]] = defaultdict(list)
    for h in db.query(Host).filter(Host.mac_address.isnot(None)).all():
        groups[h.mac_address].append(h)

    for group in groups.values():
        if len(group) < 2:
            continue
        named = [h for h in group if h.hostname]
        if not named:
            continue
        manual = [h for h in named if h.hostname_manual]
        source = manual[0] if manual else max(named, key=lambda h: h.last_seen or h.first_seen)
        for h in group:
            if not h.hostname and not h.hostname_manual:
                h.hostname = source.hostname


def _best_guest_ip(db: Session, guest) -> Optional[str]:
    """vCenter (and, in principle, any future multi-homed-guest source) can
    report more than one address for the same VM — guest.ip_address is just
    whichever one the hypervisor API happened to list first, which isn't
    necessarily the LAN address this scan actually runs against (e.g. a
    VPN client or container-bridge address inside the guest can sort
    first). Prefer whichever candidate falls inside a Network we actually
    have configured; fall back to the hypervisor's own pick if none do."""
    candidates = list(dict.fromkeys(getattr(guest, "ip_addresses", None) or
                                     ([guest.ip_address] if guest.ip_address else [])))
    if len(candidates) <= 1:
        return candidates[0] if candidates else None
    networks = db.query(Network).all()
    for ip in candidates:
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            continue
        for net in networks:
            try:
                if addr in ipaddress.ip_network(net.cidr, strict=False):
                    return ip
            except ValueError:
                continue
    return candidates[0]


def _upsert_guest(db: Session, parent_id: int, network_id: Optional[int], guest) -> Host:
    guest_ip = _best_guest_ip(db, guest)
    host = None
    if guest_ip:
        host = db.query(Host).filter_by(ip_address=guest_ip).first()

    # vCenter's own VM inventory includes the vCenter appliance itself —
    # which is the exact host we're probing. It genuinely is a VM, just not
    # its own parent: record the virt_type/virt_id but skip parent_host_id
    # (self-reference would create a loop and confuse the map's BFS depth).
    is_self = bool(host and host.id == parent_id)

    if not is_self:
        # A row may already exist for this exact virt_id under its old
        # identity (e.g. the VM used to report a different IP, or none at
        # all). If that's a *different* row than the one we just matched by
        # IP, it's a stale duplicate left behind by the IP change — fold it
        # away instead of ending up with two rows for the same VM.
        by_virt_id = db.query(Host).filter_by(parent_host_id=parent_id, virt_id=guest.virt_id).first()
        if by_virt_id and host and by_virt_id.id != host.id:
            db.delete(by_virt_id)
            db.flush()
        elif by_virt_id and not host:
            host = by_virt_id

    if not host:
        host = Host(network_id=network_id)
        db.add(host)
        db.flush()

    if not is_self:
        host.parent_host_id = parent_id
    host.virt_type = guest.guest_type
    host.virt_id = guest.virt_id
    host.virt_ports = getattr(guest, "ports", None)
    if guest_ip:
        host.ip_address = guest_ip
    if not host.network_id:
        host.network_id = network_id
    # The VM/host name reported by the hypervisor is a fallback label, not
    # an identification — don't let it clobber a name we already got from a
    # real network source (DNS PTR or SNMP sysName).
    if not host.hostname_manual and not host.ptr_record and not host.snmp_sysname:
        host.hostname = guest.name
    if not host.device_type:
        host.device_type = "server"
    is_up = _guest_is_up(guest.status)
    if is_up is not None:
        host.is_up = is_up
    return host


def run_scan(job_id: int):
    """Entry point called in background thread."""
    db = SessionLocal()
    try:
        job = db.get(ScanJob, job_id)
        if not job:
            return
        job.status = "running"
        job.started_at = _now()
        db.commit()

        scan_types = set(job.scan_types.split(","))
        # ping is mandatory — every other phase depends on a fresh liveness
        # sweep, or "targets" silently falls back to the whole CIDR. dns/snmp
        # are cheap, and ssh (virtualization probing) self-skips any host
        # without its own creds + platform set — so all four always run.
        # nmap (port/OS scan) is the only phase slow enough to make optional.
        if scan_types:
            scan_types |= {"ping", "dns", "snmp", "ssh"}
            job.scan_types = ",".join(sorted(scan_types))
        target = job.target
        network_id = job.network_id

        # Determine list of IPs to scan
        try:
            net = ipaddress.ip_network(target, strict=False)
            ips = [str(h) for h in net.hosts()]
        except ValueError:
            ips = [target]

        job.total_hosts = len(ips)
        db.commit()

        # Snapshot pre-scan state for the IPs we're about to touch — diffing
        # against this after each phase is what drives the "what changed"
        # summary (new hosts, hosts that went down, MAC swaps), without
        # needing a full change-history table for every field.
        existing_before = {
            h.ip_address: {"is_up": h.is_up, "mac_address": h.mac_address}
            for h in db.query(Host).filter(Host.ip_address.in_(ips)).all()
        }
        changes: list[tuple[int, str, Optional[str]]] = []

        processed = 0
        found = 0

        # — PHASE 1: Liveness sweep (ICMP + ARP/nmap fallback) —
        ping_up: set[str] = set()
        if "ping" in scan_types and ips:
            icmp_results: dict[str, ping.PingResult] = {}
            workers = min(settings.max_scan_workers, len(ips))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(ping.ping_host, ip): ip for ip in ips}
                for future in as_completed(futures):
                    pr = future.result()
                    icmp_results[pr.ip] = pr
                    processed += 1
                    job.progress = int(processed / len(ips) * 20)
                    db.commit()

            # Anything ICMP missed gets a second chance via ARP/TCP (nmap -sn)
            # — catches hosts whose firewall just blocks ping.
            icmp_down = [ip for ip, pr in icmp_results.items() if not pr.is_up]
            arp_up = ping.arp_up_hosts(icmp_down)
            job.progress = 30
            db.commit()

            for ip, pr in icmp_results.items():
                is_up = pr.is_up or ip in arp_up
                if is_up:
                    ping_up.add(ip)
                    is_new = ip not in existing_before
                    host = _upsert_host(db, ip, network_id)
                    if is_new:
                        changes.append((host.id, "new", None))
                    host.is_up = True
                    host.ping_rtt_ms = pr.rtt_ms
                    host.last_seen = _now()
                    detail = f"RTT {pr.rtt_ms:.1f}ms" if pr.rtt_ms else ("ok" if pr.is_up else "ARP/TCP only — ICMP blocked")
                    _add_check(db, host.id, "ping", True, detail, scan_job_id=job_id)
                    db.commit()
                    found += 1
                else:
                    host = db.query(Host).filter_by(ip_address=ip).first()
                    if host:
                        before = existing_before.get(ip)
                        if before and before["is_up"] is True:
                            changes.append((host.id, "down", None))
                        host.is_up = False
                        _add_check(db, host.id, "ping", False, scan_job_id=job_id)
                        db.commit()
        else:
            # No ping — scan all
            ping_up = set(ips)

        job.found_hosts = found
        db.commit()

        targets = list(ping_up) if ping_up else ips

        # — PHASE 2: DNS PTR — reverse lookups run in parallel (like ping);
        # each one blocks up to its 3s resolver timeout on no-PTR hosts, so
        # doing them one at a time made this phase the dominant cost on a
        # /24 with sparse PTR coverage.
        if "dns" in scan_types and targets:
            workers = min(settings.max_scan_workers, len(targets))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                dns_results = dict(zip(targets, pool.map(dns_lookup.reverse_lookup, targets)))

            for ip in targets:
                dr = dns_results[ip]
                host = _upsert_host(db, ip, network_id)
                if dr.ptr_record:
                    host.ptr_record = dr.ptr_record
                    if not host.hostname_manual:
                        host.hostname = dr.hostname
                _add_check(db, host.id, "dns", bool(dr.ptr_record), dr.ptr_record, scan_job_id=job_id)
                db.commit()

            job.progress = 40
            db.commit()

        # — PHASE 3: Nmap (batch — all live hosts in one call) —
        if "nmap" in scan_types and targets:
            job.progress = 41
            db.commit()
            nmap_results = nmap_scan.scan_hosts_batch(targets)
            for idx, (ip, nr) in enumerate(nmap_results.items()):
                if not nr.is_up:
                    # Don't create a placeholder row for an address nmap
                    # simply found nothing at — only update one we already
                    # know about (e.g. mark a previously-up host as down).
                    host = db.query(Host).filter_by(ip_address=ip).first()
                    if not host:
                        continue
                else:
                    host = _upsert_host(db, ip, network_id)
                host.is_up = nr.is_up
                if nr.mac_address:
                    before_mac = existing_before.get(ip, {}).get("mac_address")
                    if before_mac and before_mac != nr.mac_address:
                        changes.append((host.id, "mac_changed", f"{before_mac} → {nr.mac_address}"))
                    host.mac_address = nr.mac_address
                if nr.vendor:
                    host.vendor = nr.vendor
                if nr.os_detected:
                    # nr.os_name can legitimately be None here — the
                    # sanitizer rejected this run's guess as contradicting
                    # the MAC vendor — and that's still real new info: it
                    # means a previously stored (possibly wrong) os_name
                    # should be cleared too, not just left untouched.
                    host.os_name = nr.os_name
                    host.os_version = nr.os_version
                    host.os_accuracy = nr.os_accuracy
                if not host.is_managed:
                    host.device_type = nmap_scan.guess_device_type(nr)

                db.query(HostPort).filter_by(host_id=host.id).delete()
                for p in nr.ports:
                    db.add(HostPort(
                        host_id=host.id,
                        port_number=p.port,
                        protocol=p.protocol,
                        state=p.state,
                        service=p.service,
                        version=p.version,
                    ))

                _add_check(db, host.id, "nmap", nr.is_up,
                           f"OS: {nr.os_name}" if nr.os_name else None, scan_job_id=job_id)
                db.commit()

                job.progress = 41 + int((idx + 1) / len(nmap_results) * 29)
                db.commit()

        # — PHASE 4: SNMP — per-host community if one was ever set (manually
        # or by a previous successful probe), else the hardcoded default.
        # The probes themselves run in parallel: most home-network devices
        # don't speak SNMP at all, so doing this one host at a time meant
        # paying the full 2-4s timeout+retry on nearly every host in turn.
        # Devices that do answer SNMP also get an LLDP/CDP neighbor walk in
        # the same round trip — that's what auto-populates the network map's
        # switch/router links instead of requiring them drawn by hand.
        if "snmp" in scan_types and targets:
            communities = {}
            for ip in targets:
                existing = db.query(Host).filter_by(ip_address=ip).first()
                communities[ip] = (existing.snmp_community if existing else None) or settings.snmp_community

            def _probe_snmp_and_neighbors(ip: str):
                sr = snmp_probe.probe(ip, communities[ip])
                neighbors = lldp_probe.probe_neighbors(ip, communities[ip]) if sr.success else []
                return sr, neighbors

            workers = min(settings.max_scan_workers, len(targets))
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {pool.submit(_probe_snmp_and_neighbors, ip): ip for ip in targets}
                snmp_results = {}
                neighbor_results = {}
                for f in as_completed(futures):
                    ip = futures[f]
                    snmp_results[ip], neighbor_results[ip] = f.result()

            seen_link_pairs: set[frozenset] = set()
            probed_host_ids: set[int] = set()
            for idx, ip in enumerate(targets):
                sr = snmp_results[ip]
                community = communities[ip]
                host = _upsert_host(db, ip, network_id)
                if sr.success:
                    host.snmp_community = community
                    host.snmp_sysname = sr.sysname
                    host.snmp_sysdescr = sr.sysdescr
                    host.snmp_location = sr.syslocation
                    if not host.hostname_manual and not host.ptr_record and sr.sysname:
                        host.hostname = sr.sysname
                    probed_host_ids.add(host.id)
                    _upsert_neighbor_links(db, host, neighbor_results[ip], seen_link_pairs)
                _add_check(db, host.id, "snmp", sr.success,
                           f"{sr.sysname}: {sr.sysdescr[:80]}" if sr.success and sr.sysdescr else None,
                           scan_job_id=job_id)
                db.commit()

                job.progress = 70 + int((idx + 1) / len(targets) * 20)
                db.commit()

            # Drop auto-discovered links that weren't reconfirmed this scan
            # (cable moved/unplugged) — scoped to hosts actually SNMP-probed
            # this round, so an unrelated single-host scan can't wipe links
            # involving devices outside its target list.
            if probed_host_ids:
                stale = (
                    db.query(Link)
                    .filter(Link.link_type.in_(["lldp", "cdp"]))
                    .filter(or_(Link.source_id.in_(probed_host_ids), Link.target_id.in_(probed_host_ids)))
                    .all()
                )
                for link in stale:
                    if frozenset((link.source_id, link.target_id)) not in seen_link_pairs:
                        db.delete(link)
                db.commit()

        # — PHASE 5: Virtualization — enumerate VMs/containers on hosts that
        # have their own SSH credentials (set per-host, no global fallback)
        # plus a known hypervisor platform.
        if "ssh" in scan_types:
            job.progress = 95
            db.commit()

            virt_hosts = (
                db.query(Host)
                .filter(Host.ip_address.in_(targets))
                .filter(Host.ssh_username.isnot(None))
                .filter(Host.os_platform.isnot(None))
                .all()
            )
            for host in virt_hosts:
                guests = virt_probe.probe_guests(
                    host.ip_address, host.ssh_username, host.ssh_password or "",
                    host.os_platform,
                )
                seen_virt_ids = set()
                for guest in guests:
                    try:
                        _upsert_guest(db, host.id, host.network_id, guest)
                        db.commit()
                        seen_virt_ids.add(guest.virt_id)
                    except Exception:
                        db.rollback()

                # Drop guest records that no longer qualify (removed, or no
                # longer publicly published) so the list doesn't accumulate
                # stale entries. Only do this when the probe actually
                # returned something — an empty list more often means the
                # SSH connection failed than that all guests vanished, and
                # we don't want a transient failure to wipe known guests.
                if seen_virt_ids:
                    stale = (
                        db.query(Host)
                        .filter_by(parent_host_id=host.id)
                        .filter(Host.id != host.id)  # never delete the probed host itself
                        .filter(~Host.virt_id.in_(seen_virt_ids))
                        .all()
                    )
                    for s in stale:
                        db.delete(s)
                    db.commit()

                _add_check(db, host.id, "virt", bool(guests),
                           f"{len(guests)} guest(s) found" if guests else None, scan_job_id=job_id)
                db.commit()

        for host_id, change_type, detail in changes:
            db.add(ScanJobChange(scan_job_id=job_id, host_id=host_id, change_type=change_type, detail=detail))
        job.new_hosts_count = sum(1 for _, t, _ in changes if t == "new")
        job.down_hosts_count = sum(1 for _, t, _ in changes if t == "down")
        job.changed_hosts_count = sum(1 for _, t, _ in changes if t == "mac_changed")

        _sync_hostnames_by_mac(db)
        db.commit()

        job.status = "done"
        job.progress = 100
        job.finished_at = _now()
        db.commit()

    except Exception as e:
        try:
            # The exception may have come from a failed commit, which leaves
            # the session unable to do anything else until it's rolled back.
            db.rollback()
            job.status = "failed"
            job.error = str(e)[:512]
            job.finished_at = _now()
            db.commit()
        except Exception:
            pass
    finally:
        db.close()


def start_scan_async(job_id: int):
    t = threading.Thread(target=run_scan, args=(job_id,), daemon=True)
    t.start()
