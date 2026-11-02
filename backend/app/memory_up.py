"""Department-authored visit reminders; patient-visible after a doctor's review."""
from datetime import datetime
from pathlib import Path
import secrets

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import DateTime, ForeignKey, String, select, update
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Mapped, mapped_column

from .config import STORAGE_DIR
from .db import Base, get_db
from .encrypted_types import EncryptedText
from .models import Appointment, Patient
from .security import append_audit, encrypt_file, identity, read_file, require_patient, visible_ids
from .services.uploads import check_identity, validate_file
from .services.ocr import extract_text
from .taxonomy import DEPARTMENTS
from .timeutil import utcnow

router = APIRouter(tags=["Memory Up"])
PAGE_DIR = Path(__file__).resolve().parents[2] / "frontend" / "memory-up"
MEMORY_DIR = STORAGE_DIR / "memory-up"
WRITERS = {"doctor", "nurse", "lab", "frontdesk", "admin"}
DEPARTMENT_NAMES = {d["name"] for d in DEPARTMENTS if d["name"] != "Front desk / Records"}


class MemoryUp(Base):
    __tablename__ = "pantheon_memory_up"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"))
    department: Mapped[str] = mapped_column(String, index=True)
    title: Mapped[str] = mapped_column(String)
    advice: Mapped[str] = mapped_column(EncryptedText, default="")
    attachment: Mapped[str] = mapped_column(String, default="")
    attachment_name: Mapped[str] = mapped_column(String, default="")
    attachment_mime: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="draft")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    author_name: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    approved_by: Mapped[str] = mapped_column(String, default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def user_for(db, request, patient_id):
    user = identity(request)
    require_patient(db, user, patient_id, "documents")
    if not db.get(Patient, patient_id):
        raise HTTPException(404, "Patient not found")
    return user


def can_manage(user, department):
    return user.role in WRITERS and (user.role == "admin" or user.department == department)


def visible_note(db, request, note_id):
    row = db.get(MemoryUp, note_id)
    if not row:
        raise HTTPException(404, "Memory Up not found")
    user = user_for(db, request, row.patient_id)
    if user.role in {"patient", "caregiver"}:
        if row.status != "published":
            raise HTTPException(404, "Memory Up not found")
    elif not can_manage(user, row.department):
        raise HTTPException(403, "Only your department's Memory Up documents are accessible")
    return user, row


def payload(db, row):
    visit = db.get(Appointment, row.appointment_id)
    return {"id": row.id, "patient_id": row.patient_id, "department": row.department,
            "appointment_id": row.appointment_id,
            "appointment_at": visit.start.isoformat() if visit else None,
            "doctor": visit.clinician if visit else "", "title": row.title,
            "advice": row.advice, "status": row.status, "author": row.author_name,
            "created_at": row.created_at.isoformat() + "Z", "approved_by": row.approved_by,
            "approved_at": row.approved_at.isoformat() + "Z" if row.approved_at else None,
            "attachment_name": row.attachment_name,
            "attachment_url": f"/api/memory-up/{row.id}/attachment" if row.attachment else None}


@router.get("/memory-up", include_in_schema=False)
def memory_page():
    return FileResponse(PAGE_DIR / "index.html")


@router.get("/memory-up-assets/{asset}", include_in_schema=False)
def memory_asset(asset: str):
    if asset not in {"app.js", "style.css"}:
        raise HTTPException(404)
    return FileResponse(PAGE_DIR / asset)


@router.get("/api/memory-up/context")
def context(request: Request, patient_id: str = "", db=Depends(get_db)):
    user = identity(request)
    patients = db.scalars(select(Patient).where(
        Patient.id.in_(visible_ids(db, user, "documents"))).order_by(Patient.name)).all()
    result = {"user": {"name": user.name, "role": user.role, "department": user.department},
              "patients": [{"id": p.id, "name": p.name} for p in patients], "appointments": [],
              "can_write": user.role in WRITERS and (user.role == "admin" or user.department in DEPARTMENT_NAMES)}
    if patient_id:
        user_for(db, request, patient_id)
        visits = db.scalars(select(Appointment).where(
            Appointment.patient_id == patient_id, Appointment.status != "cancelled"
        ).order_by(Appointment.start.desc())).all()
        result["appointments"] = [{"id": v.id, "department": v.department,
                                   "start": v.start.isoformat(), "clinician": v.clinician}
                                  for v in visits if can_manage(user, v.department)]
    return result


@router.get("/api/memory-up/patients/{patient_id}")
def list_memory_up(patient_id: str, request: Request, db=Depends(get_db)):
    user = user_for(db, request, patient_id)
    stmt = select(MemoryUp).where(MemoryUp.patient_id == patient_id)
    if user.role in {"patient", "caregiver"}:
        stmt = stmt.where(MemoryUp.status == "published")
    elif user.role == "admin":
        pass
    elif user.role in WRITERS and user.department in DEPARTMENT_NAMES:
        stmt = stmt.where(MemoryUp.department == user.department)
    else:
        raise HTTPException(403, "Department document access is required")
    rows = db.scalars(stmt.order_by(MemoryUp.created_at.desc(), MemoryUp.id.desc())).all()
    append_audit(db, user, "memory_up_list", patient_id)
    return [payload(db, row) for row in rows]


@router.post("/api/memory-up/patients/{patient_id}")
async def create_memory_up(patient_id: str, request: Request, appointment_id: int = Form(...),
                           title: str = Form("Memory Up"), advice: str = Form(""),
                           identity_confirmed: bool = Form(False), file: UploadFile | None = File(None),
                           db=Depends(get_db)):
    user = user_for(db, request, patient_id)
    visit = db.get(Appointment, appointment_id)
    if not visit or visit.patient_id != patient_id or visit.status == "cancelled":
        raise HTTPException(422, "Choose a non-cancelled appointment for this patient")
    if not can_manage(user, visit.department):
        raise HTTPException(403, "You can upload only for your assigned department")
    if not identity_confirmed:
        raise HTTPException(422, "Confirm that the advice and file belong to the selected patient and appointment")
    title, advice = title.strip(), advice.strip()
    if not title or len(title) > 200 or len(advice) > 10000:
        raise HTTPException(422, "Use a title up to 200 characters and advice up to 10,000 characters")
    path = None
    attachment_name = attachment_mime = ""
    if file and file.filename:
        data = await file.read(15 * 1024 * 1024 + 1)
        if len(data) > 15 * 1024 * 1024:
            raise HTTPException(413, "Maximum attachment size is 15 MB")
        suffix = Path(file.filename).suffix.lower()
        attachment_mime = validate_file(data, suffix)
        attachment_name = Path(file.filename.replace("\\", "/")).name[:200]
        MEMORY_DIR.mkdir(parents=True, exist_ok=True)
        path = MEMORY_DIR / (secrets.token_hex(24) + suffix)
        path.write_bytes(data)
        try:
            text, _, _ = await run_in_threadpool(extract_text, path, attachment_mime)
            check_identity(text, db.get(Patient, patient_id), True,
                           "Department staff confirmed the patient and appointment before upload")
            encrypt_file(path)
        except Exception:
            path.unlink(missing_ok=True)
            raise
    if not advice and path is None:
        raise HTTPException(422, "Write the doctor's advice or attach the appointment document")
    row = MemoryUp(patient_id=patient_id, appointment_id=visit.id, department=visit.department,
                   title=title, advice=advice, created_by=user.id, author_name=user.name,
                   attachment=path.name if path else "", attachment_name=attachment_name,
                   attachment_mime=attachment_mime)
    try:
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        if path:
            path.unlink(missing_ok=True)
        raise
    append_audit(db, user, "memory_up_draft", patient_id, f"Memory Up {row.id}; {visit.department}")
    return payload(db, row)


@router.post("/api/memory-up/{note_id}/publish")
def publish_memory_up(note_id: int, request: Request, db=Depends(get_db)):
    user, row = visible_note(db, request, note_id)
    if user.role != "doctor" or user.department != row.department:
        raise HTTPException(403, "A doctor from this department must review and publish the advice")
    if row.status != "draft":
        raise HTTPException(409, "This Memory Up has already been published")
    visit = db.get(Appointment, row.appointment_id)
    if not visit or visit.status == "cancelled":
        raise HTTPException(409, "The appointment was cancelled; review the record before publishing")
    if visit.patient_id != row.patient_id or visit.department != row.department:
        raise HTTPException(409, "The appointment's patient or department changed; create a corrected Memory Up")
    # Compare-and-set protects against two review requests publishing the same
    # draft concurrently, including across separate application workers.
    result = db.execute(update(MemoryUp).where(
        MemoryUp.id == row.id, MemoryUp.status == "draft",
    ).values(status="published", approved_by=user.name, approved_at=utcnow()))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "This Memory Up has already been published")
    db.commit()
    db.refresh(row)
    append_audit(db, user, "memory_up_published", row.patient_id, f"Memory Up {row.id}")
    return payload(db, row)


@router.get("/api/memory-up/{note_id}/attachment")
def attachment(note_id: int, request: Request, db=Depends(get_db)):
    user, row = visible_note(db, request, note_id)
    path = (MEMORY_DIR / row.attachment).resolve()
    if not row.attachment or not path.is_relative_to(MEMORY_DIR.resolve()) or not path.is_file():
        raise HTTPException(404, "Attachment not found")
    append_audit(db, user, "memory_up_attachment", row.patient_id, f"Memory Up {row.id}")
    return Response(read_file(path), media_type=row.attachment_mime,
                    headers={"Content-Disposition": f'attachment; filename="memory-up-{row.id}{path.suffix}"'})
