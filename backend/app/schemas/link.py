from pydantic import BaseModel
from typing import Optional


class LinkCreate(BaseModel):
    source_id: int
    target_id: int
    source_iface: Optional[str] = None
    target_iface: Optional[str] = None


class LinkRead(BaseModel):
    id: int
    source_id: int
    target_id: int
    source_iface: Optional[str] = None
    target_iface: Optional[str] = None
    link_type: str

    model_config = {"from_attributes": True}
