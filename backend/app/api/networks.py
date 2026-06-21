import ipaddress
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models import Network, Host
from app.schemas.network import NetworkCreate, NetworkRead, NetworkUpdate, NetworkStats

router = APIRouter(prefix="/networks", tags=["networks"])


def _enrich(network: Network, db: Session) -> NetworkRead:
    total = db.query(func.count(Host.id)).filter_by(network_id=network.id).scalar() or 0
    up = db.query(func.count(Host.id)).filter_by(network_id=network.id, is_up=True).scalar() or 0
    r = NetworkRead.model_validate(network)
    r.total_hosts = total
    r.up_hosts = up
    return r


@router.get("/", response_model=List[NetworkRead])
def list_networks(db: Session = Depends(get_db)):
    networks = db.query(Network).order_by(Network.cidr).all()
    return [_enrich(n, db) for n in networks]


@router.post("/", response_model=NetworkRead, status_code=201)
def create_network(data: NetworkCreate, db: Session = Depends(get_db)):
    existing = db.query(Network).filter_by(cidr=data.cidr).first()
    if existing:
        raise HTTPException(400, f"Network {data.cidr} already exists")
    net = Network(**data.model_dump())
    db.add(net)
    db.commit()
    db.refresh(net)
    return _enrich(net, db)


@router.get("/{network_id}", response_model=NetworkRead)
def get_network(network_id: int, db: Session = Depends(get_db)):
    net = db.get(Network, network_id)
    if not net:
        raise HTTPException(404, "Network not found")
    return _enrich(net, db)


@router.patch("/{network_id}", response_model=NetworkRead)
def update_network(network_id: int, data: NetworkUpdate, db: Session = Depends(get_db)):
    net = db.get(Network, network_id)
    if not net:
        raise HTTPException(404, "Network not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(net, k, v)
    db.commit()
    db.refresh(net)
    return _enrich(net, db)


@router.delete("/{network_id}", status_code=204)
def delete_network(network_id: int, db: Session = Depends(get_db)):
    net = db.get(Network, network_id)
    if not net:
        raise HTTPException(404, "Network not found")
    db.delete(net)
    db.commit()


@router.get("/{network_id}/stats", response_model=NetworkStats)
def network_stats(network_id: int, db: Session = Depends(get_db)):
    net = db.get(Network, network_id)
    if not net:
        raise HTTPException(404, "Network not found")
    cidr = ipaddress.ip_network(net.cidr, strict=False)
    total_possible = cidr.num_addresses - 2  # exclude network/broadcast
    allocated = db.query(func.count(Host.id)).filter_by(network_id=network_id).scalar() or 0
    up = db.query(func.count(Host.id)).filter_by(network_id=network_id, is_up=True).scalar() or 0
    return NetworkStats(
        total=total_possible,
        allocated=allocated,
        free=max(0, total_possible - allocated),
        up=up,
        down=allocated - up,
    )
