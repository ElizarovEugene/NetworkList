"""Nmap port + OS scan, with TCP socket fallback when nmap binary is absent."""
import json
import re
import socket
import subprocess
import concurrent.futures
from dataclasses import dataclass, field
from typing import Optional, List

from app.core.config import settings

_local_ip_macs: Optional[dict[str, str]] = None


def _local_mac_for_ip(ip: str) -> Optional[str]:
    """nmap can't ARP-discover the MAC of the machine it's running on (no
    request actually goes out on the wire for your own address), so it's
    always None for self-scans. Read it straight from the local interface
    instead — cached for the process lifetime since it won't change."""
    global _local_ip_macs
    if _local_ip_macs is None:
        _local_ip_macs = {}
        try:
            out = subprocess.run(["ip", "-j", "addr"], capture_output=True, text=True, timeout=3)
            for iface in json.loads(out.stdout):
                mac = iface.get("address")
                if not mac:
                    continue
                for a in iface.get("addr_info", []):
                    if a.get("family") == "inet" and a.get("local"):
                        _local_ip_macs[a["local"]] = mac.upper()
        except Exception:
            pass
    return _local_ip_macs.get(ip)


def _vendor_for_mac(mac: str) -> Optional[str]:
    try:
        from mac_vendor_lookup import MacLookup
        return MacLookup().lookup(mac)
    except Exception:
        return None


# nmap's bundled OUI database and mac_vendor_lookup's fallback database
# don't always agree on how a company name is formatted for the very same
# OUI (e.g. "VMware, Inc." vs "VMware", "Apple, Inc." vs "Apple") — whichever
# of the two happens to have an entry for a given MAC wins, so the same
# company shows up differently depending on which lookup served it. Strip
# the corporate suffix so both converge on one display form.
_CORP_SUFFIX_RE = re.compile(r",?\s+inc\.?$", re.I)


def _normalize_vendor(vendor: Optional[str]) -> Optional[str]:
    if not vendor:
        return vendor
    return _CORP_SUFFIX_RE.sub("", vendor).strip()

# Service-version banners are grabbed directly from the live service (e.g. a
# SOAP/HTTP response), so they're far more trustworthy than nmap's -O OS
# fingerprint, which is a statistical guess against TCP/IP stack quirks and
# can misfire (different NIC/driver timing can match the wrong DB entry even
# at 90%+ "accuracy"). When a banner clearly names a known platform, prefer
# it unconditionally — these banners are specific enough (and version-bearing)
# that they're never a downgrade.
_BANNER_OS_OVERRIDES = [
    (re.compile(r"vmware esxi", re.I), "VMware ESXi"),
    (re.compile(r"proxmox", re.I), "Proxmox VE"),
]

# Weaker signals — they confirm "this is Windows" but carry no version info,
# so they should only fill in a *missing* os_name, never clobber a more
# specific guess -O already produced (e.g. "Windows 10 1709 - 21H2").
_BANNER_OS_FALLBACKS = [
    (re.compile(r"microsoft terminal services|ms-wbt-server", re.I), "Microsoft Windows"),
    (re.compile(r"microsoft httpapi", re.I), "Microsoft Windows"),
]


def _scan_ports_for(patterns, ports: "List[PortInfo]"):
    for p in ports:
        if p.state != "open" or not p.version:
            continue
        for pattern, canonical in patterns:
            if pattern.search(p.version):
                m = re.search(r"\d+(?:\.\d+)+", p.version)
                return canonical, (m.group(0) if m else None)
    return None


def _os_from_banners(ports: "List[PortInfo]", existing_os_name: Optional[str] = None):
    strong = _scan_ports_for(_BANNER_OS_OVERRIDES, ports)
    if strong:
        return strong
    if not existing_os_name:
        return _scan_ports_for(_BANNER_OS_FALLBACKS, ports)
    return None


# nmap's -O fingerprint DB has entries like "QNAP NAS device (Linux 4.14)" or
# "Cisco Adaptive Security Appliance (ASA 8.4)" — many embedded/appliance
# devices share near-identical TCP/IP stacks (and, post network_mode: host,
# the scan also reaches hosts a hop away through routing, which distorts the
# fingerprint further), so the *brand* part of the match is often just
# whichever sample device nmap's authors happened to fingerprint, not the
# actual hardware — even at 95%+ self-reported "accuracy" (that number is
# nmap's confidence it matched *some* DB entry well, not that the entry is
# the right one). The MAC-vendor lookup (from the NIC's real registered OUI)
# is a much more trustworthy signal — if it names a different company, drop
# the brand guess and keep only the kernel-version part nmap was actually
# confident about.
# Company names that make network/security-appliance gear — kept separate
# from the NAS-brand list below because this same list also doubles as the
# "is this networking equipment at all" signal in guess_device_type(). Real
# deployments run all sorts of brands this lab doesn't have an example
# of — extend freely; a missing entry doesn't break anything, it just means
# that brand's devices fall back to the generic OS/port heuristics instead
# of being recognized as network gear outright.
_NETWORK_VENDOR_TOKENS = [
    "cisco", "juniper", "mikrotik", "routerboard", "ubiquiti", "tp-link",
    "fortinet", "keenetic", "procurve", "huawei", "zyxel", "d-link",
    "aruba", "grandstream", "ruijie", "h3c", "tenda", "totolink", "draytek",
    "extreme networks", "brocade", "arista", "sonicwall", "watchguard",
    "checkpoint", "palo alto",
]

_VENDOR_BRAND_TOKENS = [
    "qnap", "synology", "netgear", "buffalo", "asustor", "drobo", "western digital",
    *_NETWORK_VENDOR_TOKENS,
]

# These name a firmware *project*, not a company, so they can legitimately
# run on all sorts of hardware — checking them against the MAC vendor would
# misfire on a genuine OpenWrt box bought from some third-party brand. They
# only become a red flag when the MAC vendor says the NIC belongs to a
# hypervisor: no real router firmware runs on a VMware/Hyper-V/QEMU virtual
# NIC, so a match here can only be fingerprint noise.
_FIRMWARE_NAME_TOKENS = ["openwrt", "routeros", "pfsense", "edgeos"]
_VIRT_VENDOR_MARKERS = ["vmware", "microsoft hyper-v", "innotek", "qemu", "kvm", "xensource", "parallels"]


def _sanitize_os_name(os_name: Optional[str], vendor: Optional[str]) -> Optional[str]:
    if not os_name:
        return os_name
    name_lower = os_name.lower()
    vendor_lower = (vendor or "").lower()

    def _kernel_remainder():
        m = re.search(r"\((linux[^)]*)\)", os_name, re.I)
        return m.group(1) if m else None

    for brand in _VENDOR_BRAND_TOKENS:
        if brand in name_lower and brand.split()[0] not in vendor_lower:
            return _kernel_remainder()

    if any(v in vendor_lower for v in _VIRT_VENDOR_MARKERS):
        for fw in _FIRMWARE_NAME_TOKENS:
            if fw in name_lower:
                return _kernel_remainder()

    return os_name

# Well-known service names for common ports
KNOWN_SERVICES: dict[int, str] = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
    67: "dhcp", 80: "http", 110: "pop3", 111: "rpc", 123: "ntp",
    143: "imap", 161: "snmp", 389: "ldap", 443: "https",
    445: "smb", 514: "syslog", 587: "smtp", 631: "ipp",
    636: "ldaps", 873: "rsync", 902: "vmware", 1433: "mssql",
    1521: "oracle", 2181: "zookeeper", 2375: "docker", 2376: "docker-tls",
    3000: "http-alt", 3306: "mysql", 3389: "rdp", 5432: "postgres",
    5672: "amqp", 5900: "vnc", 6379: "redis", 6443: "k8s-api",
    8080: "http-alt", 8443: "https-alt", 8888: "http-alt",
    9090: "http-alt", 9200: "elasticsearch", 10250: "kubelet",
    27017: "mongodb", 5985: "winrm", 5986: "winrm-https",
}

TOP_PORTS = sorted(KNOWN_SERVICES.keys())


@dataclass
class PortInfo:
    port: int
    protocol: str
    state: str
    service: Optional[str] = None
    version: Optional[str] = None


@dataclass
class NmapResult:
    ip: str
    is_up: bool
    mac_address: Optional[str] = None
    vendor: Optional[str] = None
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    os_accuracy: Optional[int] = None
    # True whenever nmap actually produced an OS guess this run, even if
    # _sanitize_os_name then distrusted and cleared it back to None — lets
    # the caller tell "no new info, keep the old value" apart from "this
    # run's match was deliberately rejected, the old value may now be
    # stale" (a brand mismatch detected this time wasn't necessarily
    # detected on a previous, now-stored guess).
    os_detected: bool = False
    ports: List[PortInfo] = field(default_factory=list)


def _tcp_check(ip: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((ip, port), timeout=timeout) as s:
            return True
    except Exception:
        return False


def _scan_tcp_fallback(ip: str) -> NmapResult:
    result = NmapResult(ip=ip, is_up=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=40) as pool:
        futures = {pool.submit(_tcp_check, ip, p): p for p in TOP_PORTS}
        for future in concurrent.futures.as_completed(futures):
            port = futures[future]
            if future.result():
                result.ports.append(PortInfo(
                    port=port,
                    protocol="tcp",
                    state="open",
                    service=KNOWN_SERVICES.get(port),
                ))
    result.ports.sort(key=lambda p: p.port)
    return result


def _parse_nmap_host(ip: str, host) -> NmapResult:
    """Build an NmapResult from one python-nmap host record — shared by the
    single-host and batch scan paths so they can never drift out of sync."""
    result = NmapResult(ip=ip, is_up=host.state() == "up")
    if "mac" in host.get("addresses", {}):
        result.mac_address = host["addresses"]["mac"]
        result.vendor = _normalize_vendor(host.get("vendor", {}).get(result.mac_address))
    if not result.mac_address:
        local_mac = _local_mac_for_ip(ip)
        if local_mac:
            result.mac_address = local_mac
    if result.mac_address and not result.vendor:
        # nmap's bundled OUI database is a dated snapshot and has real
        # gaps — mac_vendor_lookup's is more complete, so fall back to it.
        result.vendor = _normalize_vendor(_vendor_for_mac(result.mac_address))
    osmatch = host.get("osmatch", [])
    if osmatch:
        result.os_detected = True
        best = osmatch[0]
        result.os_name = _sanitize_os_name(best.get("name"), result.vendor)
        result.os_accuracy = int(best.get("accuracy", 0))
        osclass = best.get("osclass", [{}])
        if osclass:
            result.os_version = osclass[0].get("osgen")
    for proto in host.all_protocols():
        for port_num in host[proto].keys():
            p = host[proto][port_num]
            svc_ver = " ".join(filter(None, [
                p.get("product", ""), p.get("version", ""), p.get("extrainfo", "")
            ])).strip()
            result.ports.append(PortInfo(
                port=port_num, protocol=proto, state=p["state"],
                service=p.get("name") or None, version=svc_ver or None,
            ))
    banner_os = _os_from_banners(result.ports, result.os_name)
    if banner_os:
        result.os_detected = True
        result.os_name, banner_version = banner_os
        result.os_version = banner_version or result.os_version
        result.os_accuracy = 100
    return result


def scan_hosts_batch(ips: list[str], arguments: Optional[str] = None) -> dict[str, NmapResult]:
    """Scan multiple hosts in a single nmap invocation — much faster than per-host calls."""
    args = arguments or settings.nmap_args
    try:
        import nmap
        nm = nmap.PortScanner()
        nm.scan(hosts=" ".join(ips), arguments=args, sudo=True)
        return {
            ip: _parse_nmap_host(ip, nm[ip]) if ip in nm.all_hosts() else NmapResult(ip=ip, is_up=False)
            for ip in ips
        }
    except Exception:
        # Fallback: parallel TCP connect
        with concurrent.futures.ThreadPoolExecutor(max_workers=settings.max_scan_workers) as pool:
            return {ip: r for ip, r in zip(
                ips, pool.map(lambda ip: _scan_tcp_fallback(ip), ips)
            )}


def guess_device_type(result: NmapResult) -> Optional[str]:
    if not result.is_up:
        return None
    os = (result.os_name or "").lower()
    vendor = (result.vendor or "").lower()
    open_ports = {p.port for p in result.ports if p.state == "open"}
    # Router/switch firmware is usually embedded Linux, so its os_name often
    # just says "Linux x.y" — the real giveaway is the NIC vendor (Keenetic,
    # Routerboard.com, Ubiquiti, ...) or a service banner ("MikroTik RouterOS
    # sshd", "OpenWrt"). Check those — and check them *before* the generic
    # "linux" -> server fallback — or every consumer router gets misclassified.
    banners = " ".join(filter(None, (p.version for p in result.ports))).lower()
    haystack = f"{os} {vendor} {banners}"

    if any(x in os for x in ("darwin", "mac os", "macos", "iphone", "ipad", "tvos", "apple tv")):
        return "workstation"
    if any(x in haystack for x in (
        *_NETWORK_VENDOR_TOKENS, *_FIRMWARE_NAME_TOKENS,
        "edgerouter", "switch", "catalyst",
    )):
        return "network"
    if any(x in os for x in ("windows", "microsoft")):
        # An open RDP port doesn't distinguish server from client — both
        # commonly run it (servers for remote admin, desktops for remote
        # desktop). The OS string itself is the reliable signal: Windows
        # Server editions say "Server" right in the name.
        if "server" in os:
            return "server"
        return "workstation" if 3389 in open_ports else "server"
    if any(x in os for x in ("linux", "ubuntu", "debian", "centos", "freebsd")):
        return "server"
    if any(x in haystack for x in ("printer", "hp jetdirect")):
        return "printer"
    # Port-based heuristics
    if {23, 161} & open_ports and {80, 443} & open_ports:
        return "network"
    if open_ports & {22, 80, 443, 8080, 8443}:
        return "server"
    if open_ports & {3389, 5900}:
        return "workstation"
    return "unknown"
