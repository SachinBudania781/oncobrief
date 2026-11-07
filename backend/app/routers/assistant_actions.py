"""Assistant actions: turn a clinician's plain-language request into a confirmable action.

Two steps keep a human in control:
  POST /api/v2/assistant/plan     -> parses the request, returns a draft action (no side effects)
  POST /api/v2/assistant/execute  -> runs the confirmed action through the normal, permission-checked paths
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Patient
from ..round2_models import AccessGrant, Notification, User
from ..security import append_audit, require_patient, visible_ids
from ..taxonomy import DEPARTMENTS
from ..timeutil import hospital_now
from .common import Actor, get_actor

router = APIRouter(prefix="/api/v2/assistant", tags=["assistant actions"])

CLINICAL_ROLES = {"doctor", "nurse", "frontdesk", "admin"}
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
DEPARTMENT_NAMES = [d["name"] for d in DEPARTMENTS if d["name"] != "Front desk / Records"]


class PlanIn(BaseModel):
    text: str = Field(min_length=2, max_length=600)
    patient_id: str = Field(min_length=3, max_length=40)


class ExecuteIn(BaseModel):
    intent: Literal["book_visit", "notify_patient", "care_task"]
    patient_id: str = Field(min_length=3, max_length=40)
    params: dict[str, Any] = Field(default_factory=dict)


# ---------- parsing ----------

def _parse_day(text: str, now: datetime):
    t = text.lower()
    if "day after tomorrow" in t:
        return (now + timedelta(days=2)).date()
    if "tomorrow" in t or "kal" in t.split():
        return (now + timedelta(days=1)).date()
    if "today" in t or "aaj" in t.split():
        return now.date()
    m = re.search(r"in (\d{1,2}) (day|days|week|weeks)", t)
    if m:
        n = int(m.group(1)) * (7 if m.group(2).startswith("week") else 1)
        return (now + timedelta(days=n)).date()
    if "next week" in t:
        return (now + timedelta(days=7)).date()
    for i, name in enumerate(WEEKDAYS):
        if re.search(rf"\b{name[:3]}(?:{name[3:]})?\b", t):
            ahead = (i - now.weekday()) % 7 or 7
            if f"next {name}" in t and ahead < 7:
                ahead += 0
            return (now + timedelta(days=ahead)).date()
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*", t) \
        or re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})", t)
    if m:
        a, b = m.groups()
        day, mon = (int(a), MONTHS[b]) if a.isdigit() else (int(b), MONTHS[a])
        year = now.year + (1 if (mon, day) < (now.month, now.day) else 0)
        try:
            return datetime(year, mon, day).date()
        except ValueError:
            return None
    m = re.search(r"\b(\d{1,2})[/-](\d{1,2})\b", t)
    if m:
        day, mon = int(m.group(1)), int(m.group(2))
        try:
            year = now.year + (1 if (mon, day) < (now.month, now.day) else 0)
            return datetime(year, mon, day).date()
        except ValueError:
            return None
    return None


def _parse_time(text: str):
    t = text.lower()
    m = re.search(r"\b(\d{1,2})(?::|\.)(\d{2})\s*(am|pm)?\b", t) or re.search(r"\b(\d{1,2})\s*(am|pm)\b", t)
    if m:
        groups = m.groups()
        hour = int(groups[0])
        minute = int(groups[1]) if len(groups) == 3 and groups[1] and groups[1].isdigit() else 0
        suffix = groups[-1] if groups[-1] in {"am", "pm"} else None
        if suffix == "pm" and hour < 12:
            hour += 12
        if suffix == "am" and hour == 12:
            hour = 0
        if suffix is None and 1 <= hour <= 7:
            hour += 12  # "at 4" in a clinic context means 4 pm
        return hour, minute
    if "morning" in t:
        return 10, 0
    if "afternoon" in t:
        return 14, 0
    if "evening" in t:
        return 16, 0
    m = re.search(r"\bat (\d{1,2})\b", t)
    if m:
        hour = int(m.group(1))
        return (hour + 12 if 1 <= hour <= 7 else hour), 0
    return None


def _round_slot(hour: int, minute: int):
    minute = (minute // 20) * 20
    return hour, minute


def _match_patient(db: Session, user: User, text: str, fallback: str):
    t = text.lower()
    for pid in visible_ids(db, user):
        p = db.get(Patient, pid)
        if not p:
            continue
        first = p.name.split()[0].lower()
        if p.id.lower() in t or re.search(rf"\b{re.escape(first)}\b", t):
            return p
    return db.get(Patient, fallback)


def _rule_plan(text: str, now: datetime):
    t = text.lower()
    if re.search(r"\b(remind|tell|message|notify|send|inform|let .* know)\b", t) and not re.search(r"\b(book|schedule)\b", t):
        msg = re.sub(r"^(please\s+)?(remind|tell|message|notify|send|inform)\s+(\w+\s+)?(to\s+|that\s+)?", "", text.strip(), flags=re.I)
        return "notify_patient", {"message": msg[:1].upper() + msg[1:] if msg else text.strip()}
    if re.search(r"\b(task|nurse|navigator|dietitian|ask the team|assign|follow up with|call the patient|arrange)\b", t) and not re.search(r"\b(book|schedule|appointment|consult|visit)\b", t):
        return "care_task", {"task": text.strip()}
    if re.search(r"\b(book|schedule|appointment|follow[- ]?up|consult|visit|meet|teleconsult|video call|slot)\b", t):
        mode = "google_meet" if re.search(r"\b(video|meet|google meet|online|tele|virtual|call)\b", t) else "in_person"
        department = "Psycho-oncology" if re.search(r"psych|counsel|mental", t) else "Medical Oncology OPD"
        if mode == "in_person":
            for name in DEPARTMENT_NAMES:
                key = name.split()[0].lower()
                if len(key) > 4 and key in t:
                    department = name
                    break
        day = _parse_day(t, now)
        time = _parse_time(t)
        params = {"mode": mode, "department": department, "clinician_type": "psychiatrist" if department == "Psycho-oncology" else "oncologist",
                  "notes": text.strip()[:200]}
        if day and time:
            h, m = _round_slot(*time)
            params["start"] = datetime(day.year, day.month, day.day, h, m).isoformat()
        elif day:
            params["date"] = day.isoformat()
        return "book_visit", params
    return None, {}


def _llm_plan(text: str, now: datetime, patient_names: list[str]):
    try:
        from ..services import llm
        if not llm.enabled():
            return None
        system = ("You convert a clinician's request into one JSON action. Allowed intents: "
                  "book_visit (params: start ISO 'YYYY-MM-DDTHH:MM' local hospital time, mode 'in_person'|'google_meet', department one of "
                  f"{DEPARTMENT_NAMES}, notes), notify_patient (params: message written kindly to the patient), "
                  "care_task (params: task). Also return patient_name if the clinician names a patient. "
                  "If the request is anything else, return {\"intent\": null}. Return only JSON: {\"intent\":..., \"params\":{...}, \"patient_name\":...}.")
        user = f"Now: {now:%A %Y-%m-%d %H:%M}. Patients: {', '.join(patient_names)}. Request: {text}"
        out = llm.complete_json(system, user, timeout=12)
        if isinstance(out, dict) and out.get("intent") in {"book_visit", "notify_patient", "care_task", None}:
            return out
    except Exception:
        return None
    return None


def _describe(intent: str, params: dict, patient: Patient):
    if intent == "book_visit":
        when = params.get("start")
        when_text = datetime.fromisoformat(when).strftime("%a %d %b, %I:%M %p").replace(" 0", " ") if when else "a time you choose"
        kind = "Google Meet video consult" if params.get("mode") == "google_meet" else f"{params.get('department', 'clinic')} visit"
        return f"Book a {kind} for {patient.name} on {when_text}"
    if intent == "notify_patient":
        return f"Send {patient.name} a message in the app"
    return f"Create a care-team task for {patient.name}"


@router.post("/plan")
def plan(body: PlanIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    user = db.get(User, actor.id)
    if not user or user.role not in CLINICAL_ROLES:
        raise HTTPException(403, "Assistant actions are available to the care team")
    require_patient(db, user, body.patient_id, "appointments")
    now = hospital_now()
    names = [db.get(Patient, pid).name for pid in visible_ids(db, user) if db.get(Patient, pid)]
    patient = _match_patient(db, user, body.text, body.patient_id)
    intent, params = _rule_plan(body.text, now)
    ai = _llm_plan(body.text, now, names)
    if ai and ai.get("intent"):
        intent = ai["intent"]
        merged = dict(params) if intent == _rule_plan(body.text, now)[0] else {}
        merged.update({k: v for k, v in (ai.get("params") or {}).items() if v not in (None, "")})
        params = merged
        if ai.get("patient_name"):
            named = next((db.get(Patient, pid) for pid in visible_ids(db, user)
                          if db.get(Patient, pid) and ai["patient_name"].lower().split()[0] in db.get(Patient, pid).name.lower()), None)
            patient = named or patient
    if not intent:
        return {"intent": None, "message": "I can book visits or video consults, message the patient, or create a task for the care team. Try: “Book a video follow-up with Meera tomorrow at 4 pm”."}
    if intent == "book_visit":
        if params.get("start"):
            try:
                start = datetime.fromisoformat(str(params["start"])[:16])
                params["start"] = start.replace(minute=(start.minute // 20) * 20, second=0).isoformat()
            except ValueError:
                params.pop("start", None)
        params.setdefault("mode", "in_person")
        params.setdefault("department", "Medical Oncology OPD")
        params.setdefault("clinician_type", "psychiatrist" if params.get("department") == "Psycho-oncology" else "oncologist")
    missing = []
    if intent == "book_visit" and not params.get("start"):
        missing.append("start")
    return {"intent": intent, "patient_id": patient.id, "patient_name": patient.name, "params": params,
            "missing": missing, "summary": _describe(intent, params, patient)}


def _patient_users(db: Session, patient_id: str):
    ids = db.scalars(select(AccessGrant.user_id).where(AccessGrant.patient_id == patient_id, AccessGrant.active.is_(True))).all()
    return [u for u in (db.get(User, i) for i in set(ids)) if u and u.active and u.role in {"patient", "caregiver"}]


@router.post("/execute")
def execute(body: ExecuteIn, request: Request, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    user = db.get(User, actor.id)
    if not user or user.role not in CLINICAL_ROLES:
        raise HTTPException(403, "Assistant actions are available to the care team")
    patient = db.get(Patient, body.patient_id)
    if not patient:
        raise HTTPException(404, "Patient not found")
    p = body.params
    if body.intent == "book_visit":
        require_patient(db, user, patient.id, "appointments")
        from .care import AppointmentIn, book
        mode = p.get("mode", "in_person")
        start = str(p.get("start") or "")
        if not start:
            raise HTTPException(422, "Choose a date and time")
        meet = mode == "google_meet"
        appt_in = AppointmentIn(
            patient_id=patient.id, department=p.get("department") or "Medical Oncology OPD", start=start,
            visit_type=p.get("visit_type") or "follow_up", notes=(p.get("notes") or "Booked from assistant")[:300],
            visit_mode="google_meet" if meet else "in_person",
            clinician_type=(p.get("clinician_type") or "oncologist") if meet else None,
            patient_email=(p.get("patient_email") or "").strip(), clinician_email=(p.get("clinician_email") or "").strip(),
            caregiver_email="", include_caregiver=False, invitation_consent=bool(p.get("invitation_consent", meet)),
        )
        appointment = book(appt_in, db, actor)
        result: dict[str, Any] = {"done": True, "appointment": appointment}
        if meet:
            from . import round2
            try:
                visit = round2.create_appointment_meet(appointment["id"], request, db)
                result["virtual_visit"] = visit.get("virtual_visit")
                result["message"] = "Video consult booked. The Google Meet invite has been sent."
            except HTTPException as exc:
                result["message"] = f"Visit booked. Meet link pending: {exc.detail}"
        else:
            result["message"] = "Visit booked and added to the patient's day pass."
        return result
    if body.intent == "notify_patient":
        require_patient(db, user, patient.id, "notes")
        message = str(p.get("message") or "").strip()[:500]
        if not message:
            raise HTTPException(422, "Write the message to send")
        recipients = _patient_users(db, patient.id)
        for r in recipients:
            db.add(Notification(user_id=r.id, patient_id=patient.id, title=f"Message from {user.name}", body=message))
        db.commit()
        append_audit(db, user, "assistant_message_patient", patient.id, f"{len(recipients)} recipients")
        return {"done": True, "message": f"Message sent to {patient.name}" + (" and caregiver" if len(recipients) > 1 else "") + "."}
    # care_task
    require_patient(db, user, patient.id, "notes")
    task = str(p.get("task") or "").strip()[:500]
    if not task:
        raise HTTPException(422, "Describe the task")
    from ..services.companion import notify_team
    notify_team(db, patient.id, f"Task from {user.name}", task)
    append_audit(db, user, "assistant_care_task", patient.id, task[:80])
    return {"done": True, "message": "Task shared with the care team."}


# ---------- Patient SOS ----------
sos_router = APIRouter(prefix="/api/v2", tags=["emergency"])


class SosIn(BaseModel):
    note: str = Field(default="", max_length=400)


@sos_router.post("/patients/{patient_id}/sos")
def sos(patient_id: str, body: SosIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    user = db.get(User, actor.id)
    if not user or user.role not in {"patient", "caregiver"}:
        raise HTTPException(403, "SOS is for patients and caregivers")
    require_patient(db, user, patient_id, "profile")
    from ..services.companion import alert
    reason = f"SOS from {user.name}. " + (body.note or "Patient requested urgent help in the app.")
    row = alert(db, patient_id, reason[:400], "sos", "emergency")
    append_audit(db, user, "patient_sos", patient_id, "SOS raised")
    return {"alert_id": row.id, "status": "alerted"}
