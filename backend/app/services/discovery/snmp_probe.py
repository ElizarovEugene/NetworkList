"""SNMP v2c probing — pysnmp 7.x async API wrapped for sync use."""
import asyncio
from dataclasses import dataclass
from typing import Optional

try:
    from pysnmp.hlapi.v3arch.asyncio import (
        get_cmd, SnmpEngine, CommunityData, UdpTransportTarget,
        ContextData, ObjectType, ObjectIdentity
    )
    PYSNMP_OK = True
except ImportError:
    PYSNMP_OK = False

from app.core.config import settings


@dataclass
class SNMPResult:
    ip: str
    success: bool
    sysname: Optional[str] = None
    sysdescr: Optional[str] = None
    syslocation: Optional[str] = None


def _clean(value: Optional[str]) -> Optional[str]:
    # pysnmp renders an empty/unset OctetString as the literal text "(none)"
    # rather than "" — treat that placeholder as no value.
    if value is None or value == "(none)":
        return None
    return value


async def _get_oid(engine, community, transport, oid: str) -> tuple[bool, Optional[str]]:
    """Returns (responded, value) — responded is True iff the device answered
    without error, regardless of whether the value itself is empty."""
    ei, es, _, vbs = await get_cmd(
        engine,
        CommunityData(community, mpModel=1),
        transport,
        ContextData(),
        ObjectType(ObjectIdentity(oid)),
    )
    if ei or es:
        return False, None
    return True, _clean(str(vbs[0][1])) if vbs else None


async def _probe_async(ip: str, community: str, timeout: int, retries: int) -> SNMPResult:
    engine = SnmpEngine()
    try:
        transport = await UdpTransportTarget.create(
            (ip, 161), timeout=timeout, retries=retries
        )
        responded, sysname = await _get_oid(engine, community, transport, "1.3.6.1.2.1.1.5.0")
        if not responded:
            return SNMPResult(ip=ip, success=False)

        _, sysdescr = await _get_oid(engine, community, transport, "1.3.6.1.2.1.1.1.0")
        _, syslocation = await _get_oid(engine, community, transport, "1.3.6.1.2.1.1.6.0")

        return SNMPResult(
            ip=ip, success=True,
            sysname=sysname,
            sysdescr=sysdescr,
            syslocation=syslocation,
        )
    finally:
        engine.close_dispatcher()


def probe(ip: str, community: Optional[str] = None) -> SNMPResult:
    if not PYSNMP_OK:
        return SNMPResult(ip=ip, success=False)
    community = community or settings.snmp_community
    try:
        return asyncio.run(_probe_async(ip, community, settings.snmp_timeout, settings.snmp_retries))
    except Exception:
        return SNMPResult(ip=ip, success=False)
