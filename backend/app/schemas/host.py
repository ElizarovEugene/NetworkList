from pydantic import BaseModel, Field, computed_field
from typing import Optional, List
from datetime import datetime


class HostPortRead(BaseModel):
    port_number: int
    protocol: str
    state: str
    service: Optional[str] = None
    version: Optional[str] = None

    model_config = {"from_attributes": True}


class HostBase(BaseModel):
    ip_address: Optional[str] = None  # NULL for VMs/containers with no routable IP
    hostname: Optional[str] = None
    mac_address: Optional[str] = None
    device_type: Optional[str] = None
    notes: Optional[str] = None
    is_managed: Optional[bool] = False
    is_gateway: Optional[bool] = False


class HostCreate(HostBase):
    network_id: Optional[int] = None


class HostUpdate(BaseModel):
    hostname: Optional[str] = None
    hostname_manual: Optional[bool] = None
    device_type: Optional[str] = None
    os_platform: Optional[str] = None
    notes: Optional[str] = None
    is_managed: Optional[bool] = None
    is_gateway: Optional[bool] = None
    snmp_community: Optional[str] = None
    ssh_username: Optional[str] = None
    ssh_password: Optional[str] = None
    map_x: Optional[float] = None
    map_y: Optional[float] = None
    map_hidden: Optional[bool] = None
    map_hide_virt_children: Optional[bool] = None


class HostRead(HostBase):
    id: int
    network_id: Optional[int] = None
    hostname_manual: bool = False
    parent_host_id: Optional[int] = None
    virt_type: Optional[str] = None
    virt_id: Optional[str] = None
    virt_ports: Optional[str] = None
    ptr_record: Optional[str] = None
    vendor: Optional[str] = None
    os_name: Optional[str] = None
    os_version: Optional[str] = None
    os_accuracy: Optional[int] = None
    os_platform: Optional[str] = None
    snmp_community: Optional[str] = None
    snmp_sysname: Optional[str] = None
    snmp_sysdescr: Optional[str] = None
    snmp_location: Optional[str] = None
    ssh_username: Optional[str] = None
    ssh_password: Optional[str] = Field(default=None, exclude=True)
    is_up: Optional[bool] = None
    ping_rtt_ms: Optional[float] = None
    map_x: Optional[float] = None
    map_y: Optional[float] = None
    map_hidden: bool = False
    map_hide_virt_children: bool = False
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    ports: List[HostPortRead] = []

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def has_ssh_password(self) -> bool:
        return bool(self.ssh_password)


class HostCheckRead(BaseModel):
    id: int
    check_type: str
    is_success: bool
    detail: Optional[str] = None
    checked_at: datetime

    model_config = {"from_attributes": True}


class ScanJobCheckRead(BaseModel):
    id: int
    host_id: int
    host_ip: Optional[str] = None
    host_label: Optional[str] = None
    check_type: str
    is_success: bool
    detail: Optional[str] = None
    checked_at: datetime

    model_config = {"from_attributes": True}
