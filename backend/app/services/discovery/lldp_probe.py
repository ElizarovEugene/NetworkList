"""LLDP/CDP neighbor discovery via SNMP — auto-populates network-map links
between directly-connected devices instead of requiring them to be drawn
by hand every time.

Matching strategy: LLDP reports the neighbor's chassis ID, which for
switches/routers/hypervisor NICs is almost always its base/bridge MAC
address (chassis ID subtype 4) — matched against a known Host.mac_address.
CDP (Cisco-proprietary, included for completeness) reports the neighbor's
management IP address instead, matched against Host.ip_address.
"""
import asyncio
from dataclasses import dataclass
from typing import Optional

try:
    from pysnmp.hlapi.v3arch.asyncio import (
        walk_cmd, SnmpEngine, CommunityData, UdpTransportTarget, ContextData, ObjectType, ObjectIdentity,
    )
    PYSNMP_OK = True
except ImportError:
    PYSNMP_OK = False

from app.core.config import settings

LLDP_REM_BASE = "1.0.8802.1.1.2.1.4.1.1"      # lldpRemTable
LLDP_REM_COLUMNS = {"chassis_subtype": 4, "chassis_id": 5, "port_id": 7, "sys_name": 9}
LLDP_LOC_PORT_DESC = "1.0.8802.1.1.2.1.3.7.1.4"  # lldpLocPortDesc
CDP_CACHE_BASE = "1.3.6.1.4.1.9.9.23.1.2.1.1"  # cdpCacheTable
CDP_CACHE_COLUMNS = {"address": 4, "device_id": 6, "device_port": 7}
IF_DESCR_BASE = "1.3.6.1.2.1.2.2.1.2"          # ifDescr


@dataclass
class NeighborInfo:
    protocol: str                       # 'lldp' | 'cdp'
    local_port: Optional[str]
    remote_port: Optional[str]
    remote_sysname: Optional[str]
    remote_mac: Optional[str] = None    # LLDP match key
    remote_ip: Optional[str] = None     # CDP match key


async def _walk_column(engine, community: str, transport, oid: str) -> dict[str, object]:
    """Walks one MIB table column, returns {row_index_suffix: raw_value}."""
    out: dict[str, object] = {}
    try:
        async for ei, es, _, vbs in walk_cmd(
            engine, CommunityData(community, mpModel=1), transport, ContextData(),
            ObjectType(ObjectIdentity(oid)), lexicographicMode=False, maxRows=200,
        ):
            if ei or es:
                break
            for got_oid, val in vbs:
                oid_str = str(got_oid)
                if not oid_str.startswith(oid + "."):
                    break
                out[oid_str[len(oid) + 1:]] = val
    except Exception:
        pass
    return out


async def _walk_table(engine, community: str, transport, table_oid: str,
                       columns: dict[str, int]) -> dict[str, dict[str, object]]:
    """Single-pass walk of an entire MIB table, bucketing every column
    instance by its row index so all columns for one conceptual row come
    from the same continuous snapshot.

    Walking column-by-column (one separate GETNEXT sequence per column)
    can silently drop rows: LLDP's row index embeds a timestamp
    (lldpRemTimeMark) that shifts when an entry refreshes, so a row visited
    by one column's walk can carry a different index by the time the next
    column's walk reaches it — same neighbor, mismatched key, lost link.
    """
    col_by_num = {num: name for name, num in columns.items()}
    rows: dict[str, dict[str, object]] = {}
    try:
        async for ei, es, _, vbs in walk_cmd(
            engine, CommunityData(community, mpModel=1), transport, ContextData(),
            ObjectType(ObjectIdentity(table_oid)), lexicographicMode=False, maxRows=2000,
        ):
            if ei or es:
                break
            for got_oid, val in vbs:
                oid_str = str(got_oid)
                if not oid_str.startswith(table_oid + "."):
                    break
                col_str, _, row_idx = oid_str[len(table_oid) + 1:].partition(".")
                col_name = col_by_num.get(int(col_str)) if col_str.isdigit() else None
                if col_name is None:
                    continue
                rows.setdefault(row_idx, {})[col_name] = val
    except Exception:
        pass
    return rows


def _as_text(val) -> Optional[str]:
    if val is None:
        return None
    raw = val.asOctets() if hasattr(val, "asOctets") else None
    if raw is None:
        return None
    text = raw.decode("utf-8", errors="replace").strip()
    return text or None


def _as_mac(val) -> Optional[str]:
    """Chassis ID for subtype 4 (macAddress). Devices observed in the wild
    send it either as 6 raw binary bytes or as an already-formatted
    "aa:bb:cc:.." ASCII string — handle both, normalized to upper-case."""
    if val is None or not hasattr(val, "asOctets"):
        return None
    raw = val.asOctets()
    if len(raw) == 6:
        return ":".join(f"{b:02X}" for b in raw)
    text = raw.decode("ascii", errors="replace").strip()
    return text.upper() if ":" in text else None


def _as_ipv4(val) -> Optional[str]:
    if val is None or not hasattr(val, "asOctets"):
        return None
    raw = val.asOctets()
    return ".".join(str(b) for b in raw) if len(raw) == 4 else None


async def _probe_lldp_async(ip: str, community: str, timeout: int, retries: int) -> list[NeighborInfo]:
    engine = SnmpEngine()
    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=timeout, retries=retries)
        rows = await _walk_table(engine, community, transport, LLDP_REM_BASE, LLDP_REM_COLUMNS)
        if not rows:
            return []
        loc_port_desc = await _walk_column(engine, community, transport, LLDP_LOC_PORT_DESC)

        neighbors = []
        for idx, cols in rows.items():
            # Row index is "<lldpRemTimeMark>.<lldpRemLocalPortNum>.<lldpRemIndex>".
            parts = idx.split(".")
            if len(parts) != 3:
                continue
            local_port_num = parts[1]
            subtype = cols.get("chassis_subtype")
            mac = _as_mac(cols.get("chassis_id")) if subtype is not None and int(subtype) == 4 else None
            neighbors.append(NeighborInfo(
                protocol="lldp",
                local_port=_as_text(loc_port_desc.get(local_port_num)) or local_port_num,
                remote_port=_as_text(cols.get("port_id")),
                remote_sysname=_as_text(cols.get("sys_name")),
                remote_mac=mac,
            ))
        return neighbors
    except Exception:
        return []
    finally:
        engine.close_dispatcher()


async def _probe_cdp_async(ip: str, community: str, timeout: int, retries: int) -> list[NeighborInfo]:
    engine = SnmpEngine()
    try:
        transport = await UdpTransportTarget.create((ip, 161), timeout=timeout, retries=retries)
        rows = await _walk_table(engine, community, transport, CDP_CACHE_BASE, CDP_CACHE_COLUMNS)
        if not rows:
            return []
        if_descr = await _walk_column(engine, community, transport, IF_DESCR_BASE)

        neighbors = []
        for idx, cols in rows.items():
            # Row index is "<ifIndex>.<cdpCacheDeviceIndex>".
            if_index = idx.split(".")[0]
            neighbors.append(NeighborInfo(
                protocol="cdp",
                local_port=_as_text(if_descr.get(if_index)) or if_index,
                remote_port=_as_text(cols.get("device_port")),
                remote_sysname=_as_text(cols.get("device_id")),
                remote_ip=_as_ipv4(cols.get("address")),
            ))
        return neighbors
    except Exception:
        return []
    finally:
        engine.close_dispatcher()


async def _probe_neighbors_async(ip: str, community: str, timeout: int, retries: int) -> list[NeighborInfo]:
    lldp = await _probe_lldp_async(ip, community, timeout, retries)
    cdp = await _probe_cdp_async(ip, community, timeout, retries)
    return lldp + cdp


def probe_neighbors(ip: str, community: Optional[str] = None) -> list[NeighborInfo]:
    if not PYSNMP_OK:
        return []
    community = community or settings.snmp_community
    try:
        return asyncio.run(_probe_neighbors_async(ip, community, settings.snmp_timeout, settings.snmp_retries))
    except Exception:
        return []
