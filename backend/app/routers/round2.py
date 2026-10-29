from ..timeutil import hospital_now, hospital_wall_to_utc, to_hospital_wall_time, utcnow
"""Round 2 patient, caregiver, clinician and hospital workflows."""
import io
import json
import math
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from ..db import get_db
from ..models import Activity, Appointment, Document, LabValue, Medication, MedLog, Patient, SymptomReport, WearableReading
from ..round2_models import WearableDeviceCredential
from ..round2_models import AccessGrant, Alert, Approval, CareRecord, LibraryItem, Notification, ShareLink, User, TreatingClinician, VirtualAppointment
from ..security import DEMO_MODE, append_audit, digest, identity, password_hash, require_patient, roles, verify_chain, visible_ids
from ..services.companion import EMERGENCY, alert, answer, command_centre, living_summary, notify_team, records, red_flags, safe_text
from ..services.integrations import deliver, status as integration_status
from ..services.activity import low_activity_steps_threshold
from ..services.vitals import current_vital_alert_protocol, evaluate_vital_readings
from ..workflows import WORKFLOWS
from ..services.scheduling import serial_schedule
from .auth import sign_in_id

router = APIRouter(prefix="/api", tags=["connected care"])
CLINICIANS = {"doctor", "nurse", "admin"}


def patient_access(db, request, pid, scope="profile"):
    user = identity(request)
    require_patient(db, user, pid, scope)
    if not db.get(Patient, pid):
        raise HTTPException(404, "Patient not found")
    return user


def serial(row, exclude=()):
    out = {c.name: getattr(row, c.name) for c in row.__table__.columns if c.name not in exclude}
    return {k: v.isoformat() + "Z" if isinstance(v, datetime) else v for k, v in out.items()}


@router.get("/v2/workflows")
def workflows(request: Request):
    user = identity(request)
    return {key: value for key, value in WORKFLOWS.items() if user.role in value["roles"] or user.role == "admin"}


@router.get("/v2/integrations")
def integrations(request: Request):
    identity(request)
    from ..services.google_meet import configured as google_meet_configured
    services = integration_status()
    services.append({"service": "google_meet", "configured": google_meet_configured(),
                     "settings": ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REFRESH_TOKEN"]})
    return {"services": services, "demo": DEMO_MODE,
            "llm": bool(os.getenv("LLM_API_KEY")), "india_hosting_confirmed": os.getenv("INDIA_HOSTING_CONFIRMED") == "true",
            "hospital_emergency": os.getenv("HOSPITAL_EMERGENCY_PHONE", "Set HOSPITAL_EMERGENCY_PHONE"),
            "hospital_address": os.getenv("HOSPITAL_ADDRESS", "Set HOSPITAL_ADDRESS")}


@router.get("/v2/notifications")
def notifications(request: Request, db=Depends(get_db)):
    user = identity(request)
    alert_ids = set(visible_ids(db, user, "alerts"))
    appointment_ids = set(visible_ids(db, user, "appointments"))
    activity_ids = set(visible_ids(db, user, "activity"))
    return [serial(n) for n in db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(100))
            if not n.patient_id or n.patient_id in (
                appointment_ids if n.channel in {"transport", "appointment"}
                else activity_ids if n.channel in {"activity", "vitals"}
                else alert_ids
            )]


@router.post("/v2/notifications/{nid}/read")
def read_notification(nid: int, request: Request, db=Depends(get_db)):
    user = identity(request)
    row = db.get(Notification, nid)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "Notification not found")
    row.status = "read"
    db.commit()
    return {"ok": True}


@router.get("/v2/command-centre")
def command(request: Request, db=Depends(get_db)):
    user = identity(request)
    roles(user, "doctor", "nurse", "navigator", "frontdesk", "admin")
    ids = visible_ids(db, user)
    rows = command_centre(db, ids)
    if user.role in {"frontdesk", "navigator"}:
        rows = [{k: v for k, v in r.items() if k in {"patient_id", "name", "diagnosis_days", "first_treatment_date", "diagnosis_to_treatment_days", "blocker", "rescue", "travel_km"}} for r in rows]
    return {"patients": rows, "generated_at": utcnow(),
            "open_alerts": sum(r.get("open_alerts", 0) for r in rows),
            "chairs": [serial(r) for r in db.scalars(select(CareRecord).where(CareRecord.kind == "chair", CareRecord.patient_id.in_(ids)))],
            "awaiting_approval": len(db.scalars(select(Approval).where(Approval.patient_id.in_(ids), Approval.status.in_(["sent", "reviewing"]))).all()) if user.role in CLINICIANS else None}


def readable_record(row, user):
    if row.kind == "living_summary":
        return False
    if row.kind == "nurse_handover" and user.role not in CLINICIANS:
        return False
    if row.kind == "companion" and row.author_role in CLINICIANS and user.role not in CLINICIANS:
        return False
    # Patient AI conversations are private unless surfaced through the separate,
    # patient-consented clinician insight path.
    if row.kind == "companion" and row.author_role == "patient" and user.role != "patient":
        return False
    if row.kind == "integration_result" and row.status != "approved" and user.role not in CLINICIANS:
        return False
    if row.kind in {"wellbeing", "diary"} and row.author_id != user.id:
        return row.kind == "diary" and row.data.get("share_concerns") and user.role in CLINICIANS
    if row.kind in WORKFLOWS and WORKFLOWS[row.kind].get("clinical") and row.status != "approved":
        return user.role in CLINICIANS or row.author_id == user.id
    return True


@router.get("/v2/patients/{patient_id}/records")
def list_records(patient_id: str, request: Request, kind: str = "", db=Depends(get_db)):
    user = patient_access(db, request, patient_id)
    if user.role == "lab":
        raise HTTPException(403, "Lab staff may access their own uploads only")
    ids_by_scope = {s: patient_id in visible_ids(db, user, s) for s in {w["scope"] for w in WORKFLOWS.values()}}
    return [serial(r) for r in records(db, patient_id, kind or None)[:500]
            if readable_record(r, user) and ids_by_scope.get(WORKFLOWS.get(r.kind, {}).get("scope", "notes"), False)]


class RecordIn(BaseModel):
    kind: str = Field(max_length=40)
    data: dict


def validate_record(kind, data):
    if kind not in WORKFLOWS:
        raise HTTPException(422, "Unknown workflow")
    spec = WORKFLOWS[kind]
    allowed = {f["key"] for f in spec["fields"]}
    if set(data) - allowed:
        raise HTTPException(422, "Unexpected workflow fields")
    out = {}
    for f in spec["fields"]:
        value = data.get(f["key"])
        if f.get("required") and (value is None or value == "" or (f["type"] == "checkbox" and value is not True)):
            raise HTTPException(422, f"{f['label']} is required")
        if value is None or value == "":
            continue
        if f["type"] == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not f.get("min", -1e12) <= value <= f.get("max", 1e12):
                raise HTTPException(422, f"Invalid number: {f['label']}")
        elif f["type"] == "checkbox":
            if not isinstance(value, bool):
                raise HTTPException(422, f"Invalid checkbox: {f['label']}")
        else:
            if not isinstance(value, str) or len(value) > 20000:
                raise HTTPException(422, f"Invalid text: {f['label']}")
            if f["type"] == "select" and value not in f["options"]:
                raise HTTPException(422, f"Invalid option: {f['label']}")
            if f["type"] in {"date", "datetime-local"}:
                try:
                    datetime.fromisoformat(value)
                except ValueError:
                    raise HTTPException(422, f"Invalid date: {f['label']}")
            if f["type"] == "url" and not value.startswith("https://"):
                raise HTTPException(422, "Source URLs must use HTTPS")
        out[f["key"]] = value
    return out


@router.post("/v2/patients/{patient_id}/records")
def create_record(patient_id: str, body: RecordIn, request: Request, db=Depends(get_db)):
    data = validate_record(body.kind, body.data)
    spec = WORKFLOWS[body.kind]
    user = patient_access(db, request, patient_id, spec["scope"])
    roles(user, *spec["roles"], "admin")
    for key in ("document_id", "audio_document_id"):
        if data.get(key):
            doc = db.get(Document, int(data[key]))
            if not doc or doc.patient_id != patient_id:
                raise HTTPException(422, "Source must be a document belonging to this patient")
    if body.kind == "roadmap" and data.get("cycle", 1) > data.get("total_cycles", 100):
        raise HTTPException(422, "Current cycle cannot exceed planned cycles")
    if body.kind == "communication" and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", data.get("time", "")):
        raise HTTPException(422, "Enter daily call time as HH:MM")
    if body.kind == "chair":
        order = db.get(Approval, int(data["approval_id"]))
        if not order or order.patient_id != patient_id or order.status != "approved":
            raise HTTPException(422, "A signed approved order is required")
        if data["start"] >= data["end"]:
            raise HTTPException(422, "Chair end must follow start")
        for other in db.scalars(select(CareRecord).where(CareRecord.kind == "chair", CareRecord.status != "completed")):
            if other.data["chair"] == data["chair"] and other.data["start"] < data["end"] and data["start"] < other.data["end"]:
                raise HTTPException(409, "Chair is already allocated at that time")
    row = CareRecord(patient_id=patient_id, kind=body.kind, author_id=user.id, author_name=user.name,
                     author_role=user.role, data=data, status="draft" if spec.get("clinical") or body.kind == "photo_symptom" else "recorded")
    db.add(row)
    db.commit()
    flag = red_flags(data.get("text", ""), on_treatment=bool(db.get(Patient, patient_id).current_regimen))
    if flag["level"] >= 2 and (body.kind != "diary" or data.get("share_concerns") or flag["level"] == 3):
        alert(db, patient_id, flag["reason"], f"R{row.id}", "emergency" if flag["level"] == 3 else "urgent")
    if body.kind == "pain" and data.get("score", 0) >= 7:
        alert(db, patient_id, "High pain score reported", f"R{row.id}")
    if body.kind == "nutrition" and data.get("weight_kg"):
        older = [r for r in records(db, patient_id, "nutrition") if r.id != row.id and r.data.get("weight_kg") and r.created_at > utcnow() - timedelta(days=30)]
        if older and data["weight_kg"] < older[-1].data["weight_kg"] * .95:
            alert(db, patient_id, "Reported weight loss exceeds 5% of recent weight; dietitian review", f"R{row.id}")
    if body.kind == "privacy_request":
        for officer in db.scalars(select(User).where(User.role.in_(["privacy", "admin"]))):
            db.add(Notification(user_id=officer.id, title="Privacy rights request", body=f"Request R{row.id}: {data['request_type']}"))
        db.commit()
    if body.kind == "wellbeing" and data.get("request_support"):
        for navigator in db.scalars(select(User).where(User.role == "navigator", User.active.is_(True))):
            if patient_id in visible_ids(db, navigator, "notes"):
                db.add(Notification(user_id=navigator.id, title="Caregiver support requested", body=f"{user.name} asks the navigator to contact them. Private wellbeing scores are not shared."))
        db.commit()
    append_audit(db, user, "create_" + body.kind, patient_id, f"R{row.id}")
    return serial(row)


class RecordAction(BaseModel):
    action: Literal["approve", "complete", "confirm_grade", "acknowledge", "reject"]
    text: str = Field(default="", max_length=20000)
    grade: int | None = Field(default=None, ge=0, le=4)


@router.post("/v2/records/{record_id}/action")
def record_action(record_id: int, body: RecordAction, request: Request, db=Depends(get_db)):
    row = db.get(CareRecord, record_id)
    if not row:
        raise HTTPException(404, "Record not found")
    user = identity(request)
    if row.kind == "privacy_request" and user.role in {"privacy", "admin"}:
        pass
    else:
        patient_access(db, request, row.patient_id, WORKFLOWS.get(row.kind, {}).get("scope", "notes"))
    if body.action in {"approve", "reject"}:
        roles(user, "doctor")
        primary=db.get(TreatingClinician,row.patient_id)
        if not primary or primary.user_id != user.id:
            raise HTTPException(403, "The treating oncologist must sign clinical changes")
        if row.status not in {"draft", "recorded"}:
            raise HTTPException(409, "This record has already been reviewed")
        changed = db.execute(update(CareRecord).where(CareRecord.id == row.id, CareRecord.status.in_(["draft", "recorded"])).values(status="review_locked"))
        if changed.rowcount != 1:
            raise HTTPException(409, "Another clinician has already reviewed this record")
        row.status = "approved" if body.action == "approve" else "rejected"
        if body.text:
            row.data = {**row.data, "text": body.text}
        row.approved_by, row.approved_at = user.name, utcnow()
        if row.status == "approved":
            if row.data.get("reminder") and row.data.get("reminder_at"):
                db.add(CareRecord(patient_id=row.patient_id, kind="reminder", author_id=user.id, author_name=user.name,
                                  author_role=user.role, status="recorded", data={"title": row.data["reminder"], "due_at": row.data["reminder_at"], "source": f"R{row.id}"}))
            if row.kind == "board_decision" and row.data.get("plan"):
                db.add(CareRecord(patient_id=row.patient_id, kind="roadmap", author_id=user.id, author_name=user.name,
                                  author_role=user.role, status="approved", approved_by=user.name, approved_at=utcnow(),
                                  data={"text": row.data["plan"], "source": f"R{row.id}"}))
            notify_team(db, row.patient_id, "Signed care update", f"{WORKFLOWS.get(row.kind, {}).get('title', row.kind)} is available.")
    elif body.action == "confirm_grade":
        roles(user, "nurse", "doctor", "admin")
        if row.kind != "photo_symptom" or body.grade is None:
            raise HTTPException(422, "Select a symptom photo and confirmed grade")
        row.data = {**row.data, "confirmed_grade": body.grade, "confirmed_by": user.name}
        row.status = "confirmed"
        if body.grade >= 3:
            alert(db, row.patient_id, "Nurse-confirmed severe photo symptom", f"R{row.id}")
    else:
        if row.kind not in {"task", "handover", "reminder", "nurse_handover", "chair", "privacy_request", "buddy"}:
            raise HTTPException(422, "This record cannot be completed with this action")
        if row.kind == "privacy_request":
            roles(user, "privacy", "admin")
            if len(body.text.strip())<10:
                raise HTTPException(422,"Record the privacy officer's response and retention decision")
            row.data={**row.data,"officer_response":body.text,"officer":user.name}
        else:
            roles(user, *WORKFLOWS[row.kind]["roles"], "admin")
        row.status = "completed" if body.action == "complete" else "acknowledged"
    row.updated_at = utcnow()
    db.commit()
    append_audit(db, user, body.action + "_" + row.kind, row.patient_id, f"R{row.id}")
    return serial(row)


class CheckIn(BaseModel):
    language: Literal["en", "hi", "mr"] = "en"
    nausea: int = Field(default=0, ge=0, le=4)
    pain: int = Field(default=0, ge=0, le=4)
    fatigue: int = Field(default=0, ge=0, le=4)
    appetite: int = Field(default=0, ge=0, le=4)
    breathing: int = Field(default=0, ge=0, le=4)
    temperature: float | None = Field(default=None, ge=30, le=45)
    distress: int = Field(default=0, ge=0, le=10)
    text: str = Field(default="", max_length=5000)
    source: Literal["tap", "voice", "phone_demo"] = "tap"


@router.post("/v2/patients/{patient_id}/checkin")
def checkin(patient_id: str, body: CheckIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "checkin")
    roles(user, "patient", "caregiver", "nurse", "doctor", "admin")
    sy = [{"key": k, "name": k.title(), "grade": getattr(body, k)} for k in ("nausea", "pain", "fatigue", "appetite", "breathing")]
    flag = red_flags(body.text, sy, body.temperature, bool(db.get(Patient, patient_id).current_regimen))
    if body.breathing >= 3:
        flag = {"level": 3, "reason": "Severe breathing difficulty reported"}
    row = CareRecord(patient_id=patient_id, kind="checkin", author_id=user.id, author_name=user.name,
                     author_role=user.role, data=body.model_dump() | {"reported_by": user.role}, status="recorded")
    db.add(row)
    db.add(SymptomReport(patient_id=patient_id, language=body.language, symptoms=sy,
                          free_text=body.text + f" [reported by {user.role}: {user.name}]", flagged=flag["level"] >= 2))
    db.commit()
    a = None
    if flag["level"] >= 2:
        a = alert(db, patient_id, flag["reason"], f"checkin R{row.id}", "emergency" if flag["level"] == 3 else "urgent")
    if body.distress >= 7:
        alert(db, patient_id, "High distress; contact counsellor / navigator", f"R{row.id}")
    # Personal cycle forecast deviation is based only on this patient's own prior reports.
    past = [r for r in records(db, patient_id, "checkin") if r.id != row.id]
    if len(past) >= 3:
        baseline = sum(r.data.get("fatigue", 0) + r.data.get("nausea", 0) for r in past[:7]) / min(7, len(past))
        if body.fatigue + body.nausea > baseline + 3:
            alert(db, patient_id, "Symptoms above this patient's recent baseline", f"R{row.id}")
    append_audit(db, user, "daily_checkin", patient_id, f"R{row.id}; reported by {user.role}")
    return {"id": row.id, "level": flag["level"], "alert_id": a.id if a else None,
            "instruction": EMERGENCY[body.language] if flag["level"] == 3 else "Your care team can see this check-in.",
            "nurse_notification": "in_app" if a else None, "external_delivery": "not sent; use configured messaging dispatch" if a else None}


class Question(BaseModel):
    text: str = Field(min_length=1, max_length=3000)
    language: Literal["en", "hi", "mr"] = "en"
    conversation_id: str = Field(default="", max_length=80)


class CompanionSharingIn(BaseModel):
    enabled: bool


@router.post("/v2/patients/{patient_id}/companion")
def companion(patient_id: str, body: Question, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "patient", "caregiver", "doctor", "nurse", "admin")
    result = answer(db, patient_id, body.text, body.language, user.role in CLINICIANS,
                    patient_id in visible_ids(db,user,"notes"), body.conversation_id, user.id, user.role)
    db.add(CareRecord(patient_id=patient_id, kind="companion", author_id=user.id, author_name=user.name,
                      author_role=user.role, data={"question": body.text, "conversation_id": body.conversation_id, **result}, status="recorded"))
    db.commit()
    return result


@router.get("/v2/patients/{patient_id}/companion-sharing")
def get_companion_sharing(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "patient")
    from ..services.companion import companion_sharing_state
    state = companion_sharing_state(db, patient_id)
    return {"enabled": state["enabled"], "since": state["since"].isoformat() if state["since"] else None}


@router.put("/v2/patients/{patient_id}/companion-sharing")
def set_companion_sharing(patient_id: str, body: CompanionSharingIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "patient")
    row = CareRecord(patient_id=patient_id, kind="companion_sharing", author_id=user.id,
                     author_name=user.name, author_role=user.role,
                     data={"enabled": body.enabled}, status="recorded")
    db.add(row)
    append_audit(db, user, "companion_sharing_updated", patient_id,
                 "enabled" if body.enabled else "disabled")
    db.commit()
    return {"enabled": body.enabled, "since": row.created_at.isoformat() if body.enabled else None}


@router.get("/v2/patients/{patient_id}/summary")
def summary(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "doctor", "nurse", "patient", "caregiver")
    return living_summary(db, patient_id, patient_id in visible_ids(db,user,"notes"), patient_id in visible_ids(db,user,"checkin"), patient_id in visible_ids(db,user,"medicines"))


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


@router.get("/v2/patients/{patient_id}/chat")
def chat(patient_id: str, request: Request, db=Depends(get_db)):
    patient_access(db, request, patient_id, "chat")
    rows = records(db, patient_id, "chat")[:100]
    return {"messages": [serial(r) for r in reversed(rows)], "summary": [f"{r.author_name}: {r.data['text'][:160]}" for r in rows[:3]][::-1]}


@router.post("/v2/patients/{patient_id}/chat")
def send_chat(patient_id: str, body: MessageIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "chat")
    flag = red_flags(body.text, on_treatment=bool(db.get(Patient, patient_id).current_regimen))
    row = CareRecord(patient_id=patient_id, kind="chat", author_id=user.id, author_name=user.name,
                     author_role=user.role, data={"text": body.text, "urgency": flag["level"]}, status="sent")
    db.add(row)
    db.commit()
    if flag["level"] >= 2:
        alert(db, patient_id, flag["reason"], f"chat R{row.id}", "emergency" if flag["level"] == 3 else "urgent")
    notify_team(db, patient_id, "Care circle message", f"New message from {user.name}")
    return serial(row) | {"instruction": EMERGENCY["en"] if flag["level"] == 3 else None}


class RequestIn(BaseModel):
    kind: Literal["medicine", "test", "plan", "clinical_question"] = "medicine"
    request: str = Field(min_length=3, max_length=3000)


def approval_dict(row, user):
    data = serial(row)
    if user.role not in CLINICIANS and row.status != "approved":
        data.pop("draft", None)
    return data


@router.get("/v2/patients/{patient_id}/approvals")
def approvals(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "medicines")
    return [approval_dict(r, user) for r in db.scalars(select(Approval).where(Approval.patient_id == patient_id).order_by(Approval.id.desc()))]


@router.post("/v2/patients/{patient_id}/approvals")
def request_approval(patient_id: str, body: RequestIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "medicines")
    roles(user, "patient", "caregiver", "doctor", "nurse", "admin")
    flag = red_flags(body.request, on_treatment=bool(db.get(Patient, patient_id).current_regimen))
    if flag["level"] == 3:
        a = alert(db, patient_id, flag["reason"], "medicine request", "emergency")
        return {"emergency": True, "instruction": EMERGENCY["en"], "alert_id": a.id}
    row = Approval(patient_id=patient_id, kind=body.kind, request=body.request, requested_by=user.name,
                   draft={"text": f"Review the patient's request: {safe_text(body.request)}", "safety": "Doctor must specify medicine and complete safety checks before approval."})
    db.add(row)
    db.commit()
    notify_team(db, patient_id, "Request awaiting doctor", f"Request #{row.id}")
    append_audit(db, user, "submit_clinical_request", patient_id, str(row.id))
    return approval_dict(row, user)


class ReviewIn(BaseModel):
    action: Literal["reviewing", "approve", "reject"]
    medicine: str = Field(default="", max_length=150)
    dose: str = Field(default="", max_length=80)
    frequency: str = Field(default="", max_length=100)
    times: list[str] = Field(default_factory=list, max_length=8)
    instructions: str = Field(default="", max_length=3000)
    reason: str = Field(default="", max_length=3000)
    safety_confirmed: bool = False
    evidence_url: str = Field(default="", max_length=1000)


def prescription_checks(db, pid, body):
    profiles = records(db, pid, "clinical_profile")
    profile = profiles[0].data if profiles else {}
    meds = db.scalars(select(Medication).where(Medication.patient_id == pid, Medication.active.is_(True))).all()
    issues = []
    if not profile.get("allergies"):
        issues.append("Allergy status not confirmed")
    elif body.medicine and body.medicine.lower() in profile.get("allergies", "").lower():
        issues.append("Possible recorded allergy")
    if any(m.name.lower() == body.medicine.lower().strip() for m in meds):
        issues.append("Duplicate active medicine")
    if not profile.get("egfr"):
        issues.append("Kidney function not documented")
    elif profile["egfr"] < 60:
        issues.append("Reduced recorded eGFR; dose needs individual review")
    platelet = db.scalar(select(LabValue).where(LabValue.patient_id == pid, LabValue.test == "Platelets").order_by(LabValue.measured_at.desc()).limit(1))
    if platelet and platelet.value < 100 and re.search(r"aspirin|ibuprofen|diclofenac|naproxen", body.medicine, re.I):
        issues.append("Low recorded platelets: pharmacist review of bleeding risk required")
    if re.search(r"warfarin|methotrexate|doxorubicin|bleomycin|ayur|herbal", body.medicine, re.I):
        issues.append("High-risk or unverified product: protocol / interaction review required")
    bsa = math.sqrt(profile["height_cm"] * profile["weight_kg"] / 3600) if profile.get("height_cm") and profile.get("weight_kg") else None
    protocols = [r for r in records(db, pid, "drug_protocol") if r.status == "approved" and r.data.get("drug", "").lower() == body.medicine.lower().strip()]
    expected = None
    if protocols:
        protocol = protocols[0].data
        if bsa:
            expected = round(protocol["dose_mg_m2"] * bsa, 2)
            stated = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*mg\s*", body.dose, re.I)
            if stated and float(stated[1]) > expected * 1.05:
                issues.append("Entered dose exceeds the signed mg/m² protocol calculation; verify intended rounding and regimen")
        else:
            issues.append("Signed body-size protocol exists, but height or weight is missing")
        if profile.get("egfr", 0) < protocol.get("min_egfr", 0):
            issues.append("eGFR is below the signed drug-protocol threshold")
    return {"issues": issues, "bsa_m2": round(bsa, 2) if bsa else None, "egfr": profile.get("egfr"),
            "protocol_dose_mg": expected, "protocol_source": protocols[0].data.get("source_url") if protocols else None,
            "scope": "Screening rules only. Full formulary interaction and dose checking requires pharmacist / signed local protocol.",
            "active_medicines": [m.name + " " + m.dose for m in meds]}


@router.post("/v2/approvals/{approval_id}/checks")
def check_prescription(approval_id: int, body: ReviewIn, request: Request, db=Depends(get_db)):
    row = db.get(Approval, approval_id)
    if not row:
        raise HTTPException(404, "Request not found")
    user = patient_access(db, request, row.patient_id, "medicines")
    roles(user, "doctor")
    return prescription_checks(db, row.patient_id, body)


@router.post("/v2/approvals/{approval_id}/review")
def review(approval_id: int, body: ReviewIn, request: Request, db=Depends(get_db)):
    row = db.get(Approval, approval_id)
    if not row:
        raise HTTPException(404, "Request not found")
    user = patient_access(db, request, row.patient_id, "medicines")
    roles(user, "doctor")
    primary=db.get(TreatingClinician,row.patient_id)
    if not primary or primary.user_id != user.id:
        raise HTTPException(403, "The treating oncologist must decide this clinical request")
    if row.status in {"approved", "rejected"}:
        raise HTTPException(409, "This request has already been decided")
    changed = db.execute(update(Approval).where(Approval.id == row.id, Approval.status.in_(["sent", "reviewing"])).values(status="review_locked"))
    if changed.rowcount != 1:
        raise HTTPException(409, "Another clinician is already deciding this request")
    checks = prescription_checks(db, row.patient_id, body)
    if body.action == "approve":
        if not body.safety_confirmed or not body.reason.strip():
            raise HTTPException(422, "Confirm clinical safety review and enter the signing rationale")
        if row.kind == "medicine":
            if not body.medicine.strip() or not body.dose.strip() or not body.times or not body.frequency.strip():
                raise HTTPException(422, "Medicine, dose, frequency and reminder times are required")
            if any(not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", t) for t in body.times):
                raise HTTPException(422, "Reminder times must use HH:MM")
            med = Medication(patient_id=row.patient_id, name=body.medicine.strip(), dose=body.dose,
                             frequency=body.frequency, times=sorted(set(body.times)), instructions=body.instructions,
                             start=datetime.now(), active=True)
            db.add(med)
            db.flush()
            row.medication_id = med.id
        if body.evidence_url and not body.evidence_url.startswith("https://"):
            raise HTTPException(422, "Evidence URL must use HTTPS")
        row.draft = {"medicine": body.medicine, "dose": body.dose, "frequency": body.frequency,
                     "times": body.times, "instructions": body.instructions, "checks": checks,
                     "evidence_url": body.evidence_url, "signed": True}
        row.status = "approved"
        if row.kind == "plan":
            old=[r for r in records(db,row.patient_id,"roadmap") if r.status=="approved"]
            data={**(old[0].data if old else {}),"text":body.reason,"source":f"approval {row.id}"}
            db.add(CareRecord(patient_id=row.patient_id,kind="roadmap",author_id=user.id,author_name=user.name,author_role=user.role,
                              data=data,status="approved",approved_by=user.name,approved_at=utcnow()))
    else:
        row.status = "reviewing" if body.action == "reviewing" else "rejected"
    row.reason, row.reviewed_by, row.updated_at = body.reason, user.name, utcnow()
    db.commit()
    append_audit(db, user, "clinical_" + row.status, row.patient_id, f"Request {row.id}")
    notify_team(db, row.patient_id, "Doctor reviewed your request", "Request status: " + row.status)
    return approval_dict(row, user)


@router.get("/v2/alerts")
def alerts(request: Request, db=Depends(get_db)):
    user = identity(request)
    ids = visible_ids(db, user, "alerts")
    return [serial(a) | {"patient_name": db.get(Patient, a.patient_id).name,
                         "call_script": "Confirm identity and location. Ask onset and severity. Review the red flag. Escalate to the treating doctor; emergency symptoms require immediate emergency care.",
                         "ladder": ["Duty nurse", "Treating doctor", "Emergency department"]}
            for a in db.scalars(select(Alert).where(Alert.patient_id.in_(ids)).order_by(Alert.id.desc()).limit(100))]


class AlertAction(BaseModel):
    action: Literal["acknowledge", "call", "escalate", "resolve", "arrived"]
    outcome: str = Field(min_length=3, max_length=3000)


@router.post("/v2/alerts/{alert_id}/action")
def act_alert(alert_id: int, body: AlertAction, request: Request, db=Depends(get_db)):
    row = db.get(Alert, alert_id)
    if not row:
        raise HTTPException(404, "Alert not found")
    user = patient_access(db, request, row.patient_id, "alerts")
    roles(user, "nurse", "doctor", "admin")
    row.status = {"acknowledge": "acknowledged", "call": "called", "escalate": "escalated", "resolve": "resolved", "arrived": "arrived"}[body.action]
    row.outcome = (row.outcome + f"\n{utcnow().isoformat()} {user.name}: {body.outcome}").strip()
    row.assigned_to = user.name
    if body.action == "arrived" and not row.arrival_at:
        row.arrival_at = utcnow()
    db.commit()
    append_audit(db, user, "triage_" + body.action, row.patient_id, body.outcome)
    return serial(row)


class InviteIn(BaseModel):
    username: str = Field(min_length=3, max_length=100, pattern=r"^[a-z0-9_.@+-]+$")
    name: str = Field(min_length=2, max_length=100)
    password: str = Field(min_length=12, max_length=200)
    scopes: list[Literal["medicines", "appointments", "checkin", "alerts", "chat", "notes", "documents", "nutrition", "finance", "activity"]] = Field(min_length=1)
    consent: bool
    phone: str = Field(default="", max_length=20)


@router.get("/v2/patients/{patient_id}/circle")
def circle(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id)
    roles(user, "patient", "doctor", "nurse", "admin")
    return [{"id": g.id, "name": db.get(User, g.user_id).name, "username": db.get(User, g.user_id).username, "sign_in_id": sign_in_id(db, db.get(User, g.user_id)),
             "role": db.get(User, g.user_id).role, "scopes": g.scopes, "active": g.active, "consent_by": g.consent_by}
            for g in db.scalars(select(AccessGrant).where(AccessGrant.patient_id == patient_id))]


@router.post("/v2/patients/{patient_id}/circle")
def invite(patient_id: str, body: InviteIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id)
    roles(user, "patient")
    if not body.consent:
        raise HTTPException(422, "Patient consent is required")
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(409, "Choose a new caregiver username")
    if body.phone and not re.fullmatch(r"\+?[0-9]{10,15}", body.phone):
        raise HTTPException(422, "Enter an international phone number without spaces")
    u = User(username=body.username, name=body.name, role="caregiver", password_hash=password_hash(body.password), phone=body.phone)
    db.add(u)
    db.flush()
    g = AccessGrant(user_id=u.id, patient_id=patient_id, scopes=sorted(set(body.scopes)), consent_by=user.name)
    db.add(g)
    db.commit()
    append_audit(db, user, "caregiver_consent", patient_id, body.username + ": " + ",".join(body.scopes))
    return {"id": g.id, "username": u.username, "sign_in_id": sign_in_id(db, u)}


@router.delete("/v2/circle/{grant_id}")
def remove_circle(grant_id: int, request: Request, db=Depends(get_db)):
    row = db.get(AccessGrant, grant_id)
    if not row:
        raise HTTPException(404, "Invitation not found")
    user = patient_access(db, request, row.patient_id)
    roles(user, "patient")
    if db.get(User, row.user_id).role != "caregiver":
        raise HTTPException(403, "Only caregiver consent can be withdrawn here")
    row.active = False
    db.commit()
    append_audit(db, user, "revoke_caregiver_consent", row.patient_id, str(grant_id))
    return {"ok": True}


class BreakGlass(BaseModel):
    patient_id: str
    reason: str = Field(min_length=15, max_length=1000)


@router.post("/v2/break-glass")
def break_glass(body: BreakGlass, request: Request, db=Depends(get_db)):
    # This endpoint intentionally does not use patient_access: it creates temporary emergency access.
    user = identity(request)
    roles(user, "doctor", "nurse")
    if not db.get(Patient, body.patient_id):
        raise HTTPException(404, "Patient not found")
    old = db.scalar(select(AccessGrant).where(AccessGrant.patient_id == body.patient_id, AccessGrant.user_id == user.id))
    if old and old.active and (not old.expires_at or old.expires_at > utcnow()):
        raise HTTPException(409, "You already have access")
    grant = old or AccessGrant(patient_id=body.patient_id, user_id=user.id)
    grant.active, grant.scopes, grant.expires_at = True, ["all"], utcnow() + timedelta(minutes=15)
    grant.consent_by = "Emergency access: " + body.reason
    db.add(grant)
    for officer in db.scalars(select(User).where(User.role.in_(["privacy", "admin"]))):
        db.add(Notification(user_id=officer.id, title="Break-glass access", body=f"{user.name} opened {body.patient_id}: {body.reason}"))
    db.commit()
    append_audit(db, user, "break_glass", body.patient_id, body.reason)
    return {"expires_at": grant.expires_at}


@router.get("/v2/audit/verify")
def audit_integrity(request: Request, db=Depends(get_db)):
    identity(request)
    return verify_chain(db)


@router.get("/v2/patients/{patient_id}/audit")
def patient_audit(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "audit")
    from ..round2_models import AuditChain
    return [serial(r, ("actor_id", "previous_hash")) for r in db.scalars(select(AuditChain).where(AuditChain.patient_id == patient_id).order_by(AuditChain.id.desc()).limit(200))]


@router.get("/v2/library")
def library(request: Request, db=Depends(get_db)):
    user = identity(request)
    rows = db.scalars(select(LibraryItem)).all()
    return [serial(r) for r in rows if r.approved_by or user.role in {"doctor", "dietitian", "admin"}]


@router.post("/v2/library/{item_id}/approve")
def approve_library(item_id: int, request: Request, db=Depends(get_db)):
    user = identity(request)
    roles(user, "doctor", "dietitian", "admin")
    row = db.get(LibraryItem, item_id)
    if not row:
        raise HTTPException(404, "Library item not found")
    if row.category != "food":
        roles(user, "doctor")
    reviews = {**row.content.get("_reviews", {}), user.role: user.name}
    row.content = {**row.content, "_reviews": reviews}
    required = {"doctor", "dietitian"} if row.category == "food" else {"doctor"}
    if required.issubset(reviews):
        row.approved_by, row.approved_at = "; ".join(reviews[r] for r in sorted(required)), utcnow()
    db.commit()
    append_audit(db, user, "approve_library", detail=row.key)
    return serial(row)


@router.get("/v2/patients/{patient_id}/wellness")
def wellness(patient_id: str, request: Request, db=Depends(get_db)):
    patient_access(db, request, patient_id, "nutrition")
    sy = records(db, patient_id, "checkin")
    latest = sy[0].data if sy else {}
    labs = living_summary(db, patient_id)["latest_labs"]
    low_counts = any(l["test"] == "ANC" and l["value"] < 1.5 for l in labs)
    fatigue = latest.get("fatigue", 0)
    keys = {"food_safety", "soft_food" if "mouth" in latest.get("text", "").lower() else "meals", "rest" if fatigue >= 2 or low_counts else "activity", "mood", "seasonal"}
    approved = db.scalars(select(LibraryItem).where(LibraryItem.approved_by.is_not(None), LibraryItem.key.in_(keys))).all()
    prefs = records(db, patient_id, "preferences")
    diet = prefs[0].data.get("diet", "vegetarian") if prefs else "vegetarian"
    return {"low_counts": low_counts, "fatigue": fatigue, "diet": diet,
            "guidance": [serial(r) for r in approved],
            "meal_plan": [{"day": i + 1, "suggestion": r.content.get(diet, r.content.get("en", "")), "library_id": r.id}
                          for i in range(7) for r in approved if r.key in {"meals", "soft_food"}],
            "activity": "Choose a seated puzzle, gentle breathing or a short hobby break." if fatigue >= 2 or low_counts else "Ask your team whether a short walk or gentle yoga fits today's plan.",
            "activity_gate": "Discuss activity and crowd exposure with your team while counts are low." if low_counts else None,
            "library_ready": bool(approved)}


@router.get("/v2/patients/{patient_id}/visit-prep")
def visit_prep(patient_id: str, request: Request, db=Depends(get_db)):
    patient_access(db, request, patient_id, "notes")
    prefs = records(db, patient_id, "preferences")
    checkins = records(db, patient_id, "checkin")[:7]
    questions = ["What is the next step in my signed plan?", "Which changes should make me contact the team immediately?"]
    if prefs and prefs[0].data.get("worries"):
        questions.insert(0, "I want to discuss: " + prefs[0].data["worries"])
    for c in checkins[:3]:
        if c.data.get("text"):
            questions.append("Can we review this symptom report: " + c.data["text"][:200])
    return {"questions": questions, "pending_requests": len(db.scalars(select(Approval).where(Approval.patient_id == patient_id, Approval.status.in_(["sent", "reviewing"]))).all())}


@router.get("/v2/patients/{patient_id}/week")
def week(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "activity")
    since = utcnow() - timedelta(days=7)
    checkins = [r for r in records(db, patient_id, "checkin") if r.created_at > since]
    days = sorted({r.created_at.date().isoformat() for r in checkins})
    logs = db.scalars(select(MedLog).where(MedLog.patient_id == patient_id, MedLog.logged_at > since)).all()
    summary = {"checkin_days": len(days), "days": days, "doses_taken": sum(l.status == "taken" for l in logs),
               "doses_missed": sum(l.status == "missed" for l in logs),
               "garden_stage": min(5, len(days)), "mood": [10 - r.data.get("distress", 0) for r in reversed(checkins)]}
    if user.role != "patient":
        acts = db.scalars(select(Activity).where(Activity.patient_id == patient_id, Activity.date > since)).all()
        summary["steps"] = sum(a.steps for a in acts)
        summary["best_day"] = max(acts, key=lambda a: a.steps).date.date().isoformat() if acts else None
    return summary


class ActivityIn(BaseModel):
    steps: int = Field(ge=0, le=200000)
    sleep_hours: float = Field(ge=0, le=24)
    resting_hr: int = Field(ge=20, le=250)


@router.post("/v2/patients/{patient_id}/activity")
def add_activity(patient_id: str, body: ActivityIn, request: Request, db=Depends(get_db)):
    patient_access(db, request, patient_id, "activity")
    day = hospital_now().replace(hour=0, minute=0, second=0, microsecond=0)
    row = db.scalar(select(Activity).where(Activity.patient_id == patient_id, Activity.date == day))
    if not row:
        row = Activity(patient_id=patient_id, date=day)
        db.add(row)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    db.commit()
    return {"ok": True, "source": "manual entry"}


class WearablePointIn(BaseModel):
    observed_at: datetime
    metric: Literal["heart_rate", "spo2", "systolic", "diastolic", "steps", "distance_km", "active_minutes", "sleep_hours", "temperature_c"]
    value: float = Field(allow_inf_nan=False)
    unit: str = Field(max_length=12)


class WearableBatchIn(BaseModel):
    consent: bool
    source: Literal["bluetooth", "android_ble", "health_connect", "healthkit", "vendor", "manual"] = "bluetooth"
    device_name: str = Field(default="", max_length=100)
    readings: list[WearablePointIn] = Field(min_length=1, max_length=100)


class WearableDeviceIn(BaseModel):
    consent: bool
    device_name: str = Field(default="OncoBrief Android companion", max_length=100)


class VitalAlertProtocolIn(BaseModel):
    thresholds: dict[str, float] = Field(max_length=5)
    source_url: str = Field(pattern=r"^https://", max_length=1000)
    rationale: str = Field(min_length=10, max_length=3000)


WEARABLE_UNITS = {
    "heart_rate": "bpm", "spo2": "%", "systolic": "mmHg", "diastolic": "mmHg",
    "steps": "steps", "distance_km": "km", "active_minutes": "min",
    "sleep_hours": "h", "temperature_c": "°C",
}
ACTIVITY_METRICS = {"steps", "distance_km", "active_minutes", "sleep_hours"}
WEARABLE_RANGES = {
    "heart_rate": (20, 260), "spo2": (50, 100), "systolic": (50, 280), "diastolic": (25, 180),
    "steps": (0, 200000), "distance_km": (0, 150), "active_minutes": (0, 1440),
    "sleep_hours": (0, 24), "temperature_c": (25, 45),
}


@router.post("/v2/patients/{patient_id}/wearable-devices")
def create_wearable_device(patient_id: str, body: WearableDeviceIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "activity")
    roles(user, "patient", "caregiver")
    if not body.consent:
        raise HTTPException(422, "Explicit consent is required before linking a background wearable")
    active_credentials = db.scalar(select(func.count(WearableDeviceCredential.id)).where(
        WearableDeviceCredential.patient_id == patient_id,
        WearableDeviceCredential.user_id == user.id,
        WearableDeviceCredential.revoked.is_(False),
        WearableDeviceCredential.expires_at > utcnow(),
    )) or 0
    if active_credentials >= 5:
        raise HTTPException(409, "Revoke an existing Android companion before linking another one")
    token = secrets.token_urlsafe(32)
    row = WearableDeviceCredential(
        patient_id=patient_id,
        user_id=user.id,
        token_hash=digest(token),
        device_name=body.device_name.strip() or "Android wearable companion",
        expires_at=utcnow() + timedelta(days=90),
    )
    db.add(row)
    db.commit()
    append_audit(db, user, "wearable_device_linked", patient_id, f"Credential {row.id}; expires in 90 days")
    return {"id": row.id, "token": token, "patient_id": patient_id,
            "device_name": row.device_name, "expires_at": row.expires_at.isoformat() + "Z"}


@router.get("/v2/patients/{patient_id}/wearable-devices")
def wearable_devices(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "activity")
    roles(user, "patient", "caregiver")
    rows = db.scalars(select(WearableDeviceCredential).where(
        WearableDeviceCredential.patient_id == patient_id
    ).order_by(WearableDeviceCredential.id.desc()).limit(50)).all()
    return [{
        "id": row.id,
        "device_name": row.device_name,
        "created_at": row.created_at.isoformat() + "Z",
        "last_seen": row.last_seen.isoformat() + "Z" if row.last_seen else None,
        "expires_at": row.expires_at.isoformat() + "Z",
        "revoked": row.revoked,
        "can_revoke": user.role == "patient" or row.user_id == user.id,
    } for row in rows if user.role == "patient" or row.user_id == user.id]


@router.delete("/v2/patients/{patient_id}/wearable-devices/{device_id}")
def revoke_wearable_device(patient_id: str, device_id: int, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "activity")
    roles(user, "patient", "caregiver")
    row = db.get(WearableDeviceCredential, device_id)
    if not row or row.patient_id != patient_id or (user.role != "patient" and row.user_id != user.id):
        raise HTTPException(404, "Wearable device not found")
    row.revoked = True
    db.commit()
    append_audit(db, user, "wearable_device_revoked", patient_id, f"Credential {row.id}")
    return {"ok": True}


@router.post("/v2/patients/{patient_id}/vital-alert-protocol")
def sign_vital_alert_protocol(patient_id: str, body: VitalAlertProtocolIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "activity")
    roles(user, "doctor")
    allowed = {"heart_rate", "spo2", "systolic", "diastolic", "temperature_c"}
    if not body.thresholds or set(body.thresholds) - allowed:
        raise HTTPException(422, "Provide at least one supported vital with a minimum review threshold")
    for metric, value in body.thresholds.items():
        low, high = WEARABLE_RANGES[metric]
        if not math.isfinite(value) or value < low or value > high:
            raise HTTPException(422, f"Invalid minimum review threshold for {metric}")
    for previous in db.scalars(select(CareRecord).where(
        CareRecord.patient_id == patient_id, CareRecord.kind == "vital_alert_protocol",
        CareRecord.status == "approved",
    )):
        previous.status = "superseded"
    row = CareRecord(
        patient_id=patient_id, kind="vital_alert_protocol", author_id=user.id,
        author_name=user.name, author_role=user.role, status="approved",
        approved_by=user.name, approved_at=utcnow(),
        data={"thresholds": body.thresholds, "source_url": body.source_url, "rationale": body.rationale},
    )
    db.add(row)
    db.commit()
    append_audit(db, user, "sign_vital_alert_protocol", patient_id)
    return serial(row)


@router.get("/v2/patients/{patient_id}/wearables")
def wearable_history(patient_id: str, request: Request, days: int = 30, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "activity")
    days = min(365, max(1, days))
    since = utcnow() - timedelta(days=days)
    statement = select(WearableReading).where(
        WearableReading.patient_id == patient_id, WearableReading.observed_at >= since
    )
    if user.role == "patient":
        statement = statement.where(WearableReading.metric.notin_(ACTIVITY_METRICS))
    rows = db.scalars(statement.order_by(WearableReading.observed_at.desc()).limit(5000)).all()
    rows.reverse()
    payload = {"days": days, "items": [serial(row) for row in rows]}
    if user.role != "patient":
        payload["activity_threshold_steps"] = low_activity_steps_threshold()
        protocol = current_vital_alert_protocol(db, patient_id)
        payload["vital_thresholds"] = protocol.data.get("thresholds", {}) if protocol else {}
        payload["vital_protocol"] = {
            "source_url": protocol.data.get("source_url", ""),
            "rationale": protocol.data.get("rationale", ""),
            "approved_by": protocol.approved_by,
            "approved_at": protocol.approved_at.isoformat() + "Z" if protocol.approved_at else None,
        } if protocol else None
    return payload


@router.post("/v2/patients/{patient_id}/wearables")
def save_wearable_readings(patient_id: str, body: WearableBatchIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "activity")
    roles(user, "patient", "caregiver")
    if not body.consent:
        raise HTTPException(422, "Explicit consent is required before saving wearable readings")
    if getattr(request.state, "wearable_device_id", None) and body.source != "android_ble":
        raise HTTPException(422, "A background device credential can only upload Android Bluetooth readings")
    saved = []
    for point in body.readings:
        if point.unit != WEARABLE_UNITS[point.metric]:
            raise HTTPException(422, f"Use {WEARABLE_UNITS[point.metric]} for {point.metric}")
        low, high = WEARABLE_RANGES[point.metric]
        if point.value < low or point.value > high:
            raise HTTPException(422, f"{point.metric} reading is outside the accepted storage range")
        observed_at = point.observed_at
        if observed_at.tzinfo is not None:
            observed_at = observed_at.astimezone(timezone.utc).replace(tzinfo=None)
        if observed_at > utcnow() + timedelta(minutes=5):
            raise HTTPException(422, "A wearable reading cannot be more than five minutes in the future")
        row = WearableReading(
            patient_id=patient_id, metric=point.metric, value=point.value, unit=point.unit,
            observed_at=observed_at, source=body.source, device_name=body.device_name.strip()[:100],
        )
        db.add(row)
        saved.append(row)
    append_audit(db, user, "wearable_readings_saved", patient_id,
                 f"{len(saved)} {body.source} readings; device name only")
    db.commit()
    if body.source != "manual":
        evaluate_vital_readings(db, patient_id, saved)
    return {"saved": len(saved), "source": body.source}

@router.get("/v2/patients/{patient_id}/clinical")
def clinical_dashboard(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "doctor", "nurse", "patient", "caregiver")
    p = db.get(Patient, patient_id)
    summary = living_summary(db, patient_id)
    latest = {l["test"]: l for l in summary["latest_labs"]}
    # Thresholds are supplied by the treating doctor in the local protocol, never universal.
    threshold_rows = records(db, patient_id, "readiness_protocol")
    protocol = threshold_rows[0].data if threshold_rows else {}
    readiness = []
    for test in ["ANC", "Platelets", "Haemoglobin", "Creatinine", "ALT", "AST", "Bilirubin"]:
        lab = latest.get(test)
        cutoff = protocol.get(test)
        result = "Check: local protocol required"
        if not lab:
            result = "Check: result missing"
        elif (hospital_now() - datetime.fromisoformat(lab["date"])).days > protocol.get("max_age_days", 3):
            result = "Check: result needs refreshing"
        elif cutoff:
            result = "Within signed threshold" if cutoff.get("min", -1e9) <= lab["value"] <= cutoff.get("max", 1e9) else "Check: outside signed threshold"
        readiness.append({"test": test, "lab": lab, "result": result})
    totals = {}
    for r in records(db, patient_id, "administration"):
        key = r.data["drug"].lower() + "|" + r.data["unit"]
        item = totals.setdefault(key, {"drug": r.data["drug"], "unit": r.data["unit"], "total": 0, "limit": r.data.get("lifetime_limit")})
        item["total"] += r.data["dose"]
    for item in totals.values():
        item["warning"] = bool(item["limit"] and item["total"] >= item["limit"] * .8)
    all_labs = db.scalars(select(LabValue).where(LabValue.patient_id == patient_id).order_by(LabValue.measured_at)).all()
    baselines = []
    for test in {l.test for l in all_labs}:
        ls = [l for l in all_labs if l.test == test]
        if len(ls) >= 4:
            mean = sum(l.value for l in ls[-4:-1]) / 3
            if mean and ls[-1].value < mean * .8:
                baselines.append({"test": test, "latest": ls[-1].value, "previous_mean": round(mean, 2), "source": f"D{ls[-1].document_id}"})
    measurements = [serial(r) for r in reversed(records(db, patient_id, "measurement"))]
    docs = db.scalars(select(Document).where(Document.patient_id == patient_id).order_by(Document.record_date.desc())).all()
    suggestions = []
    for d in docs:
        if d.category != "Imaging":
            continue
        for m in re.finditer(r"(?P<label>[A-Za-z][A-Za-z -]{0,40}?)\s+(?:measures?\s+)?(?P<size>\d+(?:\.\d+)?)\s*(?P<unit>cm|mm)\b", safe_text(d.ocr_text), re.I):
            suggestions.append({"document_id": d.id, "date": d.record_date.isoformat(), "text": m.group(0),
                                "size_mm": float(m.group("size")) * (10 if m.group("unit").lower() == "cm" else 1), "status": "needs clinician confirmation"})
    changes = []
    import difflib
    grouped = {}
    for d in docs:
        grouped.setdefault(d.subtype, []).append(d)
    for subtype, ds in grouped.items():
        if len(ds) >= 2:
            changes.append({"subtype": subtype, "from": f"D{ds[1].id}", "to": f"D{ds[0].id}",
                            "lines": list(difflib.unified_diff(safe_text(ds[1].ocr_text).splitlines(), safe_text(ds[0].ocr_text).splitlines(), n=1))[:120]})
    roads = [r for r in records(db, patient_id, "roadmap") if r.status == "approved"]
    checks = records(db, patient_id, "checkin")
    forecast = []
    road = roads[0].data if roads else {}
    if road.get("cycle_start"):
        start = datetime.fromisoformat(road["cycle_start"])
        cycle_days = int(road.get("cycle_days", 21))
        for day in range(1, min(cycle_days, 90) + 1):
            past = [c for c in checks if c.created_at < start and ((start - c.created_at).days % cycle_days) == (cycle_days - day + 1) % cycle_days]
            actual = [c for c in checks if (c.created_at.date() - start.date()).days == day - 1]
            forecast.append({"day": day, "expected": round(sum(c.data.get("nausea", 0) + c.data.get("fatigue", 0) for c in past) / len(past), 1) if past else None,
                             "actual": sum(actual[0].data.get(k, 0) for k in ("nausea", "fatigue")) if actual else None,
                             "samples": len(past)})
    cohort = None
    if not DEMO_MODE and os.getenv("COHORT_ANALYTICS_CONSENT") == "true" and user.role == "doctor":
        peers = db.scalars(select(Patient).where(Patient.id.in_(visible_ids(db, user, "documents")), Patient.cancer_type == p.cancer_type, Patient.stage == p.stage)).all()
        outcomes = [r for peer in peers for r in records(db, peer.id, "outcome")[:1] if r.data.get("regimen") == p.current_regimen]
        if len(outcomes) >= 10:
            cohort = {"n": len(outcomes), "responses": {s: sum(r.data.get("response") == s for r in outcomes) for s in ["complete", "partial", "stable", "progression", "not_assessed"]},
                      "note": "Descriptive outcomes from authorized, consented local records; no causal treatment comparison."}
    data = {"readiness": readiness, "readiness_status": "Doctor confirmation required", "protocol": protocol,
            "cumulative": list(totals.values()), "baselines": baselines, "measurements": measurements,
            "extracted_measurements": suggestions, "changes": changes, "roadmap": road, "forecast": forecast,
            "journey": [{"date": d.record_date.isoformat(), "title": d.title, "id": d.id} for d in reversed(docs)],
            "pain": [serial(r) for r in reversed(records(db, patient_id, "pain"))],
            "evidence": {"guideline": "https://www.cancer.gov/about-cancer/treatment", "cohort": cohort,
                         "note": "No cross-hospital outcome dataset configured. Local counts require consent and at least 10 matching real patients. Demo outcomes are never used as evidence."}}
    if user.role not in CLINICIANS:
        data = {k: data[k] for k in ("measurements", "roadmap", "forecast", "journey", "pain")}
        if patient_id not in visible_ids(db,user,"checkin"):
            data["forecast"],data["pain"]=[],[]
    return data


class ProtocolIn(BaseModel):
    thresholds: dict[str, dict[str, float]]
    max_age_days: int = Field(ge=1, le=30)
    source_url: str = Field(pattern=r"^https://", max_length=1000)
    rationale: str = Field(min_length=10, max_length=3000)


@router.post("/v2/patients/{patient_id}/readiness-protocol")
def protocol(patient_id: str, body: ProtocolIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "doctor")
    for test, bounds in body.thresholds.items():
        if test not in {"ANC", "Platelets", "Haemoglobin", "Creatinine", "ALT", "AST", "Bilirubin"} or set(bounds) - {"min", "max"}:
            raise HTTPException(422, "Unsupported test or threshold")
        if not bounds or any(not math.isfinite(v) for v in bounds.values()) or bounds.get("min", -1e12) > bounds.get("max", 1e12):
            raise HTTPException(422, "Invalid protocol thresholds")
    row = CareRecord(patient_id=patient_id, kind="readiness_protocol", author_id=user.id, author_name=user.name, author_role=user.role,
                     status="approved", approved_by=user.name, approved_at=utcnow(),
                     data=body.thresholds | {"max_age_days": body.max_age_days, "source_url": body.source_url, "rationale": body.rationale})
    db.add(row)
    db.commit()
    append_audit(db, user, "sign_readiness_protocol", patient_id)
    return serial(row)


@router.get("/v2/patients/{patient_id}/day-pass")
def day_pass(patient_id: str, request: Request, day: str = "", db=Depends(get_db)):
    patient_access(db, request, patient_id, "appointments")
    try:
        start = datetime.fromisoformat(day) if day else hospital_now().replace(hour=0, minute=0, second=0, microsecond=0)
    except ValueError:
        raise HTTPException(422, "Use YYYY-MM-DD")
    end = start + timedelta(days=1)
    appts = db.scalars(select(Appointment).where(Appointment.patient_id == patient_id, Appointment.start >= start, Appointment.start < end).order_by(Appointment.start)).all()
    out = []
    from ..services.google_meet import public_visit
    for a in appts:
        ahead = db.scalars(select(Appointment).where(Appointment.department == a.department, Appointment.start >= start,
                                                      Appointment.start < a.start, Appointment.status.in_(["arrived", "in_progress", "booked"]))).all()
        visit = db.scalar(select(VirtualAppointment).where(VirtualAppointment.appointment_id == a.id))
        out.append(serial(a) | {"ahead": len(ahead), "wait_minutes": len(ahead) * 20,
                                "virtual_visit": public_visit(visit),
                                "directions": f"Ask reception for {a.department}, {a.room}. Indoor walking routes require your hospital map."})
    prefs = records(db, patient_id, "preferences")
    address = os.getenv("HOSPITAL_ADDRESS", "")
    return {"date": start.date().isoformat(), "patient_id": patient_id, "stops": out,
            "trip_count": len({a.start.date() for a in appts}),
            "stays_url": "https://www.google.com/maps/search/" + quote("patient accommodation near " + address) if address else None,
            "gate_url": f"/app?gate={patient_id}", "map_configured": bool(address)}


TRANSPORT_ROLES = {"frontdesk", "navigator", "nurse", "admin"}


class TransportRequestIn(BaseModel):
    appointment_id: int = Field(gt=0)
    pickup_at: datetime
    pickup_address: str = Field(min_length=5, max_length=300)
    landmark: str = Field(default="", max_length=150)
    ride_type: Literal["uber", "rapido", "hospital", "caregiver"] = "uber"
    support: list[Literal["mobility_assistance", "caregiver_accompanying", "wheelchair_accessible"]] = Field(default_factory=list, max_length=3)
    companion_count: int = Field(default=0, ge=0, le=4)
    fare_support: bool = False
    notes: str = Field(default="", max_length=500)
    consent: bool
    location_consent: bool = False


class TransportLocationIn(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0, le=100000)


class TransportUpdateIn(BaseModel):
    status: Literal["coordinating", "arranged", "unable", "completed"]
    arranged_via: str = Field(default="", max_length=120)
    confirmed_pickup_at: datetime | None = None
    coordination_note: str = Field(default="", max_length=500)


def transport_payload(db, row):
    data = dict(row.data or {})
    # Precise coordinates are available only through the consented live-share endpoint.
    data.pop("location", None)
    data.pop("location_share_id", None)
    appointment = db.get(Appointment, data.get("appointment_id")) if data.get("appointment_id") else None
    patient = db.get(Patient, row.patient_id)
    out = serial(row) | {"data": data, "patient_name": patient.name if patient else ""}
    out["appointment"] = ({"id": appointment.id, "department": appointment.department,
                           "room": appointment.room, "start": appointment.start.isoformat(),
                           "status": appointment.status} if appointment else None)
    out["delivery_summary"] = (row.data or {}).get("delivery_summary", {})
    return out


def notify_transport_coordinators(db, patient_id, title, body):
    now = utcnow()
    grants = db.scalars(select(AccessGrant).where(AccessGrant.patient_id == patient_id, AccessGrant.active.is_(True))).all()
    count = 0
    for grant in grants:
        coordinator = db.get(User, grant.user_id)
        if (coordinator and coordinator.active and coordinator.role in TRANSPORT_ROLES
                and (not grant.expires_at or grant.expires_at > now)
                and ("all" in grant.scopes or "appointments" in grant.scopes)):
            db.add(Notification(user_id=coordinator.id, patient_id=patient_id, channel="transport", title=title, body=body))
            count += 1
    db.commit()
    return count


def transport_caregivers(db, patient_id):
    now = utcnow()
    grants = db.scalars(select(AccessGrant).where(
        AccessGrant.patient_id == patient_id, AccessGrant.active.is_(True)
    )).all()
    people = []
    for grant in grants:
        caregiver = db.get(User, grant.user_id)
        if (caregiver and caregiver.active and caregiver.role == "caregiver"
                and (not grant.expires_at or grant.expires_at > now)
                and ("all" in grant.scopes or "appointments" in grant.scopes)):
            people.append(caregiver)
    return people


def transport_external_recipients(db, patient_id, target):
    recipients = []
    sms_ready = bool(os.getenv("SMS_ADAPTER_URL") and os.getenv("SMS_ADAPTER_KEY"))
    email_ready = bool(os.getenv("EMAIL_ADAPTER_URL") and os.getenv("EMAIL_ADAPTER_KEY"))

    def add_contact(phone, email, name):
        if phone and sms_ready:
            recipients.append(("sms", phone, name))
        elif email and email_ready:
            recipients.append(("email", email, name))
        elif phone:
            recipients.append(("sms", phone, name))
        elif email:
            recipients.append(("email", email, name))

    if target in {"hospital", "both"}:
        phone = os.getenv("HOSPITAL_TRANSPORT_PHONE", "").strip()
        email = os.getenv("HOSPITAL_TRANSPORT_EMAIL", "").strip()
        if phone or email:
            add_contact(phone, email, "Hospital transport desk")
        else:
            recipients.append(("pending", "", "Hospital transport desk"))
    if target in {"caregiver", "both"}:
        caregivers = transport_caregivers(db, patient_id)
        if not caregivers:
            recipients.append(("pending", "", "Linked caregiver"))
        for caregiver in caregivers:
            phone = (caregiver.phone or "").strip()
            email = caregiver.username.strip() if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", caregiver.username.strip()) else ""
            if phone or email:
                add_contact(phone, email, caregiver.name)
            else:
                recipients.append(("pending", "", caregiver.name))
    return list({(channel, address): (channel, address, name)
                 for channel, address, name in recipients}.values())


def notify_transport_caregivers(db, patient_id, title, body):
    for caregiver in transport_caregivers(db, patient_id):
        db.add(Notification(user_id=caregiver.id, patient_id=patient_id, channel="transport",
                            title=title, body=body))
    db.commit()


def revoke_transport_location(db, row, status="stopped"):
    data = dict(row.data or {})
    data["location_sharing"] = status
    data.pop("location", None)
    share_id = data.get("location_share_id")
    if share_id:
        share = db.get(ShareLink, share_id)
        if share:
            share.revoked = True
    row.data = data


def send_transport_messages(db, patient_id, appointment, pickup_at, target, location_url, request_data):
    results = []
    recipients = transport_external_recipients(db, patient_id, target)
    for channel, address, name in recipients:
        if channel == "pending":
            results.append({"recipient": name, "channel": "sms/email", "status": "not_configured"})
            continue
        text = (f"OncoBrief transport request for patient {patient_id}. "
                f"Pickup requested {pickup_at:%d %b %Y at %H:%M}. "
                f"Pickup address: {request_data.get('pickup_address', '')}. "
                f"Appointment: {appointment.department} on {appointment.start:%d %b %Y at %H:%M}.")
        if request_data.get("landmark"):
            text += f" Landmark: {request_data['landmark']}."
        support = request_data.get("support", [])
        support_labels = {"mobility_assistance": "mobility assistance",
                          "wheelchair_accessible": "wheelchair-accessible vehicle",
                          "caregiver_accompanying": "caregiver travelling"}
        if support:
            text += " Accessibility/support: " + ", ".join(support_labels.get(value, value) for value in support) + "."
        if request_data.get("fare_support"):
            text += " Travel-cost support requested."
        if location_url:
            text += f" Live trip location (available only while sharing): {location_url}"
        try:
            if channel == "sms":
                deliver("sms", {"to": address, "body": text})
            else:
                deliver("email", {"to": address, "subject": "OncoBrief transport request", "body": text})
            results.append({"recipient": name, "channel": channel, "status": "accepted"})
        except HTTPException as exc:
            results.append({"recipient": name, "channel": channel,
                            "status": "not_configured" if exc.status_code == 503 else "failed"})
        except Exception:
            results.append({"recipient": name, "channel": channel, "status": "failed"})
    return results


@router.post("/v2/transport-requests/{request_id}/location/start")
def start_transport_location(request_id: int, request: Request, db=Depends(get_db)):
    row = db.get(CareRecord, request_id)
    if not row or row.kind != "transport_request":
        raise HTTPException(404, "Transport request not found")
    user = patient_access(db, request, row.patient_id, "appointments")
    roles(user, "patient", "caregiver")
    data = dict(row.data or {})
    if not data.get("location_consent"):
        raise HTTPException(403, "The patient has not consented to live-location sharing")
    if row.status in {"completed", "cancelled", "unable"}:
        raise HTTPException(409, "This transport request is closed")
    share = db.get(ShareLink, data.get("location_share_id")) if data.get("location_share_id") else None
    if not share or share.revoked or share.expires_at < utcnow():
        raise HTTPException(410, "The trip location link has expired")
    data["location_sharing"] = "active"
    data["location_started_at"] = utcnow().isoformat()
    data.pop("location", None)
    row.data, row.updated_at = data, utcnow()
    db.commit()
    append_audit(db, user, "transport_location_started", row.patient_id, f"Request {row.id}")
    return {"status": "active"}


@router.post("/v2/transport-requests/{request_id}/location")
def update_transport_location(request_id: int, body: TransportLocationIn, request: Request, db=Depends(get_db)):
    row = db.get(CareRecord, request_id)
    if not row or row.kind != "transport_request":
        raise HTTPException(404, "Transport request not found")
    user = patient_access(db, request, row.patient_id, "appointments")
    roles(user, "patient", "caregiver")
    data = dict(row.data or {})
    if not data.get("location_consent") or data.get("location_sharing") != "active":
        raise HTTPException(409, "Start consented trip sharing before sending a location")
    share = db.get(ShareLink, data.get("location_share_id")) if data.get("location_share_id") else None
    if not share or share.revoked or share.expires_at < utcnow():
        raise HTTPException(410, "The trip location link has expired")
    observed_at = utcnow()
    data["location"] = {"latitude": body.latitude, "longitude": body.longitude,
                        "accuracy_m": body.accuracy_m, "observed_at": observed_at.isoformat()}
    row.data, row.updated_at = data, observed_at
    db.commit()
    return {"status": "active", "updated_at": observed_at.isoformat()}


@router.post("/v2/transport-requests/{request_id}/location/stop")
def stop_transport_location(request_id: int, request: Request, db=Depends(get_db)):
    row = db.get(CareRecord, request_id)
    if not row or row.kind != "transport_request":
        raise HTTPException(404, "Transport request not found")
    user = patient_access(db, request, row.patient_id, "appointments")
    roles(user, "patient", "caregiver")
    data = dict(row.data or {})
    if data.get("location_consent"):
        revoke_transport_location(db, row)
        row.updated_at = utcnow()
        db.commit()
        append_audit(db, user, "transport_location_stopped", row.patient_id, f"Request {row.id}")
    return {"status": "stopped"}


@router.get("/shared/transport/{token}")
def shared_transport_location(token: str, db=Depends(get_db)):
    share = db.scalar(select(ShareLink).where(ShareLink.token_hash == digest(token),
                                             ShareLink.kind == "transport_location"))
    if not share or share.revoked or share.expires_at < utcnow():
        raise HTTPException(404, "This trip location link has expired or was withdrawn")
    try:
        request_id = int((share.fields or ["request:0"])[0].split(":", 1)[1])
    except (IndexError, ValueError):
        raise HTTPException(404, "This trip location link is invalid")
    row = db.get(CareRecord, request_id)
    if not row or row.patient_id != share.patient_id or row.kind != "transport_request":
        raise HTTPException(404, "This trip location is unavailable")
    data = row.data or {}
    status = data.get("location_sharing", "available")
    location = data.get("location") if status == "active" else None
    stale = False
    if location and location.get("observed_at"):
        try:
            observed_at = datetime.fromisoformat(str(location["observed_at"]).replace("Z", "+00:00"))
            if observed_at.tzinfo is not None:
                observed_at = observed_at.astimezone(timezone.utc).replace(tzinfo=None)
            stale = (utcnow() - observed_at).total_seconds() > 90
        except (TypeError, ValueError):
            stale = True
    return {"status": status, "location": location,
            "location_stale": stale,
            "updated_at": (location or {}).get("observed_at"),
            "expires_at": share.expires_at.isoformat() + "Z"}


@router.get("/v2/patients/{patient_id}/transport-requests")
def patient_transport_requests(patient_id: str, request: Request, db=Depends(get_db)):
    patient_access(db, request, patient_id, "appointments")
    rows = db.scalars(select(CareRecord).where(
        CareRecord.patient_id == patient_id, CareRecord.kind == "transport_request"
    ).order_by(CareRecord.created_at.desc(), CareRecord.id.desc()).limit(100)).all()
    return [transport_payload(db, row) for row in rows]


@router.post("/v2/patients/{patient_id}/transport-requests")
def create_transport_request(patient_id: str, body: TransportRequestIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "appointments")
    roles(user, "patient", "caregiver")
    if not body.consent:
        raise HTTPException(422, "Consent is required to share pickup details with your care team")
    appointment = db.get(Appointment, body.appointment_id)
    if not appointment or appointment.patient_id != patient_id:
        raise HTTPException(404, "Choose an appointment in this patient record")
    if appointment.status != "booked" or appointment.start <= hospital_now():
        raise HTTPException(422, "Transport requests are for upcoming booked appointments")
    pickup_at = to_hospital_wall_time(body.pickup_at)
    if pickup_at <= hospital_now() or pickup_at >= appointment.start:
        raise HTTPException(422, "Choose a future pickup time before the appointment")
    active = db.scalars(select(CareRecord).where(
        CareRecord.patient_id == patient_id, CareRecord.kind == "transport_request",
        CareRecord.status.in_(["requested", "coordinating", "arranged"])
    )).all()
    if any((row.data or {}).get("appointment_id") == appointment.id for row in active):
        raise HTTPException(409, "A transport request already exists for this appointment")
    data = {
        "appointment_id": appointment.id,
        "pickup_at": pickup_at.isoformat(),
        "pickup_address": body.pickup_address.strip(),
        "landmark": body.landmark.strip(),
        "ride_type": body.ride_type,
        "support": sorted(set(body.support)),
        "companion_count": body.companion_count,
        "fare_support": body.fare_support,
        "notes": body.notes.strip(),
        "location_consent": body.location_consent,
        "location_sharing": "available" if body.location_consent else "not_requested",
        "arranged_via": "",
        "confirmed_pickup_at": "",
        "coordination_note": "",
        "status_history": [{"status": "requested", "by": user.name, "at": utcnow().isoformat()}],
    }
    row = CareRecord(patient_id=patient_id, kind="transport_request", author_id=user.id,
                     author_name=user.name, author_role=user.role, status="requested", data=data)
    db.add(row)
    db.commit()

    location_url = ""
    if body.location_consent:
        token = secrets.token_urlsafe(32)
        share = ShareLink(patient_id=patient_id, token_hash=digest(token), kind="transport_location",
                          fields=[f"request:{row.id}"], expires_at=hospital_wall_to_utc(appointment.end + timedelta(hours=2)),
                          created_by=user.id, recipient="Hospital transport team and linked caregiver")
        db.add(share)
        db.flush()
        data = dict(row.data or {})
        data["location_share_id"] = share.id
        row.data = data
        db.commit()
        base = os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL") or str(request.base_url).rstrip("/")
        location_url = base.rstrip("/") + "/transport-track/" + token

    target = body.ride_type if body.ride_type in {"hospital", "caregiver"} else ""
    if body.location_consent:
        target = "both"
    external_results = send_transport_messages(db, patient_id, appointment, pickup_at, target, location_url, row.data or {})
    data = dict(row.data or {})
    data["delivery_summary"] = {
        "external_accepted": sum(result["status"] == "accepted" for result in external_results),
        "external_pending": sum(result["status"] == "not_configured" for result in external_results),
        "external_failed": sum(result["status"] == "failed" for result in external_results),
        "location_consent": body.location_consent,
    }
    row.data = data
    db.commit()

    append_audit(db, user, "transport_request_created", patient_id,
                 f"Appointment {appointment.id}; {body.ride_type}; location consent={body.location_consent}")
    share_note = f" Live trip link: {location_url}" if location_url else ""
    coordinator_count = notify_transport_coordinators(
        db, patient_id, "Transport help requested",
        f"A {body.ride_type} request was submitted for {appointment.department} on {appointment.start:%d %b at %H:%M}.{share_note}"
    )
    caregiver_count = 0
    if body.ride_type == "caregiver" or body.location_consent:
        notify_transport_caregivers(
            db, patient_id, "Transport help requested",
            f"A transport request was submitted for {appointment.department} on {appointment.start:%d %b at %H:%M}.{share_note}"
        )
        caregiver_count = len(transport_caregivers(db, patient_id))
    data = dict(row.data or {})
    data["delivery_summary"] = data.get("delivery_summary", {}) | {
        "in_app_hospital": coordinator_count, "in_app_caregiver": caregiver_count
    }
    row.data = data
    db.commit()
    return transport_payload(db, row)


@router.get("/v2/transport-requests")
def transport_request_queue(request: Request, status: Literal["requested", "coordinating", "arranged", "unable", "completed", "cancelled"] | None = None,
                            db=Depends(get_db)):
    user = identity(request)
    roles(user, *TRANSPORT_ROLES)
    patient_ids = visible_ids(db, user, "appointments")
    if not patient_ids:
        return []
    stmt = select(CareRecord).where(CareRecord.kind == "transport_request", CareRecord.patient_id.in_(patient_ids))
    if status:
        stmt = stmt.where(CareRecord.status == status)
    rows = db.scalars(stmt.order_by(CareRecord.created_at.desc(), CareRecord.id.desc()).limit(500)).all()
    return [transport_payload(db, row) for row in rows]


@router.patch("/v2/transport-requests/{request_id}")
def update_transport_request(request_id: int, body: TransportUpdateIn, request: Request, db=Depends(get_db)):
    user = identity(request)
    roles(user, *TRANSPORT_ROLES)
    row = db.get(CareRecord, request_id)
    if not row or row.kind != "transport_request":
        raise HTTPException(404, "Transport request not found")
    patient_access(db, request, row.patient_id, "appointments")
    transitions = {
        "requested": {"coordinating", "arranged", "unable"},
        "coordinating": {"arranged", "unable"},
        "arranged": {"coordinating", "unable", "completed"},
        "unable": {"coordinating", "arranged"},
    }
    if body.status != row.status and body.status not in transitions.get(row.status, set()):
        raise HTTPException(409, f"A {row.status} request cannot move to {body.status}")
    data = dict(row.data or {})
    appointment = db.get(Appointment, data.get("appointment_id"))
    confirmed_pickup_at = to_hospital_wall_time(body.confirmed_pickup_at) if body.confirmed_pickup_at else None
    if body.status == "arranged":
        if not body.arranged_via.strip() or not confirmed_pickup_at:
            raise HTTPException(422, "Enter who arranged the ride and its confirmed pickup time")
        if confirmed_pickup_at <= hospital_now():
            raise HTTPException(422, "Confirmed pickup time must be in the future")
        if appointment and confirmed_pickup_at >= appointment.start:
            raise HTTPException(422, "Confirmed pickup time must be before the appointment")
        data["arranged_via"] = body.arranged_via.strip()
        data["confirmed_pickup_at"] = confirmed_pickup_at.isoformat()
    elif body.arranged_via.strip():
        data["arranged_via"] = body.arranged_via.strip()
    elif confirmed_pickup_at:
        data["confirmed_pickup_at"] = confirmed_pickup_at.isoformat()
    if body.status in {"coordinating", "unable"}:
        data["arranged_via"] = ""
        data["confirmed_pickup_at"] = ""
    if body.coordination_note.strip():
        data["coordination_note"] = body.coordination_note.strip()
    history = list(data.get("status_history", []))
    if body.status != row.status:
        history.append({"status": body.status, "by": user.name, "at": utcnow().isoformat()})
    data["status_history"] = history[-20:]
    row.data, row.status, row.updated_at = data, body.status, utcnow()
    if body.status in {"completed", "unable"} and data.get("location_sharing") == "active":
        revoke_transport_location(db, row)
    db.commit()
    db.add(Notification(user_id=row.author_id, patient_id=row.patient_id,
                        channel="transport", title="Transport request update", body=f"Your ride request is {body.status.replace('_', ' ')}."))
    db.commit()
    append_audit(db, user, "transport_request_updated", row.patient_id,
                 f"Request {row.id}: {body.status}")
    return transport_payload(db, row)


@router.post("/v2/transport-requests/{request_id}/cancel")
def cancel_transport_request(request_id: int, request: Request, db=Depends(get_db)):
    row = db.get(CareRecord, request_id)
    if not row or row.kind != "transport_request":
        raise HTTPException(404, "Transport request not found")
    user = patient_access(db, request, row.patient_id, "appointments")
    roles(user, "patient", "caregiver")
    if row.status in {"completed", "cancelled"}:
        raise HTTPException(409, "This transport request is already closed")
    data = dict(row.data or {})
    history = list(data.get("status_history", []))
    history.append({"status": "cancelled", "by": user.name, "at": utcnow().isoformat()})
    data["status_history"] = history[-20:]
    row.data, row.status, row.updated_at = data, "cancelled", utcnow()
    if data.get("location_sharing") == "active":
        revoke_transport_location(db, row)
    db.commit()
    append_audit(db, user, "transport_request_cancelled", row.patient_id, f"Request {row.id}")
    notify_transport_coordinators(db, row.patient_id, "Transport request cancelled", f"A ride request for {row.patient_id} was cancelled.")
    return transport_payload(db, row)


@router.get("/v2/patients/{patient_id}/gate-qr")
def gate_qr(patient_id: str, request: Request, db=Depends(get_db)):
    patient_access(db, request, patient_id, "appointments")
    import qrcode
    base=os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL") or str(request.base_url).rstrip("/")
    buf=io.BytesIO()
    qrcode.make(f"{base}/app?gate={patient_id}").save(buf,format="PNG")
    return Response(buf.getvalue(),media_type="image/png")


@router.post("/v2/patients/{patient_id}/gate")
def gate_arrival(patient_id: str, request: Request, db=Depends(get_db)):
    user=patient_access(db,request,patient_id,"appointments")
    start=hospital_now().replace(hour=0,minute=0,second=0,microsecond=0)
    rows=db.scalars(select(Appointment).where(Appointment.patient_id==patient_id,Appointment.start>=start,Appointment.start<start+timedelta(days=1),Appointment.status=="booked")).all()
    for row in rows:
        row.status="arrived"
    db.commit()
    notify_team(db,patient_id,"Patient arrived at the gate",f"{len(rows)} booked departments updated.")
    append_audit(db,user,"gate_checkin",patient_id)
    return {"arrived_departments":len(rows),"message":"Arrival recorded. Your booked departments can see that you are here."}


class AppointmentAction(BaseModel):
    action: Literal["arrived", "in_progress", "completed", "missed", "cancelled"]


def appointment_virtual_visit(db, appointment_id):
    return db.scalar(select(VirtualAppointment).where(VirtualAppointment.appointment_id == appointment_id))


@router.post("/v2/appointments/{appointment_id}/status")
def appointment_status(appointment_id: int, body: AppointmentAction, request: Request, db=Depends(get_db)):
    row = db.get(Appointment, appointment_id)
    if not row:
        raise HTTPException(404, "Appointment not found")
    user = patient_access(db, request, row.patient_id, "appointments")
    if body.action != "arrived":
        roles(user, "frontdesk", "nurse", "doctor", "admin")
    visit = appointment_virtual_visit(db, row.id)
    if body.action == "cancelled" and visit and visit.status != "cancelled":
        if visit.google_event_id:
            from ..services.google_meet import GoogleMeetError, cancel_event
            try:
                cancel_event(visit.google_event_id)
            except GoogleMeetError:
                raise HTTPException(502, "Google Calendar could not cancel the video invitation. Retry before cancelling this appointment.") from None
        visit.status = "cancelled"
        visit.meeting_url = ""
        visit.updated_at = utcnow()
    row.status = body.action
    db.commit()
    notify_team(db, row.patient_id, "Appointment update", f"{row.department}: {body.action}")
    if visit:
        from ..services.google_meet import notify_appointment_participants
        notify_appointment_participants(db, row.patient_id, "Video appointment update", f"Your video appointment was {body.action.replace('_', ' ')}. Check its status in OncoBrief.")
    return serial(row)


class MeetLinkIn(BaseModel):
    meeting_url: str = Field(min_length=12, max_length=500)
    clinician_type: Literal["oncologist", "psychiatrist"] = "oncologist"


@router.post("/v2/appointments/{appointment_id}/virtual-visit/create")
def create_appointment_meet(appointment_id: int, request: Request, db=Depends(get_db)):
    appointment = db.get(Appointment, appointment_id)
    if not appointment:
        raise HTTPException(404, "Appointment not found")
    user = patient_access(db, request, appointment.patient_id, "appointments")
    roles(user, "doctor", "nurse", "frontdesk", "admin")
    if appointment.status == "cancelled":
        raise HTTPException(409, "A cancelled appointment cannot have a video meeting")
    visit = appointment_virtual_visit(db, appointment.id)
    if not visit:
        raise HTTPException(404, "This appointment has no online consultation request")
    from ..services.google_meet import (GoogleMeetError, configured, create_event,
                                         invitee_list, refresh_event, set_meeting_result,
                                         notify_appointment_participants, public_visit)
    if not configured():
        raise HTTPException(503, "Google Meet is not configured. Add its Calendar credentials or attach a hospital-created Meet link.")
    try:
        if visit.google_event_id:
            meeting_url = refresh_event(visit.google_event_id)
            if meeting_url:
                set_meeting_result(visit, visit.google_event_id, meeting_url)
            else:
                visit.status = "creating"
                visit.updated_at = utcnow()
        else:
            invitees = invitee_list(visit)
            if not invitees:
                raise HTTPException(422, "No participant emails were saved for this video appointment")
            event_id, meeting_url = create_event(appointment, invitees)
            set_meeting_result(visit, event_id, meeting_url)
    except GoogleMeetError:
        visit.status = "failed"
        visit.updated_at = utcnow()
        db.commit()
        raise HTTPException(502, "Google Calendar could not create the meeting. Retry or add a hospital-created Meet link.") from None
    db.commit()
    append_audit(db, user, "create_google_meet", appointment.patient_id, f"Appointment {appointment.id}")
    if visit.status == "scheduled":
        notify_appointment_participants(db, appointment.patient_id, "Google Meet is ready", "Your private video consultation link is available on the OncoBrief appointment day pass.")
    return {"appointment_id": appointment.id, "virtual_visit": public_visit(visit)}


@router.patch("/v2/appointments/{appointment_id}/virtual-visit/link")
def attach_appointment_meet(appointment_id: int, body: MeetLinkIn, request: Request, db=Depends(get_db)):
    appointment = db.get(Appointment, appointment_id)
    if not appointment:
        raise HTTPException(404, "Appointment not found")
    user = patient_access(db, request, appointment.patient_id, "appointments")
    roles(user, "doctor", "nurse", "frontdesk", "admin")
    if appointment.status == "cancelled":
        raise HTTPException(409, "A cancelled appointment cannot have a video meeting")
    from ..services.google_meet import (GoogleMeetError, cancel_event,
                                         notify_appointment_participants, public_visit,
                                         save_manual_link)
    visit = appointment_virtual_visit(db, appointment.id)
    if not visit:
        visit = VirtualAppointment(appointment_id=appointment.id, patient_id=appointment.patient_id,
                                   clinician_type=body.clinician_type, created_by=user.id)
        db.add(visit)
        db.flush()
    if visit.google_event_id:
        try:
            cancel_event(visit.google_event_id)
        except GoogleMeetError:
            raise HTTPException(502, "The pending Google Calendar event could not be cancelled; its invite may remain active. Retry before replacing its link.") from None
    try:
        save_manual_link(visit, body.meeting_url)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    db.commit()
    append_audit(db, user, "attach_google_meet", appointment.patient_id, f"Appointment {appointment.id}")
    notify_appointment_participants(db, appointment.patient_id, "Video appointment link added", "A Google Meet link is ready on the OncoBrief appointment day pass.")
    return {"appointment_id": appointment.id, "virtual_visit": public_visit(visit)}


@router.get("/v2/appointments/{appointment_id}/suggest-slot")
def suggest_slot(appointment_id: int, request: Request, db=Depends(get_db)):
    row = db.get(Appointment, appointment_id)
    if not row:
        raise HTTPException(404, "Appointment not found")
    patient_access(db, request, row.patient_id, "appointments")
    others = db.scalars(select(Appointment).where(Appointment.id != row.id, Appointment.status != "cancelled")).all()
    duration = row.end - row.start
    start = row.start.replace(hour=8, minute=0, second=0, microsecond=0)
    candidates = [start + timedelta(minutes=10 * i) for i in range(54) if start + timedelta(minutes=10 * i) >= hospital_now()]
    candidates.sort(key=lambda t: abs((t - row.start).total_seconds()))
    for t in candidates:
        if t + duration > start.replace(hour=17):
            continue
        if not any(t < a.end and a.start < t + duration and (a.patient_id == row.patient_id or a.room == row.room) for a in others):
            return {"start": t.isoformat(), "end": (t + duration).isoformat(), "room": row.room, "approval_required": True}
    raise HTTPException(409, "No free slot that fits on this day")


class RescheduleIn(BaseModel):
    start: datetime


@router.post("/v2/appointments/{appointment_id}/reschedule")
@serial_schedule
def reschedule(appointment_id: int, body: RescheduleIn, request: Request, db=Depends(get_db)):
    row = db.get(Appointment, appointment_id)
    if not row:
        raise HTTPException(404, "Appointment not found")
    user = patient_access(db, request, row.patient_id, "appointments")
    roles(user, "frontdesk", "nurse", "admin")
    start = to_hospital_wall_time(body.start)
    end = start + (row.end - row.start)
    if start < hospital_now() or start.hour < 8 or end > start.replace(hour=17, minute=0, second=0, microsecond=0):
        raise HTTPException(422, "Choose a future slot between 08:00 and 17:00 hospital time")
    from sqlalchemy import or_
    clash = db.scalar(select(Appointment).where(Appointment.id != row.id, Appointment.status != "cancelled", Appointment.start < end,
                                                Appointment.end > start, or_(Appointment.patient_id == row.patient_id, Appointment.room == row.room)))
    if clash:
        raise HTTPException(409, "Slot was taken. Request a new suggestion.")
    visit = appointment_virtual_visit(db, row.id)
    if visit and visit.google_event_id and visit.status != "cancelled":
        from ..services.google_meet import GoogleMeetError, reschedule_event
        try:
            reschedule_event(visit.google_event_id, row, start=start, end=end)
        except GoogleMeetError:
            raise HTTPException(502, "Google Calendar could not update the video invitation. The appointment time was not changed.") from None
    row.start, row.end = start, end
    db.commit()
    append_audit(db, user, "fix_schedule_clash", row.patient_id, str(row.id))
    if visit and visit.status != "cancelled":
        from ..services.google_meet import notify_appointment_participants
        notify_appointment_participants(db, row.patient_id, "Appointment time updated", "Your video consultation time changed. Check the updated time on the OncoBrief appointment day pass.")
    return serial(row)


class ShareIn(BaseModel):
    kind: Literal["emergency", "second_opinion"]
    fields: list[Literal["regimen", "allergies", "counts", "contact", "summary", "documents"]] = Field(min_length=1)
    hours: int = Field(default=24, ge=1, le=168)
    consent: bool
    recipient: str = Field(default="", max_length=150)


@router.post("/v2/patients/{patient_id}/shares")
def share(patient_id: str, body: ShareIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "patient")
    if not body.consent:
        raise HTTPException(422, "Patient consent is required for each share")
    if body.kind == "emergency" and any(f in body.fields for f in ("documents", "summary")):
        raise HTTPException(422, "Emergency cards expose only selected emergency fields")
    token = secrets.token_urlsafe(40)
    row = ShareLink(patient_id=patient_id, token_hash=digest(token), kind=body.kind, fields=body.fields,
                    expires_at=utcnow() + timedelta(hours=body.hours), created_by=user.id, recipient=body.recipient)
    db.add(row)
    db.commit()
    append_audit(db, user, "consent_" + body.kind, patient_id, "Fields: " + ",".join(body.fields))
    import base64
    import qrcode
    base = os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL") or str(request.base_url).rstrip("/")
    buf = io.BytesIO()
    qrcode.make(f"{base}/share/{token}").save(buf, format="PNG")
    return {"id": row.id, "url": f"/share/{token}", "api_url": f"/api/shared/{token}", "expires_at": row.expires_at,
            "qr_png": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}


@router.get("/v2/patients/{patient_id}/shares")
def shares(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id)
    roles(user, "patient")
    return [serial(r, ("token_hash",)) for r in db.scalars(select(ShareLink).where(ShareLink.patient_id == patient_id))]


@router.delete("/v2/shares/{share_id}")
def revoke_share(share_id: int, request: Request, db=Depends(get_db)):
    row = db.get(ShareLink, share_id)
    if not row or row.created_by != identity(request).id:
        raise HTTPException(404, "Share not found")
    row.revoked = True
    db.commit()
    return {"ok": True}


def load_share(token, db):
    row = db.scalar(select(ShareLink).where(ShareLink.token_hash == digest(token)))
    if not row or row.kind not in {"emergency", "second_opinion"} or row.revoked or row.expires_at < utcnow():
        raise HTTPException(404, "This consent link has expired or was withdrawn")
    return row


@router.get("/shared/{token}")
def public_share(token: str, db=Depends(get_db)):
    row = load_share(token, db)
    p = db.get(Patient, row.patient_id)
    out = {"kind": row.kind, "patient_id": p.id, "expires_at": row.expires_at, "recipient": row.recipient}
    profile = records(db, p.id, "clinical_profile")
    profile = profile[0].data if profile else {}
    if "regimen" in row.fields:
        out["regimen"] = p.current_regimen
    if "allergies" in row.fields:
        out["allergies"] = profile.get("allergies", "Not recorded; verify with treating team")
    if "contact" in row.fields:
        out["contact"] = profile.get("oncologist_phone", os.getenv("HOSPITAL_EMERGENCY_PHONE", "Not configured"))
    if "counts" in row.fields:
        out["counts"] = living_summary(db, p.id)["latest_labs"]
    if "summary" in row.fields:
        out["summary"] = living_summary(db, p.id)
    if "documents" in row.fields:
        out["documents"] = [{"id": d.id, "title": d.title, "text": safe_text(d.ocr_text), "date": d.record_date}
                            for d in db.scalars(select(Document).where(Document.patient_id == p.id))]
    viewer = type("Viewer", (), {"id": 0, "role": "external", "name": "Consent link viewer"})()
    append_audit(db, viewer, "open_" + row.kind + "_share", p.id, "Selected fields only")
    if row.kind == "emergency":
        alert(db, p.id, "Emergency medical card opened; verify whether patient is at an ER", "emergency QR", "urgent")
    return out


@router.get("/v2/patients/{patient_id}/pack")
def pack(patient_id: str, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "doctor", "patient", "admin")
    return {"patient_id": patient_id, "summary": living_summary(db, patient_id),
            "questions": visit_prep(patient_id, request, db)["questions"] if patient_id in visible_ids(db, user, "notes") else [],
            "key_images": [{"id": d.id, "title": d.title} for d in db.scalars(select(Document).where(Document.patient_id == patient_id, Document.category == "Imaging"))],
            "signed_decisions": [serial(r) for r in records(db, patient_id, "board_decision") if r.status == "approved"]}


@router.get("/v2/patients/{patient_id}/pack.pdf")
def pack_pdf(patient_id: str, request: Request, db=Depends(get_db)):
    data = pack(patient_id, request, db)
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Image as PdfImage, PageBreak
    from xml.sax.saxutils import escape
    buf = io.BytesIO()
    from ..services.pdf_fonts import apply_fonts
    styles = apply_fonts(getSampleStyleSheet())
    story = [Paragraph("OncoBrief case pack: " + escape(patient_id), styles["Title"])]
    for line in data["summary"]["text"].splitlines():
        story.extend([Paragraph(escape(line), styles["BodyText"]), Spacer(1, 6)])
    story.append(Paragraph("Open questions", styles["Heading2"]))
    story.extend(Paragraph(escape(q), styles["BodyText"]) for q in data["questions"])
    if data["key_images"]:
        from ..config import STORAGE_DIR
        from ..security import read_file
        from ..services.protected_files import render_page
        story.extend([PageBreak(), Paragraph("Key imaging source pages", styles["Heading1"])])
        for item in data["key_images"][-3:]:
            doc=db.get(Document,item["id"])
            path=(STORAGE_DIR.parent/doc.file_path).resolve()
            if path.is_relative_to(STORAGE_DIR.resolve()) and path.exists():
                try:
                    image=io.BytesIO(render_page(read_file(path),doc.mime,0,identity(request).name))
                    pic=PdfImage(image)
                    scale=min(420/pic.imageWidth,500/pic.imageHeight)
                    pic.drawWidth,pic.drawHeight=pic.imageWidth*scale,pic.imageHeight*scale
                    story.extend([Paragraph(escape(f"D{doc.id}: {doc.title}"),styles["Heading2"]),pic,Spacer(1,18)])
                except (ValueError,HTTPException):
                    story.append(Paragraph("Open the original source in the patient folder.",styles["BodyText"]))
    viewer=identity(request).name.encode('ascii','replace').decode()
    def footer(canvas,document):
        canvas.saveState()
        canvas.setFont('Helvetica',8)
        canvas.setFillColorRGB(.35,.25,.45)
        canvas.drawString(40,20,f"OncoBrief | {viewer} | {utcnow():%Y-%m-%d %H:%M} UTC | page {document.page}")
        canvas.restoreState()
    SimpleDocTemplate(buf,bottomMargin=40).build(story,onFirstPage=footer,onLaterPages=footer)
    return Response(buf.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{patient_id}-case-pack.pdf"'})


class AdapterIn(BaseModel):
    service: Literal["sms", "whatsapp", "phone", "speech", "translation", "trials", "prices", "weather", "vision", "wearables", "telemedicine", "er", "formulary", "evidence"]
    payload: dict
    consent: bool


@router.post("/v2/patients/{patient_id}/integration")
def integration(patient_id: str, body: AdapterIn, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id)
    roles(user, "doctor", "nurse", "navigator", "patient", "caregiver", "dietitian", "admin")
    if not body.consent:
        raise HTTPException(422, "Consent is required before sharing data with this service")
    required_scope = {"formulary": "medicines", "er": "documents", "phone": "checkin", "speech": "notes", "translation": "documents", "vision": "documents", "trials": "documents", "prices": "medicines", "wearables": "activity", "telemedicine": "appointments"}.get(body.service, "chat")
    require_patient(db, user, patient_id, required_scope)
    if body.service in {"trials", "prices", "formulary", "evidence"}:
        roles(user, "doctor")
    if body.service == "er":
        roles(user, "doctor", "nurse")
    if body.service in {"phone", "sms", "whatsapp"}:
        roles(user, "nurse", "doctor", "navigator", "admin")
    p = db.get(Patient, patient_id)
    # An adapter cannot be used as a proxy for arbitrary recipients or other patients.
    payload = {k: v for k, v in body.payload.items() if k in {"text", "source_language", "target_language", "query", "document_id", "topic"}}
    if len(json.dumps(payload)) > 20000:
        raise HTTPException(422, "Integration payload too large")
    if payload.get("document_id"):
        doc = db.get(Document, payload["document_id"])
        if not doc or doc.patient_id != patient_id:
            raise HTTPException(422, "Document belongs to another patient")
        payload["text"] = safe_text(doc.ocr_text)[:12000]
        if body.service in {"vision", "speech"}:
            import base64
            from ..config import STORAGE_DIR
            from ..security import read_file
            path = (STORAGE_DIR.parent / doc.file_path).resolve()
            if not path.is_relative_to(STORAGE_DIR.resolve()):
                raise HTTPException(404)
            data = read_file(path)
            if body.service == "vision":
                if not doc.mime.startswith("image/"):
                    raise HTTPException(422, "Choose an image document for vision")
                from PIL import Image
                img = Image.open(io.BytesIO(data)).convert("RGB")
                img.thumbnail((1280,1280))
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=85)
                data = buf.getvalue()
                payload["mime"] = "image/jpeg"
            else:
                if not doc.mime.startswith("audio/"):
                    raise HTTPException(422, "Choose an audio document for speech transcription")
                payload["mime"] = doc.mime
            payload["media_base64"] = base64.b64encode(data).decode()
    if body.service in {"phone", "sms", "whatsapp"}:
        payload["to"] = p.phone
        if body.service == "phone":
            from ..services.telephony import call_payload
            payload.update(call_payload(db, patient_id, user.id))
    if body.service in {"trials", "evidence"}:
        payload = {"cancer_type": p.cancer_type, "stage": p.stage, "biomarkers": (records(db, patient_id, "clinical_profile") or [None])[0].data.get("biomarkers") if records(db, patient_id, "clinical_profile") else ""}
    if body.service == "er":
        profile = records(db, patient_id, "clinical_profile")
        payload = {"patient_id": patient_id, "regimen": p.current_regimen,
                   "allergies": profile[0].data.get("allergies", "Not recorded") if profile else "Not recorded",
                   "counts": living_summary(db, patient_id)["latest_labs"], "care_contact": os.getenv("HOSPITAL_EMERGENCY_PHONE", ""),
                   "reason": body.payload.get("text", "Emergency pre-alert")[:1000]}
    result = deliver(body.service, payload)
    append_audit(db, user, "external_" + body.service, patient_id, "Explicit consent; adapter invoked")
    # All potential clinical/vision/trial outputs remain reviewable drafts.
    row = CareRecord(patient_id=patient_id, kind="integration_result", author_id=user.id, author_name=user.name,
                     author_role=user.role, status="draft", data={"service": body.service, "result": result})
    db.add(row)
    db.commit()
    expose = user.role in CLINICIANS or (user.role == "dietitian" and body.service == "vision") or body.service in {"translation", "speech", "telemedicine", "weather", "wearables"}
    return {"status": "provider_response", "record_id": row.id, "result": result if expose else {"message": "Received; awaiting clinical review"}, "clinical_review_required": True}


@router.get("/v2/privacy-requests")
def privacy_requests(request: Request, db=Depends(get_db)):
    roles(identity(request), "privacy", "admin")
    return [serial(r) for r in db.scalars(select(CareRecord).where(CareRecord.kind == "privacy_request").order_by(CareRecord.id.desc()))]


class PhoneResult(BaseModel):
    identity_verified: bool
    answers: CheckIn


@router.post("/webhooks/telephony")
def phone_result(body: PhoneResult, request: Request, db=Depends(get_db)):
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    ticket = db.scalar(select(ShareLink).where(ShareLink.token_hash == digest(token), ShareLink.kind == "phone_callback"))
    if not ticket or ticket.revoked or ticket.expires_at < utcnow() or not body.identity_verified:
        raise HTTPException(403, "Invalid, expired or unverified call callback")
    user = db.get(User, ticket.created_by)
    require_patient(db, user, ticket.patient_id, "checkin")
    request.state.user = user
    consumed=db.execute(update(ShareLink).where(ShareLink.id==ticket.id,ShareLink.revoked.is_(False)).values(revoked=True))
    if consumed.rowcount!=1:
        raise HTTPException(403,"Callback ticket has already been redeemed")
    db.commit()
    data = body.answers.model_copy(update={"source": "voice"})
    result = checkin(ticket.patient_id, data, request, db)
    append_audit(db, user, "verified_phone_checkin", ticket.patient_id, "One-time callback ticket redeemed")
    return result


@router.get("/v2/inbox")
def smart_inbox(request: Request, db=Depends(get_db)):
    user = identity(request)
    roles(user, "doctor", "nurse")
    ids = visible_ids(db, user, "chat")
    rows = db.scalars(select(CareRecord).where(CareRecord.kind == "chat", CareRecord.patient_id.in_(ids),
                                               CareRecord.author_role.in_(["patient", "caregiver"]), CareRecord.status == "sent").order_by(CareRecord.id.desc()).limit(100)).all()
    return sorted([{**serial(r), "patient_name": db.get(Patient, r.patient_id).name,
                    "draft_reply": EMERGENCY["en"] if r.data.get("urgency") == 3 else "Thank you for letting us know. I will review this with your care team. Please continue your current signed plan."}
                   for r in rows], key=lambda r:r["data"].get("urgency", 0), reverse=True)


@router.post("/v2/messages/{record_id}/reply")
def inbox_reply(record_id: int, body: MessageIn, request: Request, db=Depends(get_db)):
    row = db.get(CareRecord, record_id)
    if not row or row.kind != "chat":
        raise HTTPException(404, "Message not found")
    user = patient_access(db, request, row.patient_id, "chat")
    roles(user, "doctor", "nurse")
    reply = CareRecord(patient_id=row.patient_id, kind="chat", author_id=user.id, author_name=user.name, author_role=user.role,
                       data={"text": body.text, "reply_to": row.id, "urgency": 0}, status="sent")
    row.status = "replied"
    db.add(reply)
    db.commit()
    notify_team(db, row.patient_id, "Care team replied", "A reply is available in your care circle chat.")
    append_audit(db, user, "review_and_send_reply", row.patient_id, f"R{row.id}")
    return serial(reply)


class TeachBack(BaseModel):
    answers: list[str] = Field(min_length=3, max_length=3)


@router.post("/v2/patients/{patient_id}/teach-back")
def teach_back(patient_id: str, body: TeachBack, request: Request, db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "notes")
    correct = ["contact", "doctor", "original"]
    score = sum(a == b for a, b in zip(body.answers, correct))
    row = CareRecord(patient_id=patient_id, kind="teach_back", author_id=user.id, author_name=user.name,
                     author_role=user.role, data={"answers": body.answers, "score": score, "out_of": 3}, status="recorded")
    db.add(row)
    db.commit()
    if score < 3:
        alert(db, patient_id, "Teach-back: nurse explanation requested", f"R{row.id}", "warning")
    return {"score": score, "out_of": 3, "message": "You understood all three points." if score == 3 else "Please review the explanations with your nurse. A support request was recorded."}


@router.get("/v2/handover")
def nurse_handover(request: Request, db=Depends(get_db)):
    user=identity(request)
    roles(user,"doctor","nurse")
    ids=visible_ids(db,user,"alerts")
    alerts=db.scalars(select(Alert).where(Alert.patient_id.in_(ids),Alert.status!="resolved")).all()
    pending=db.scalars(select(Approval).where(Approval.patient_id.in_(ids),Approval.status.in_(["sent","reviewing"]))).all()
    tasks=db.scalars(select(CareRecord).where(CareRecord.patient_id.in_(ids),CareRecord.kind=="task",CareRecord.status!="completed")).all()
    lines=[f"Shift handover generated {utcnow().isoformat()} UTC", "OPEN ALERTS"]
    lines += [f"{a.patient_id} / A{a.id}: {a.reason}; {a.status}; {a.assigned_to}" for a in alerts] or ["None"]
    lines += ["PENDING DOCTOR APPROVALS"] + [f"{a.patient_id} / #{a.id}: {a.request}; {a.status}" for a in pending]
    lines += ["OPEN TASKS"] + [f"{t.patient_id} / R{t.id}: {t.data.get('title','')}; {t.data.get('assigned_to','')}" for t in tasks]
    return {"text":"\n".join(lines),"alerts":len(alerts),"pending":len(pending),"tasks":len(tasks)}


@router.get("/v2/patients/{patient_id}/buddy-matches")
def buddy_matches(patient_id: str, request: Request, db=Depends(get_db)):
    user=patient_access(db,request,patient_id,"notes")
    roles(user,"patient","navigator")
    path=os.getenv("BUDDY_DIRECTORY_PATH","")
    if not path:
        return {"setup_required":True,"matches":[],"message":"Set BUDDY_DIRECTORY_PATH to the hospital's verified, consented volunteer directory."}
    from pathlib import Path
    try:
        directory=json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(directory,list):
            raise ValueError()
    except (OSError,ValueError):
        raise HTTPException(503,"Buddy directory is not a valid JSON list")
    p=db.get(Patient,patient_id)
    matches=[{k:v.get(k) for k in ("volunteer_id","display_name","language","cancer_type")} for v in directory if isinstance(v,dict)
             and v.get("trained") is True and v.get("moderated") is True and v.get("consented") is True
             and v.get("language")==p.preferred_language and str(v.get("cancer_type","")).lower()==str(p.cancer_type or "").lower()]
    return {"setup_required":False,"matches":matches[:10],"message":"A navigator confirms availability and arranges an introduction. Invite only with the patient's consent; use the moderated care circle."}


class ScribeInput(BaseModel):
    text:str=Field(min_length=1,max_length=20000)
    language:Literal["en","hi","mr"]="en"
    consent:bool


@router.post("/v2/patients/{patient_id}/scribe-draft")
def scribe_draft(patient_id:str,body:ScribeInput,request:Request,db=Depends(get_db)):
    user=patient_access(db,request,patient_id,"documents")
    roles(user,"doctor")
    if not body.consent:
        raise HTTPException(422,"Recording and processing consent is required")
    from ..services.drafts import scribe_draft as create_draft
    return create_draft(db,patient_id,body.text,body.language)


@router.post("/v2/patients/{patient_id}/care-review-draft")
def care_review(patient_id:str,request:Request,db=Depends(get_db)):
    user=patient_access(db,request,patient_id,"documents")
    roles(user,"doctor")
    from ..services.drafts import care_review_draft
    draft=care_review_draft(db,patient_id)
    row=Approval(patient_id=patient_id,kind="plan",request="Review recent reports, check-ins and signed visit notes",draft=draft,requested_by=user.name)
    db.add(row)
    db.commit()
    append_audit(db,user,"draft_care_review",patient_id,f"Approval {row.id}")
    return serial(row)
