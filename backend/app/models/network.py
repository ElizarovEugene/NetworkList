from sqlalchemy import Column, Integer, String, Text, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base, UTCDateTime


class Network(Base):
    __tablename__ = "networks"

    id = Column(Integer, primary_key=True, index=True)
    cidr = Column(String(43), unique=True, nullable=False, index=True)  # e.g. 192.168.1.0/24
    name = Column(String(128), nullable=False)
    description = Column(Text, nullable=True)
    vlan_id = Column(Integer, nullable=True)
    site = Column(String(64), nullable=True)
    gateway = Column(String(45), nullable=True)
    dns_servers = Column(String(256), nullable=True)   # comma-separated

    # Periodic re-scan — the scheduler checks every network on a fixed tick
    # and starts a scan for any one of these whose interval has elapsed.
    auto_scan_enabled = Column(Boolean, default=False, nullable=False)
    auto_scan_interval_minutes = Column(Integer, default=1440, nullable=False)
    auto_scan_nmap = Column(Boolean, default=True, nullable=False)
    last_auto_scan_at = Column(UTCDateTime, nullable=True)

    created_at = Column(UTCDateTime, server_default=func.now())
    updated_at = Column(UTCDateTime, onupdate=func.now())

    hosts = relationship("Host", back_populates="network", cascade="all, delete-orphan")
    scan_jobs = relationship("ScanJob", back_populates="network", cascade="all, delete-orphan")
