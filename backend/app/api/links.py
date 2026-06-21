from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from app.database import get_db
from app.models import Host, Link
from app.schemas.link import LinkCreate, LinkRead

router = APIRouter(prefix="/links", tags=["links"])


@router.post("/", response_model=LinkRead, status_code=201)
def create_link(data: LinkCreate, db: Session = Depends(get_db)):
    if data.source_id == data.target_id:
        raise HTTPException(400, "A device can't be linked to itself")
    if not db.get(Host, data.source_id) or not db.get(Host, data.target_id):
        raise HTTPException(404, "Host not found")

    existing = db.query(Link).filter(
        or_(
            and_(Link.source_id == data.source_id, Link.target_id == data.target_id),
            and_(Link.source_id == data.target_id, Link.target_id == data.source_id),
        )
    ).first()
    if existing:
        return existing

    link = Link(
        source_id=data.source_id, target_id=data.target_id,
        source_iface=data.source_iface, target_iface=data.target_iface,
        link_type="manual",
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


@router.delete("/{link_id}", status_code=204)
def delete_link(link_id: int, db: Session = Depends(get_db)):
    link = db.get(Link, link_id)
    if not link:
        raise HTTPException(404, "Link not found")
    db.delete(link)
    db.commit()
