from datetime import date, datetime, timedelta
import json
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Activity, Appointment, Medication, MedLog, Patient, SymptomReport
from ..round2_models import User, VirtualAppointment
from ..taxonomy import DEPARTMENTS, SYMPTOMS
from .common import Actor, audit, get_actor, load_patient
from ..services.scheduling import serial_schedule
from ..timeutil import hospital_now

router = APIRouter(prefix="/api", tags=["care"])


def day_bounds(d: str | None):
    try:
        day = date.fromisoformat(d) if d else hospital_now().date()
    except ValueError:
        raise HTTPException(422, "Use YYYY-MM-DD")
    start = datetime.combine(day, datetime.min.time())
    return start, start + timedelta(days=1)


# ---------------- medicines & reminders ----------------
@router.get("/patients/{patient_id}/medications")
def medications(patient: Patient = Depends(load_patient), db: Session = Depends(get_db)):
    meds = db.scalars(select(Medication).where(Medication.patient_id == patient.id,
                                               Medication.active.is_(True))).all()
    start, end = day_bounds(None)
    logs = db.scalars(select(MedLog).where(MedLog.patient_id == patient.id, MedLog.scheduled_for >= start,
                                           MedLog.scheduled_for < end)).all()
    status = {(l.medication_id, l.scheduled_for.strftime("%H:%M")): l.status for l in logs}
    out = []
    for m in meds:
        doses = [{"time": t, "status": status.get((m.id, t), "due")} for t in m.times]
        out.append({"id": m.id, "name": m.name, "dose": m.dose, "frequency": m.frequency,
                    "instructions": m.instructions, "today": doses})
    return out


class MedLogIn(BaseModel):
    medication_id: int
    time: str        # "08:00"
    status: str      # taken | missed


@router.post("/med-logs")
def log_med(body: MedLogIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    m = db.get(Medication, body.medication_id)
    if not m:
        raise HTTPException(404, "Medication not found")
    from ..round2_models import User
    from ..security import require_patient, roles
    user = db.get(User, actor.id)
    require_patient(db, user, m.patient_id, "medicines")
    roles(user, "patient", "caregiver", "nurse", "doctor")
    import re
    if body.status not in {"taken", "missed"} or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", body.time) or body.time not in m.times:
        raise HTTPException(422, "Use an approved reminder time and taken/missed status")
    h, mi = map(int, body.time.split(":"))
    when = datetime.combine(date.today(), datetime.min.time()).replace(hour=h, minute=mi)
    existing = db.scalars(select(MedLog).where(MedLog.medication_id == m.id, MedLog.scheduled_for == when)).first()
    if existing:
        existing.status = body.status
    else:
        db.add(MedLog(medication_id=m.id, patient_id=m.patient_id, scheduled_for=when, status=body.status))
    db.commit()
    if body.status == "missed":
        from ..services.companion import alert
        alert(db, m.patient_id, "Missed prescribed dose: " + m.name, "medicine log", "warning")
    audit(db, actor, f"medicine_{body.status}", m.patient_id, f"{m.name} {body.time}")
    return {"ok": True}


# ---------------- symptoms ----------------
class SymptomIn(BaseModel):
    patient_id: str
    language: str = "en"
    symptoms: list[dict]          # [{"key": "nausea", "grade": 2}]
    missed_meds: list[str] = []
    free_text: str = ""


@router.post("/symptom-reports")
def report_symptoms(body: SymptomIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    p = db.get(Patient, body.patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    from ..round2_models import User
    from ..security import require_patient, roles
    user = db.get(User, actor.id)
    require_patient(db, user, p.id, "checkin")
    roles(user, "patient", "caregiver", "nurse", "doctor")
    if any(s.get("key") not in {x["key"] for x in SYMPTOMS} or not isinstance(s.get("grade"), int) or not 0 <= s["grade"] <= 4 for s in body.symptoms):
        raise HTTPException(422, "Unknown symptom or invalid grade")
    names = {s["key"]: s["en"] for s in SYMPTOMS}
    sy = [{"key": s["key"], "name": names.get(s["key"], s["key"]), "grade": int(s.get("grade", 0))}
          for s in body.symptoms if int(s.get("grade", 0)) > 0]
    flagged = any(s["grade"] >= 3 or (s["key"] == "fever" and s["grade"] >= 1) for s in sy)
    r = SymptomReport(patient_id=p.id, language=body.language, symptoms=sy, missed_meds=body.missed_meds,
                      free_text=body.free_text.strip(), flagged=flagged)
    db.add(r)
    db.commit()
    audit(db, actor, "symptom_report", p.id, ", ".join(f"{s['name']} g{s['grade']}" for s in sy))
    from ..services.companion import alert, red_flags
    flag = red_flags(body.free_text, sy, on_treatment=bool(p.current_regimen))
    if flagged or flag["level"] >= 2:
        alert(db, p.id, flag["reason"] or "Severe patient symptom", "symptom report", "emergency" if flag["level"] == 3 else "urgent")
    return {"id": r.id, "flagged": flagged or flag["level"] >= 2,
            "message": "Sent to your care team." + (" Because you reported a fever or a severe symptom, "
                                                    "please also call the hospital helpline now." if flagged else "")}


@router.get("/patients/{patient_id}/symptoms")
def symptom_history(patient: Patient = Depends(load_patient), db: Session = Depends(get_db)):
    rows = db.scalars(select(SymptomReport).where(SymptomReport.patient_id == patient.id)
                      .order_by(SymptomReport.reported_at.desc())).all()
    return [{"id": r.id, "reported_at": r.reported_at.isoformat(), "language": r.language, "symptoms": r.symptoms,
             "missed_meds": r.missed_meds, "free_text": r.free_text, "flagged": r.flagged} for r in rows]


@router.get("/patients/{patient_id}/activity")
def activity(patient: Patient = Depends(load_patient), db: Session = Depends(get_db)):
    rows = db.scalars(select(Activity).where(Activity.patient_id == patient.id).order_by(Activity.date)).all()
    return [{"date": a.date.date().isoformat(), "steps": a.steps, "sleep_hours": a.sleep_hours,
             "resting_hr": a.resting_hr} for a in rows[-14:]]


# ---------------- appointments & schedule ----------------
def appt_dict(a: Appointment, db: Session) -> dict:
    p = db.get(Patient, a.patient_id)
    visit = db.scalar(select(VirtualAppointment).where(VirtualAppointment.appointment_id == a.id))
    from ..services.google_meet import public_visit
    return {"id": a.id, "patient_id": a.patient_id, "patient_name": p.name if p else "", "department": a.department,
            "clinician": a.clinician, "room": a.room, "start": a.start.isoformat(), "end": a.end.isoformat(),
            "visit_type": a.visit_type, "status": a.status, "notes": a.notes,
            "virtual_visit": public_visit(visit)}


@router.get("/appointments")
def appointments(request: Request, day: str | None = None, department: str = "", patient_id: str = "", upcoming: bool = False,
                 db: Session = Depends(get_db)):
    from ..security import identity, visible_ids
    stmt = select(Appointment).where(Appointment.patient_id.in_(visible_ids(db, identity(request), "appointments"))).order_by(Appointment.start)
    if upcoming:
        stmt = stmt.where(Appointment.start >= hospital_now() - timedelta(hours=2))
    else:
        start, end = day_bounds(day)
        stmt = stmt.where(Appointment.start >= start, Appointment.start < end)
    if department:
        stmt = stmt.where(Appointment.department == department)
    if patient_id:
        stmt = stmt.where(Appointment.patient_id == patient_id)
    return [appt_dict(a, db) for a in db.scalars(stmt).all()]


def find_clashes(appts: list[Appointment]) -> list[dict]:
    clashes = []
    for i, a in enumerate(appts):
        for b in appts[i + 1:]:
            if a.start < b.end and b.start < a.end:
                if a.patient_id == b.patient_id:
                    clashes.append({"type": "patient", "ids": [a.id, b.id],
                                    "text": f"Same patient booked in {a.department} ({a.start:%H:%M}) and "
                                            f"{b.department} ({b.start:%H:%M})"})
                elif a.room == b.room and a.department == b.department:
                    clashes.append({"type": "room", "ids": [a.id, b.id],
                                    "text": f"{a.room} double-booked {max(a.start, b.start):%H:%M}–{min(a.end, b.end):%H:%M}"})
    return clashes


@router.get("/schedule")
def schedule(request: Request, day: str | None = None, db: Session = Depends(get_db)):
    start, end = day_bounds(day)
    from ..security import identity, visible_ids
    appts = db.scalars(select(Appointment).where(Appointment.patient_id.in_(visible_ids(db, identity(request), "appointments")), Appointment.start >= start, Appointment.start < end)
                       .order_by(Appointment.start)).all()
    return {"date": start.date().isoformat(), "departments": [d["name"] for d in DEPARTMENTS],
            "appointments": [appt_dict(a, db) for a in appts], "clashes": find_clashes(appts)}


@router.get("/slots")
def slots(department: str, day: str, db: Session = Depends(get_db)):
    start, end = day_bounds(day)
    taken = db.scalars(select(Appointment).where(Appointment.department == department,
                                                 Appointment.start >= start, Appointment.start < end)).all()
    out = []
    t = start.replace(hour=9)
    while t < start.replace(hour=16, minute=30):
        busy = sum(1 for a in taken if a.start <= t < a.end)
        if t > hospital_now() and busy < 2:
            out.append(t.strftime("%H:%M"))
        t += timedelta(minutes=20)
    return out


class AppointmentIn(BaseModel):
    patient_id: str
    department: str
    start: str           # ISO
    visit_type: str = "follow_up"
    notes: str | None = None
    visit_mode: Literal["in_person", "google_meet"] = "in_person"
    clinician_type: Literal["oncologist", "psychiatrist"] | None = None
    patient_email: str = ""
    caregiver_email: str = ""
    clinician_email: str = ""
    include_caregiver: bool = False
    invitation_consent: bool = False


@router.post("/appointments")
@serial_schedule
def book(body: AppointmentIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    p = db.get(Patient, body.patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    user = db.get(User, actor.id)
    if not user:
        raise HTTPException(401, "Please sign in")
    from ..security import roles
    roles(user, "patient", "caregiver", "doctor", "nurse", "frontdesk", "admin")
    from ..security import require_patient
    require_patient(db, user, p.id, "appointments")
    if body.visit_mode == "google_meet":
        if not body.clinician_type:
            raise HTTPException(422, "Choose an oncologist or psychiatrist for the video consultation")
        if not body.invitation_consent:
            raise HTTPException(422, "Consent is required before sending calendar invitations")
        if body.include_caregiver and not body.caregiver_email.strip():
            raise HTTPException(422, "Enter the caregiver email or unselect caregiver participation")
        emails = [body.patient_email.strip(), body.clinician_email.strip()]
        if body.include_caregiver:
            emails.append(body.caregiver_email.strip())
        email_pattern = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
        if any(len(email) > 254 or not email_pattern.fullmatch(email) for email in emails):
            raise HTTPException(422, "Enter a valid email for the patient and selected clinician/caregiver")
        required_department = "Psycho-oncology" if body.clinician_type == "psychiatrist" else "Medical Oncology OPD"
        department_name = required_department
    else:
        department_name = body.department
    dept = next((d for d in DEPARTMENTS if d["name"] == department_name), None)
    if not dept:
        raise HTTPException(422, "Unknown department")
    try:
        start = datetime.fromisoformat(body.start).replace(tzinfo=None)
    except ValueError:
        raise HTTPException(422, "Invalid start date")
    if start < hospital_now() or not 8 <= start.hour < 17:
        raise HTTPException(422, "Book a future appointment between 08:00 and 17:00")
    end = start + timedelta(minutes=20)
    overlapping = db.scalars(select(Appointment).where(Appointment.status != "cancelled", Appointment.start < end, Appointment.end > start)).all()
    if any(a.patient_id == p.id for a in overlapping):
        raise HTTPException(409, "The patient already has an appointment at this time. Choose another slot.")
    if body.visit_mode == "google_meet":
        room = f"Online-{secrets.token_hex(3)}"
    else:
        room = next((r for r in dept["rooms"] if not any(a.room == r and a.department == dept["name"] for a in overlapping)), None)
        if room is None:
            raise HTTPException(409, "No room is free at this time. Choose another slot.")
    clinician = ("Psychiatrist" if body.visit_mode == "google_meet" and body.clinician_type == "psychiatrist"
                 else p.treating_oncologist or "Duty doctor")
    a = Appointment(patient_id=p.id, department=dept["name"], clinician=clinician,
                    room=room, start=start, end=end,
                    visit_type=body.visit_type, notes=body.notes)
    db.add(a)
    db.flush()
    if body.visit_mode == "google_meet":
        from ..services.google_meet import configured
        invitees = [body.patient_email.strip().lower(), body.clinician_email.strip().lower()]
        if body.include_caregiver:
            invitees.append(body.caregiver_email.strip().lower())
        visit = VirtualAppointment(
            appointment_id=a.id, patient_id=p.id, clinician_type=body.clinician_type,
            status="creating" if configured() else "needs_setup",
            invitees=json.dumps(list(dict.fromkeys(invitees))),
            caregiver_included=body.include_caregiver, created_by=user.id,
        )
        db.add(visit)
    db.commit()
    if body.visit_mode == "google_meet":
        from ..services.google_meet import notify_appointment_participants
        notify_appointment_participants(db, p.id, "Video appointment booked", "Your Google Meet consultation is on the appointment day pass. Open OncoBrief for the link or setup status.")
    same_day = db.scalars(select(Appointment).where(Appointment.start >= start.replace(hour=0, minute=0),
                                                    Appointment.start < start.replace(hour=23, minute=59))).all()
    warn = [c for c in find_clashes(same_day) if a.id in c["ids"]]
    audit(db, actor, "book_appointment", p.id, f"{dept['name']} {start:%d %b %H:%M}")
    return appt_dict(a, db) | {"clashes": warn}
