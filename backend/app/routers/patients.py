import io
from datetime import datetime, timedelta

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Literal
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Appointment, AuditLog, Document, LabValue, Patient
from ..timeutil import hospital_now
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
def list_patients(request: Request, q: str = "", db: Session = Depends(get_db)):
    from ..security import identity, visible_ids
    user = identity(request)
    stmt = select(Patient).where(Patient.id.in_(visible_ids(db, user))).order_by(Patient.id)
    rows = [patient_dict(p, db) for p in db.scalars(stmt).all()]
    if q:
        query = q.strip().lower()
        rows = [p for p in rows if any(query in str(p.get(k) or "").lower() for k in ("id", "name", "abha_id"))]
    from ..security import visible_ids
    clinical_ids = set(visible_ids(db, user, "documents")) if user.role != "lab" else set()
    return [p if p["id"] in clinical_ids else {k:v for k,v in p.items() if k in {"id","name","age","sex","preferred_language"}} for p in rows]



class NewPatient(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    sex: Literal["F", "M", "O"]
    age: int = Field(ge=0, le=120)
    phone: str | None = None
    preferred_language: Literal["en", "hi", "mr"] = "en"
    cancer_type: str | None = None
    stage: str | None = None
    abha_id: str | None = None
    referred_from: str | None = None
    treating_oncologist: str | None = None


@router.post("/patients")
def create_patient(body: NewPatient, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    year = hospital_now().year
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
    from ..round2_models import AccessGrant
    db.add(AccessGrant(user_id=actor.id, patient_id=pid, scopes=["profile", "appointments"], consent_by="Registered by front desk"))
    db.commit()
    audit(db, actor, "register_patient", pid, body.name)
    return patient_dict(p, db)


@router.get("/patients/{patient_id}")
def get_patient(patient: Patient = Depends(load_patient), db: Session = Depends(get_db),
                actor: Actor = Depends(get_actor)):
    audit(db, actor, "view_profile", patient.id)
    result = patient_dict(patient, db)
    from ..round2_models import User
    from ..security import visible_ids
    if actor.role == "lab" or patient.id not in visible_ids(db, db.get(User, actor.id), "documents"):
        result = {k:v for k,v in result.items() if k in {"id","name","age","sex","preferred_language"}}
    return result


@router.get("/patients/{patient_id}/qr")
def patient_qr(patient: Patient = Depends(load_patient)):
    img = qrcode.make(f"ONCOBRIEF:{patient.id}", box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")


@router.get("/patients/{patient_id}/labs")
def patient_labs(request: Request, patient: Patient = Depends(load_patient), db: Session = Depends(get_db)):
    from ..security import identity
    user = identity(request)
    stmt = select(LabValue).where(LabValue.patient_id == patient.id).order_by(LabValue.measured_at)
    if user.role == "lab":
        from ..round2_models import DocumentOwner
        stmt = stmt.where(LabValue.document_id.in_(select(DocumentOwner.document_id).where(DocumentOwner.user_id==user.id)))
    rows = db.scalars(stmt).all()
    out: dict[str, list] = {}
    for l in rows:
        out.setdefault(l.test, []).append({"date": l.measured_at.isoformat(), "value": l.value, "unit": l.unit,
                                           "flag": l.flag, "ref_low": l.ref_low, "ref_high": l.ref_high,
                                           "document_id": l.document_id})
    return out


@router.get("/audit")
def audit_log(request: Request, patient_id: str | None = None, limit: int = 50, db: Session = Depends(get_db)):
    from ..security import identity, visible_ids
    stmt = select(AuditLog).where(AuditLog.patient_id.in_(visible_ids(db, identity(request), "audit"))).order_by(AuditLog.at.desc()).limit(min(max(limit, 1), 200))
    if patient_id:
        stmt = stmt.where(AuditLog.patient_id == patient_id)
    return [{"at": a.at.isoformat(), "role": a.actor_role, "name": a.actor_name, "action": a.action,
             "patient_id": a.patient_id, "detail": a.detail} for a in db.scalars(stmt).all()]


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    upload_day = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    upload_tomorrow = upload_day + timedelta(days=1)
    appointment_day = hospital_now().replace(hour=0, minute=0, second=0, microsecond=0)
    appointment_tomorrow = appointment_day + timedelta(days=1)
    return {
        "patients": db.scalar(select(func.count()).select_from(Patient)),
        "documents": db.scalar(select(func.count()).select_from(Document)),
        "documents_today": db.scalar(select(func.count()).select_from(Document).where(
            Document.uploaded_at >= upload_day, Document.uploaded_at < upload_tomorrow)),
        "appointments_today": db.scalar(select(func.count()).select_from(Appointment).where(
            Appointment.start >= appointment_day, Appointment.start < appointment_tomorrow,
            Appointment.status != "cancelled")),
    }
