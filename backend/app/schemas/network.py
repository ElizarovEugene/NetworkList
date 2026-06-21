from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
import ipaddress


class NetworkBase(BaseModel):
    cidr: str
    name: str
    description: Optional[str] = None
    vlan_id: Optional[int] = None
    site: Optional[str] = None
    gateway: Optional[str] = None
    dns_servers: Optional[str] = None
    auto_scan_enabled: bool = False
    auto_scan_interval_minutes: int = 1440
    auto_scan_nmap: bool = True

    @field_validator("cidr")
    @classmethod
    def validate_cidr(cls, v: str) -> str:
        ipaddress.ip_network(v, strict=False)
        return v


class NetworkCreate(NetworkBase):
    pass


class NetworkUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    vlan_id: Optional[int] = None
    site: Optional[str] = None
    gateway: Optional[str] = None
    dns_servers: Optional[str] = None
    auto_scan_enabled: Optional[bool] = None
    auto_scan_interval_minutes: Optional[int] = None
    auto_scan_nmap: Optional[bool] = None


class NetworkRead(NetworkBase):
    id: int
    created_at: datetime
    total_hosts: Optional[int] = 0
    up_hosts: Optional[int] = 0
    last_auto_scan_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class NetworkStats(BaseModel):
    total: int
    allocated: int
    free: int
    up: int
    down: int
