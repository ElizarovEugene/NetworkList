"""Liveness checks: ICMP ping plus an ARP-based fallback sweep.

ICMP alone misses any host that simply doesn't answer ping — Windows
firewalls block ICMP echo by default while still happily answering ARP
and TCP. Relying on ping only would silently drop such hosts from every
later scan phase (they'd never make it into "targets"), so a batch
`nmap -sn` sweep backs up the ICMP result. Off the local segment (e.g.
the backend running in its own docker network) ARP isn't available
either, so `-sn`'s default off-segment probe (TCP SYN to 443, ACK to 80)
still misses a host that only has something like RDP open — a few extra
`-PS`/`-PA` probes on the most common management/remote-access ports
catch those too, without blowing up sweep time by probing the full
~40-port service list against every host that didn't answer ICMP.
"""
import subprocess
import re
from dataclasses import dataclass
from typing import List, Optional

from app.core.config import settings

# Small, deliberately short list for the liveness sweep — just enough to
# catch the common "ICMP blocked but the box is up" cases (RDP/SSH/SMB/
# WinRM boxes, web admin UIs) without turning a /24 liveness check into a
# 40-port-per-host scan.
_LIVENESS_PORTS = "22,80,443,445,3389,5985,8080,8443"


@dataclass
class PingResult:
    ip: str
    is_up: bool
    rtt_ms: Optional[float] = None


def _ping_one(ip: str, timeout: int = 2) -> PingResult:
    try:
        result = subprocess.run(
            ["ping", "-c", "1", "-W", str(timeout), str(ip)],
            capture_output=True, text=True, timeout=timeout + 1
        )
        if result.returncode == 0:
            m = re.search(r"time=(\d+\.?\d*)\s*ms", result.stdout)
            rtt = float(m.group(1)) if m else None
            return PingResult(ip=str(ip), is_up=True, rtt_ms=rtt)
    except Exception:
        pass
    return PingResult(ip=str(ip), is_up=False)


def ping_host(ip: str) -> PingResult:
    return _ping_one(ip, settings.scan_timeout)


def arp_up_hosts(ips: List[str]) -> set:
    """Batch ARP/ICMP/TCP discovery via nmap -sn — catches hosts that block
    ICMP echo but are genuinely live (e.g. Windows boxes with a firewall),
    which a plain ICMP ping would otherwise miss entirely."""
    if not ips:
        return set()
    try:
        import nmap
        nm = nmap.PortScanner()
        nm.scan(hosts=" ".join(ips), arguments=f"-sn -PS{_LIVENESS_PORTS} -PA{_LIVENESS_PORTS}", sudo=True)
        return {ip for ip in ips if ip in nm.all_hosts() and nm[ip].state() == "up"}
    except Exception:
        return set()
