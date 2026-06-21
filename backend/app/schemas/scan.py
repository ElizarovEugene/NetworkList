from pydantic import BaseModel, field_validator
from typing import Optional, List
from datetime import datetime
import ipaddress


VALID_SCAN_TYPES = {"ping", "dns", "nmap", "snmp", "ssh"}


class ScanJobCreate(BaseModel):
    target: str
    network_id: Optional[int] = None
    scan_types: List[str] = ["ping", "dns", "nmap", "snmp", "ssh"]

    @field_validator("target")
    @classmethod
    def validate_target(cls, v: str) -> str:
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError:
            ipaddress.ip_address(v)
        return v

    @field_validator("scan_types")
    @classmethod
    def validate_types(cls, v: List[str]) -> List[str]:
        invalid = set(v) - VALID_SCAN_TYPES
        if invalid:
            raise ValueError(f"Unknown scan types: {invalid}")
        return v


class ScanJobRead(BaseModel):
    id: int
    target: str
    network_id: Optional[int] = None
    scan_types: str
    status: str
    progress: int
    total_hosts: int
    found_hosts: int
    new_hosts_count: int = 0
    down_hosts_count: int = 0
    changed_hosts_count: int = 0
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ScanJobChangeRead(BaseModel):
    id: int
    host_id: int
    host_ip: Optional[str] = None
    host_label: Optional[str] = None
    change_type: str
    detail: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
