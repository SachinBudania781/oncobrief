from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Activity, Appointment, Medication, MedLog, Patient, SymptomReport
from ..taxonomy import DEPARTMENTS, SYMPTOMS
from .common import Actor, audit, get_actor, load_patient

router = APIRouter(prefix="/api", tags=["care"])


def day_bounds(d: str | None):
    day = date.fromisoformat(d) if d else date.today()
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
    h, mi = map(int, body.time.split(":"))
    when = datetime.combine(date.today(), datetime.min.time()).replace(hour=h, minute=mi)
    existing = db.scalars(select(MedLog).where(MedLog.medication_id == m.id, MedLog.scheduled_for == when)).first()
    if existing:
        existing.status = body.status
    else:
        db.add(MedLog(medication_id=m.id, patient_id=m.patient_id, scheduled_for=when, status=body.status))
    db.commit()
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
    names = {s["key"]: s["en"] for s in SYMPTOMS}
    sy = [{"key": s["key"], "name": names.get(s["key"], s["key"]), "grade": int(s.get("grade", 0))}
          for s in body.symptoms if int(s.get("grade", 0)) > 0]
    flagged = any(s["grade"] >= 3 or (s["key"] == "fever" and s["grade"] >= 1) for s in sy)
    r = SymptomReport(patient_id=p.id, language=body.language, symptoms=sy, missed_meds=body.missed_meds,
                      free_text=body.free_text.strip(), flagged=flagged)
    db.add(r)
    db.commit()
    audit(db, actor, "symptom_report", p.id, ", ".join(f"{s['name']} g{s['grade']}" for s in sy))
    return {"id": r.id, "flagged": flagged,
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
    return {"id": a.id, "patient_id": a.patient_id, "patient_name": p.name if p else "", "department": a.department,
            "clinician": a.clinician, "room": a.room, "start": a.start.isoformat(), "end": a.end.isoformat(),
            "visit_type": a.visit_type, "status": a.status, "notes": a.notes}


@router.get("/appointments")
def appointments(day: str | None = None, department: str = "", patient_id: str = "", upcoming: bool = False,
                 db: Session = Depends(get_db)):
    stmt = select(Appointment).order_by(Appointment.start)
    if upcoming:
        stmt = stmt.where(Appointment.start >= datetime.now() - timedelta(hours=2))
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
def schedule(day: str | None = None, db: Session = Depends(get_db)):
    start, end = day_bounds(day)
    appts = db.scalars(select(Appointment).where(Appointment.start >= start, Appointment.start < end)
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
        if t > datetime.now() and busy < 2:
            out.append(t.strftime("%H:%M"))
        t += timedelta(minutes=20)
    return out


class AppointmentIn(BaseModel):
    patient_id: str
    department: str
    start: str           # ISO
    visit_type: str = "follow_up"
    notes: str | None = None


@router.post("/appointments")
def book(body: AppointmentIn, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    p = db.get(Patient, body.patient_id)
    if not p:
        raise HTTPException(404, "Patient not found")
    dept = next((d for d in DEPARTMENTS if d["name"] == body.department), None)
    if not dept:
        raise HTTPException(422, "Unknown department")
    start = datetime.fromisoformat(body.start)
    a = Appointment(patient_id=p.id, department=dept["name"], clinician=p.treating_oncologist or "Duty doctor",
                    room=dept["rooms"][0], start=start, end=start + timedelta(minutes=20),
                    visit_type=body.visit_type, notes=body.notes)
    db.add(a)
    db.commit()
    same_day = db.scalars(select(Appointment).where(Appointment.start >= start.replace(hour=0, minute=0),
                                                    Appointment.start < start.replace(hour=23, minute=59))).all()
    warn = [c for c in find_clashes(same_day) if a.id in c["ids"]]
    audit(db, actor, "book_appointment", p.id, f"{dept['name']} {start:%d %b %H:%M}")
    return appt_dict(a, db) | {"clashes": warn}
