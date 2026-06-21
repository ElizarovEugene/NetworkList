from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.database import Base, UTCDateTime


class ScanJob(Base):
    __tablename__ = "scan_jobs"

    id = Column(Integer, primary_key=True, index=True)
    network_id = Column(Integer, ForeignKey("networks.id"), nullable=True)
    target = Column(String(128), nullable=False)    # CIDR or single IP
    scan_types = Column(String(128), nullable=False)  # comma-separated: ping,dns,nmap,snmp,ssh
    status = Column(String(16), default="pending")  # pending/running/done/failed
    progress = Column(Integer, default=0)           # 0–100
    total_hosts = Column(Integer, default=0)
    found_hosts = Column(Integer, default=0)
    # Counts of notable changes detected during this scan (see ScanJobChange)
    # — denormalized onto the job so the list view can show a badge without
    # an extra query per row.
    new_hosts_count = Column(Integer, default=0, nullable=False)
    down_hosts_count = Column(Integer, default=0, nullable=False)
    changed_hosts_count = Column(Integer, default=0, nullable=False)
    error = Column(Text, nullable=True)
    started_at = Column(UTCDateTime, nullable=True)
    finished_at = Column(UTCDateTime, nullable=True)
    created_at = Column(UTCDateTime, server_default=func.now())

    network = relationship("Network", back_populates="scan_jobs")


class ScanJobChange(Base):
    """One row per notable change a scan detected for a host — a new host
    appearing, a previously-up host going down, or its MAC address
    changing. Drives the "what changed" summary on the scan job."""
    __tablename__ = "scan_job_changes"

    id = Column(Integer, primary_key=True, index=True)
    scan_job_id = Column(Integer, ForeignKey("scan_jobs.id"), nullable=False, index=True)
    host_id = Column(Integer, ForeignKey("hosts.id"), nullable=False)
    change_type = Column(String(16), nullable=False)  # new/down/mac_changed
    detail = Column(Text, nullable=True)
    created_at = Column(UTCDateTime, server_default=func.now())
