import io
from datetime import datetime, timedelta

import qrcode
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Appointment, AuditLog, Document, LabValue, Patient
from .common import Actor, audit, get_actor, load_patient

router = APIRouter(prefix="/api", tags=["patients"])


def patient_dict(p: Patient, db: Session | None = None) -> dict:
    d = {
        "id": p.id, "abha_id": p.abha_id, "name": p.name, "sex": p.sex, "age": p.age, "phone": p.phone,
        "preferred_language": p.preferred_language, "cancer_type": p.cancer_type, "stage": p.stage,
        "diagnosis_date": p.diagnosis_date.isoformat() if p.diagnosis_date else None,
        "treating_oncologist": p.treating_oncologist, "current_regimen": p.current_regimen,
        "referred_from": p.referred_from,
    }
    if db is not None:
        d["document_count"] = db.scalar(select(func.count()).select_from(Document)
                                        .where(Document.patient_id == p.id))
    return d


@router.get("/patients")
def list_patients(q: str = "", db: Session = Depends(get_db)):
    stmt = select(Patient).order_by(Patient.id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Patient.id.ilike(like), Patient.name.ilike(like), Patient.abha_id.ilike(like)))
    return [patient_dict(p, db) for p in db.scalars(stmt).all()]


class NewPatient(BaseModel):
    name: str
    sex: str
    age: int
    phone: str | None = None
    preferred_language: str = "en"
    cancer_type: str | None = None
    stage: str | None = None
    abha_id: str | None = None
    referred_from: str | None = None
    treating_oncologist: str | None = None


@router.post("/patients")
def create_patient(body: NewPatient, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    year = datetime.now().year
    n = db.scalar(select(func.count()).select_from(Patient)) + 1
    pid = f"OB-{year}-{n:04d}"
    while db.get(Patient, pid):
        n += 1
        pid = f"OB-{year}-{n:04d}"
    if body.abha_id and len("".join(ch for ch in body.abha_id if ch.isdigit())) not in (14,):
        raise HTTPException(422, "ABHA number must have 14 digits (format 91-1234-5678-9012)")
    p = Patient(id=pid, **body.model_dump())
    db.add(p)
    db.commit()
    audit(db, actor, "register_patient", pid, body.name)
    return patient_dict(p, db)


@router.get("/patients/{patient_id}")
def get_patient(patient: Patient = Depends(load_patient), db: Session = Depends(get_db),
                actor: Actor = Depends(get_actor)):
    audit(db, actor, "view_profile", patient.id)
    return patient_dict(patient, db)


@router.get("/patients/{patient_id}/qr")
def patient_qr(patient: Patient = Depends(load_patient)):
    img = qrcode.make(f"ONCOBRIEF:{patient.id}", box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")


@router.get("/patients/{patient_id}/labs")
def patient_labs(patient: Patient = Depends(load_patient), db: Session = Depends(get_db)):
    rows = db.scalars(select(LabValue).where(LabValue.patient_id == patient.id)
                      .order_by(LabValue.measured_at)).all()
    out: dict[str, list] = {}
    for l in rows:
        out.setdefault(l.test, []).append({"date": l.measured_at.isoformat(), "value": l.value, "unit": l.unit,
                                           "flag": l.flag, "ref_low": l.ref_low, "ref_high": l.ref_high,
                                           "document_id": l.document_id})
    return out


@router.get("/audit")
def audit_log(patient_id: str | None = None, limit: int = 50, db: Session = Depends(get_db)):
    stmt = select(AuditLog).order_by(AuditLog.at.desc()).limit(limit)
    if patient_id:
        stmt = stmt.where(AuditLog.patient_id == patient_id)
    return [{"at": a.at.isoformat(), "role": a.actor_role, "name": a.actor_name, "action": a.action,
             "patient_id": a.patient_id, "detail": a.detail} for a in db.scalars(stmt).all()]


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "patients": db.scalar(select(func.count()).select_from(Patient)),
        "documents": db.scalar(select(func.count()).select_from(Document)),
        "documents_today": db.scalar(select(func.count()).select_from(Document).where(Document.uploaded_at >= today)),
        "appointments_today": db.scalar(select(func.count()).select_from(Appointment).where(
            Appointment.start >= today, Appointment.start < today + timedelta(days=1))),
    }
