from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from typing import List, Optional

from app.database import get_db
from app.models import Host, HostCheck
from app.schemas.host import HostCreate, HostRead, HostUpdate, HostCheckRead

router = APIRouter(prefix="/hosts", tags=["hosts"])


@router.get("/", response_model=List[HostRead])
def list_hosts(
    network_id: Optional[int] = Query(None),
    is_up: Optional[bool] = Query(None),
    device_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(500, le=2000),
    offset: int = Query(0),
    db: Session = Depends(get_db),
):
    q = db.query(Host)
    if network_id is not None:
        q = q.filter_by(network_id=network_id)
    if is_up is not None:
        q = q.filter_by(is_up=is_up)
    if device_type:
        q = q.filter_by(device_type=device_type)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            Host.ip_address.like(like),
            Host.hostname.like(like),
            Host.snmp_sysname.like(like),
            Host.vendor.like(like),
        ))
    return q.order_by(Host.ip_address).offset(offset).limit(limit).all()


@router.post("/", response_model=HostRead, status_code=201)
def create_host(data: HostCreate, db: Session = Depends(get_db)):
    existing = db.query(Host).filter_by(ip_address=data.ip_address).first()
    if existing:
        raise HTTPException(400, f"Host {data.ip_address} already exists")
    d = data.model_dump()
    d['is_managed'] = True
    host = Host(**d)
    db.add(host)
    db.commit()
    db.refresh(host)
    return host


@router.get("/{host_id}", response_model=HostRead)
def get_host(host_id: int, db: Session = Depends(get_db)):
    host = db.get(Host, host_id)
    if not host:
        raise HTTPException(404, "Host not found")
    return host


@router.patch("/{host_id}", response_model=HostRead)
def update_host(host_id: int, data: HostUpdate, db: Session = Depends(get_db)):
    host = db.get(Host, host_id)
    if not host:
        raise HTTPException(404, "Host not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(host, k, v)
    db.commit()
    db.refresh(host)
    return host


@router.delete("/{host_id}", status_code=204)
def delete_host(host_id: int, db: Session = Depends(get_db)):
    host = db.get(Host, host_id)
    if not host:
        raise HTTPException(404, "Host not found")
    db.delete(host)
    db.commit()


@router.get("/{host_id}/checks", response_model=List[HostCheckRead])
def host_checks(host_id: int, limit: int = 50, db: Session = Depends(get_db)):
    host = db.get(Host, host_id)
    if not host:
        raise HTTPException(404, "Host not found")
    checks = (db.query(HostCheck)
               .filter_by(host_id=host_id)
               .order_by(HostCheck.checked_at.desc())
               .limit(limit)
               .all())
    return checks
