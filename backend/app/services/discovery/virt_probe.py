"""Probe a hypervisor/container host over SSH and enumerate its VMs/containers.

Uses paramiko directly (raw exec_command) rather than netmiko, since this is
free-form command-and-parse against each platform's own CLI, not a
"show version"-style network-device session.
"""
import csv
import io
import re
from dataclasses import dataclass, field
from typing import List, Optional

import paramiko

from app.core.config import settings


@dataclass
class GuestInfo:
    virt_id: str          # platform-native id — stable across rescans
    name: str
    guest_type: str        # 'vm' | 'container' | 'host' (an ESXi host managed by vCenter)
    status: Optional[str] = None
    ip_address: Optional[str] = None
    # vCenter can report several addresses for one VM (real LAN-facing
    # vNIC plus a secondary adapter — VPN client, container bridge inside
    # the guest, etc). ip_address is just ip_addresses[0] when there's more
    # than one; the caller (scanner._upsert_guest) picks whichever of these
    # actually falls inside a configured Network instead of trusting
    # whatever vCenter happened to report first.
    ip_addresses: List[str] = field(default_factory=list)
    ports: Optional[str] = None    # published host-side ports, formatted "8123, 443"


def _is_usable_ipv4(ip: Optional[str]) -> bool:
    if not ip or ":" in ip:  # skip IPv6 — the rest of the pipeline is IPv4-only
        return False
    return not ip.startswith("169.254.")  # APIPA — not a real assigned address


def _public_ports(raw: str) -> Optional[str]:
    """Host-side ports published on 0.0.0.0 (i.e. reachable from the LAN) —
    not ports merely EXPOSEd in the image, and not 127.0.0.1-only bindings."""
    if not raw:
        return None
    published = re.findall(r"0\.0\.0\.0:(\d+)->\d+/(tcp|udp)", raw)
    if not published:
        return None
    seen: List[str] = []
    for p, proto in published:
        label = p if proto == "tcp" else f"{p}/{proto}"
        if label not in seen:
            seen.append(label)
    return ", ".join(seen)


def _exec(client: paramiko.SSHClient, command: str, timeout: int = 15) -> str:
    _, stdout, _ = client.exec_command(command, timeout=timeout)
    return stdout.read().decode(errors="replace")


def _probe_docker(client: paramiko.SSHClient) -> List[GuestInfo]:
    out = _exec(client, "docker ps -a --format '{{.ID}}|{{.Names}}|{{.Status}}|{{.Ports}}'")
    guests = []
    for line in out.strip().splitlines():
        parts = line.split("|")
        if len(parts) != 4:
            continue
        cid, name, status, raw_ports = parts
        ports = _public_ports(raw_ports)
        guests.append(GuestInfo(virt_id=cid, name=name, guest_type="container", status=status, ports=ports))
    return guests


def _probe_hyperv(client: paramiko.SSHClient) -> List[GuestInfo]:
    out = _exec(
        client,
        'powershell -NoProfile -Command "Get-VM | Select-Object Id,Name,State | ConvertTo-Csv -NoTypeInformation"',
    )
    guests = []
    rows = list(csv.reader(io.StringIO(out)))
    if len(rows) < 2:
        return guests
    header = [h.strip().lower() for h in rows[0]]
    for row in rows[1:]:
        if len(row) != len(header):
            continue
        rec = dict(zip(header, row))
        vm_id = rec.get("id", "").strip()
        if not vm_id:
            continue
        guests.append(GuestInfo(virt_id=vm_id, name=rec.get("name", "").strip(), guest_type="vm",
                                 status=rec.get("state", "").strip()))
    return guests


def _probe_esxi(client: paramiko.SSHClient) -> List[GuestInfo]:
    out = _exec(client, "vim-cmd vmsvc/getallvms")
    guests = []
    for line in out.strip().splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2:
            continue
        vmid, name = parts[0], parts[1]
        if not vmid.isdigit():
            continue
        status = _exec(client, f"vim-cmd vmsvc/power.getstate {vmid}").strip().splitlines()[-1:]
        guests.append(GuestInfo(virt_id=vmid, name=name, guest_type="vm",
                                 status=status[0] if status else None))
    return guests


def _probe_proxmox(client: paramiko.SSHClient) -> List[GuestInfo]:
    guests = []
    out = _exec(client, "qm list")
    for line in out.strip().splitlines()[1:]:
        parts = line.split()
        if len(parts) < 3 or not parts[0].isdigit():
            continue
        vmid, name, status = parts[0], parts[1], parts[2]
        guests.append(GuestInfo(virt_id=f"qemu-{vmid}", name=name, guest_type="vm", status=status))

    out = _exec(client, "pct list")
    for line in out.strip().splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2 or not parts[0].isdigit():
            continue
        vmid, status = parts[0], parts[1]
        name = parts[2] if len(parts) > 2 else vmid
        guests.append(GuestInfo(virt_id=f"lxc-{vmid}", name=name, guest_type="container", status=status))
    return guests


def _probe_vcenter(ip: str, username: str, password: str) -> List[GuestInfo]:
    """vCenter manages a cluster of ESXi hosts via the vSphere API (HTTPS),
    not a plain shell — pyVmomi instead of paramiko."""
    import ssl
    from pyVim.connect import SmartConnect, Disconnect
    from pyVmomi import vim

    context = ssl._create_unverified_context() if settings.vcenter_insecure_tls else ssl.create_default_context()
    si = SmartConnect(host=ip, user=username, pwd=password, port=443, sslContext=context)
    guests: List[GuestInfo] = []
    try:
        content = si.RetrieveContent()

        host_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.HostSystem], True)
        try:
            for h in host_view.view:
                conn_state = str(h.runtime.connectionState)
                ips = [
                    nic.spec.ip.ipAddress
                    for nic in (h.config.network.vnic if h.config and h.config.network else [])
                    if nic.spec.ip and _is_usable_ipv4(nic.spec.ip.ipAddress)
                ]
                guests.append(GuestInfo(
                    virt_id=f"esxi-{h._moId}", name=h.name, guest_type="host",
                    status=conn_state, ip_address=(ips[0] if ips else None), ip_addresses=ips,
                ))
        finally:
            host_view.Destroy()

        vm_view = content.viewManager.CreateContainerView(content.rootFolder, [vim.VirtualMachine], True)
        try:
            for vm in vm_view.view:
                ips: List[str] = []
                for nic in (vm.guest.net if vm.guest and vm.guest.net else []):
                    if not nic.ipConfig:
                        continue
                    for addr in nic.ipConfig.ipAddress:
                        if _is_usable_ipv4(addr.ipAddress) and addr.ipAddress not in ips:
                            ips.append(addr.ipAddress)
                primary = vm.guest.ipAddress if vm.guest else None
                if _is_usable_ipv4(primary) and primary not in ips:
                    ips.insert(0, primary)
                guests.append(GuestInfo(
                    virt_id=f"vm-{vm._moId}", name=vm.name, guest_type="vm",
                    status=str(vm.runtime.powerState), ip_address=(ips[0] if ips else None), ip_addresses=ips,
                ))
        finally:
            vm_view.Destroy()
    finally:
        Disconnect(si)
    return guests


_SSH_PROBES = {
    "Linux (Docker host)": _probe_docker,
    "Windows (Hyper-V host)": _probe_hyperv,
    "VMware ESXi": _probe_esxi,
    "Proxmox VE": _probe_proxmox,
}


def probe_guests(ip: str, username: str, password: str, platform: Optional[str], port: int = 22) -> List[GuestInfo]:
    if platform == "VMware vCenter":
        try:
            return _probe_vcenter(ip, username, password)
        except Exception:
            return []

    probe_fn = _SSH_PROBES.get(platform or "")
    if probe_fn is None:
        return []

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            ip, port=port, username=username, password=password,
            timeout=settings.ssh_timeout, banner_timeout=settings.ssh_timeout,
            auth_timeout=settings.ssh_timeout, look_for_keys=False, allow_agent=False,
        )
        return probe_fn(client)
    except Exception:
        return []
    finally:
        client.close()
