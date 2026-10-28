from ..timeutil import utcnow
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
from ..round2_models import AccessGrant, Alert, Approval, CareRecord, LibraryItem, Notification, ShareLink, User, TreatingClinician
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
    return {"services": integration_status(), "demo": DEMO_MODE,
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
                appointment_ids if n.channel == "transport"
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
            raise HTTPException(422, f"{f['label']} is required"