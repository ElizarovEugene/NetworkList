from sqlalchemy import Column, Integer, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


class Link(Base):
    """Physical or logical link between two hosts (discovered via SNMP CDP/LLDP or manual)."""
    __tablename__ = "links"
    __table_args__ = (UniqueConstraint("source_id", "target_id", name="uq_link"),)

    id = Column(Integer, primary_key=True, index=True)
    source_id = Column(Integer, ForeignKey("hosts.id"), nullable=False)
    target_id = Column(Integer, ForeignKey("hosts.id"), nullable=False)
    source_iface = Column(String(64), nullable=True)
    target_iface = Column(String(64), nullable=True)
    link_type = Column(String(16), default="inferred")  # inferred/lldp/cdp/manual

    source = relationship("Host", foreign_keys=[source_id], back_populates="links_from")
    target = relationship("Host", foreign_keys=[target_id], back_populates="links_to")
