from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey, Float
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base, UTCDateTime, EncryptedString


class Host(Base):
    __tablename__ = "hosts"

    id = Column(Integer, primary_key=True, index=True)
    ip_address = Column(String(45), unique=True, nullable=True, index=True)  # NULL for VMs/containers with no routable IP
    network_id = Column(Integer, ForeignKey("networks.id"), nullable=True)

    # Virtualization — this host may be a VM/container discovered by SSH-probing a hypervisor host
    parent_host_id = Column(Integer, ForeignKey("hosts.id"), nullable=True)
    virt_type = Column(String(16), nullable=True)    # 'vm' | 'container'
    virt_id = Column(String(128), nullable=True)     # platform-native id (container id, VM name/vmid) — stable upsert key
    virt_ports = Column(String(256), nullable=True)  # published host-side ports, e.g. "8123, 443"

    # Identification
    hostname = Column(String(256), nullable=True)
    hostname_manual = Column(Boolean, default=False)  # True = user-set, scanner must not overwrite
    ptr_record = Column(String(256), nullable=True)
    mac_address = Column(String(17), nullable=True)
    vendor = Column(String(128), nullable=True)
    device_type = Column(String(32), nullable=True)   # router/switch/server/workstation/printer/unknown
    os_name = Column(String(128), nullable=True)       # auto-detected (nmap fingerprint)
    os_version = Column(String(64), nullable=True)
    os_accuracy = Column(Integer, nullable=True)
    os_platform = Column(String(64), nullable=True)    # manual hint for how to connect in: linux/docker, windows/hyperv, etc.

    # SNMP info — community is encrypted at rest (it's a shared secret, same
    # threat model as the SSH password below)
    snmp_community = Column(EncryptedString(512), nullable=True)
    snmp_sysname = Column(String(256), nullable=True)
    snmp_sysdescr = Column(Text, nullable=True)
    snmp_location = Column(String(256), nullable=True)

    # SSH credentials (per-host, manual) — used only for virtualization
    # probing. Password is encrypted at rest so a leaked/stolen .db file
    # doesn't hand out plaintext credentials.
    ssh_username = Column(String(64), nullable=True)
    ssh_password = Column(EncryptedString(512), nullable=True)

    # Network map — persisted position after a manual drag (null = auto-place)
    map_x = Column(Float, nullable=True)
    map_y = Column(Float, nullable=True)
    map_hidden = Column(Boolean, default=False)             # exclude this host from the map entirely
    map_hide_virt_children = Column(Boolean, default=False)  # exclude its VMs/containers from the map

    # Status
    is_up = Column(Boolean, nullable=True)
    ping_rtt_ms = Column(Float, nullable=True)
    is_managed = Column(Boolean, default=False)   # manually added
    is_gateway = Column(Boolean, default=False)
    notes = Column(Text, nullable=True)

    first_seen = Column(UTCDateTime, server_default=func.now())
    last_seen = Column(UTCDateTime, nullable=True)
    updated_at = Column(UTCDateTime, onupdate=func.now())

    network = relationship("Network", back_populates="hosts")
    parent_host = relationship("Host", remote_side=[id], backref="guests")
    checks = relationship("HostCheck", back_populates="host", cascade="all, delete-orphan")
    ports = relationship("HostPort", back_populates="host", cascade="all, delete-orphan",
                         order_by="HostPort.port_number")

    links_from = relationship("Link", foreign_keys="Link.source_id", back_populates="source",
                              cascade="all, delete-orphan")
    links_to = relationship("Link", foreign_keys="Link.target_id", back_populates="target",
                            cascade="all, delete-orphan")


class HostPort(Base):
    __tablename__ = "host_ports"

    id = Column(Integer, primary_key=True, index=True)
    host_id = Column(Integer, ForeignKey("hosts.id"), nullable=False)
    port_number = Column(Integer, nullable=False)
    protocol = Column(String(4), default="tcp")
    state = Column(String(16), default="open")
    service = Column(String(64), nullable=True)
    version = Column(String(256), nullable=True)

    host = relationship("Host", back_populates="ports")


class HostCheck(Base):
    __tablename__ = "host_checks"

    id = Column(Integer, primary_key=True, index=True)
    host_id = Column(Integer, ForeignKey("hosts.id"), nullable=False)
    scan_job_id = Column(Integer, ForeignKey("scan_jobs.id"), nullable=True)
    check_type = Column(String(16), nullable=False)   # ping/dns/nmap/snmp/virt
    is_success = Column(Boolean, nullable=False)
    detail = Column(Text, nullable=True)
    checked_at = Column(UTCDateTime, server_default=func.now())

    host = relationship("Host", back_populates="checks")
