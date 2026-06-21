from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import ScanJob, ScanJobChange, HostCheck, Host
from app.schemas.scan import ScanJobCreate, ScanJobRead, ScanJobChangeRead
from app.schemas.host import ScanJobCheckRead
from app.services.scanner import start_scan_async

router = APIRouter(prefix="/scan", tags=["scan"])


@router.post("/", response_model=ScanJobRead, status_code=201)
def create_scan_job(data: ScanJobCreate, db: Session = Depends(get_db)):
    job = ScanJob(
        target=data.target,
        network_id=data.network_id,
        scan_types=",".join(data.scan_types),
        status="pending",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    start_scan_async(job.id)
    return job


@router.get("/", response_model=List[ScanJobRead])
def list_scan_jobs(limit: int = 20, db: Session = Depends(get_db)):
    return (db.query(ScanJob)
            .order_by(ScanJob.created_at.desc())
            .limit(limit)
            .all())


@router.get("/{job_id}", response_model=ScanJobRead)
def get_scan_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(ScanJob, job_id)
    if not job:
        raise HTTPException(404, "Scan job not found")
    return job


@router.get("/{job_id}/checks", response_model=List[ScanJobCheckRead])
def get_scan_job_checks(job_id: int, limit: int = 500, db: Session = Depends(get_db)):
    job = db.get(ScanJob, job_id)
    if not job:
        raise HTTPException(404, "Scan job not found")
    rows = (
        db.query(HostCheck, Host.ip_address, Host.hostname)
        .join(Host, Host.id == HostCheck.host_id)
        .filter(HostCheck.scan_job_id == job_id)
        .order_by(HostCheck.checked_at.desc())
        .limit(limit)
        .all()
    )
    return [
        ScanJobCheckRead(
            id=check.id, host_id=check.host_id, host_ip=ip, host_label=hostname or ip,
            check_type=check.check_type, is_success=check.is_success,
            detail=check.detail, checked_at=check.checked_at,
        )
        for check, ip, hostname in rows
    ]


@router.get("/{job_id}/changes", response_model=List[ScanJobChangeRead])
def get_scan_job_changes(job_id: int, db: Session = Depends(get_db)):
    job = db.get(ScanJob, job_id)
    if not job:
        raise HTTPException(404, "Scan job not found")
    rows = (
        db.query(ScanJobChange, Host.ip_address, Host.hostname)
        .join(Host, Host.id == ScanJobChange.host_id)
        .filter(ScanJobChange.scan_job_id == job_id)
        .order_by(ScanJobChange.created_at.asc())
        .all()
    )
    return [
        ScanJobChangeRead(
            id=change.id, host_id=change.host_id, host_ip=ip, host_label=hostname or ip,
            change_type=change.change_type, detail=change.detail, created_at=change.created_at,
        )
        for change, ip, hostname in rows
    ]
