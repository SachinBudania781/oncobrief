"""Seeds the demo database on startup (and every new day, so 'today's clinic' is always today).

Scanned demo pages are OCR'd once at build time (python -m seed.loader --build-ocr) and the text is stored in
seed/ocr_manifest.json; at seed time the pages are re-rendered with today's dates and the stored OCR text gets
the same date shift. Live uploads are always OCR'd for real."""
from __future__ import annotations

import json
import random
import re
import shutil
import sys
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

from app.config import DATA_DIR, STORAGE_DIR
from app.db import Base, SessionLocal, engine
from app.models import Activity, Appointment, Medication, MedLog, Meta, Patient, SymptomReport
from app.routers.documents import store_document
from app.services.ocr import extract_text
from app.taxonomy import CATEGORIES, SYMPTOMS

from . import data
from .render import render

MANIFEST = Path(__file__).parent / "ocr_manifest.json"
REF_DAY = date(2026, 10, 2)  # day the manifest was built
SCANNER_DIR = DATA_DIR / "scanner_samples"


def _key(spec: dict) -> str:
    return f"{spec['pid']}|{spec['day']}|{spec['time']}|{spec['subtype']}|{spec['title']}"


def _shift_dates(text: str, delta_days: int) -> str:
    if not delta_days:
        return text

    def sub(m):
        try:
            d = datetime.strptime(m.group(0), "%d/%m/%Y") + timedelta(days=delta_days)
            return d.strftime("%d/%m/%Y")
        except ValueError:  # OCR misread the date — leave it, like a real scan
            return m.group(0)
    return re.sub(r"\b\d{2}/\d{2}/\d{4}\b", sub, text)


def build_ocr_manifest():
    """Run real Tesseract on every scanned/photo demo page once (dates rendered for REF_DAY)."""
    today = datetime.combine(REF_DAY, datetime.min.time())
    pats = {p["id"]: p for p in data.PATIENTS}
    out = {}
    with tempfile.TemporaryDirectory() as tmp:
        for i, spec in enumerate(data.DOCUMENTS):
            if spec["fmt"] == "pdf":
                continue
            f = render(spec, pats[spec["pid"]], today, Path(tmp) / f"d{i}")
            text, method, conf = extract_text(f, "image/jpeg")
            out[_key(spec)] = {"text": text, "method": method, "confidence": conf}
            print(f"OCR {conf}%  {spec['title']}")
    MANIFEST.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"wrote {MANIFEST} ({len(out)} pages)")


def _at(day_offset: int, hhmm: str, today: datetime) -> datetime:
    return (today + timedelta(days=day_offset)).replace(hour=int(hhmm[:2]), minute=int(hhmm[3:]))


def ensure_seeded(force: bool = False):
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        stamp = db.get(Meta, "seed_date")
        if stamp and stamp.value == date.today().isoformat() and not force:
            return
    finally:
        db.close()
    seed()


def seed():
    print("[seed] building demo world for", date.today())
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    shutil.rmtree(STORAGE_DIR, ignore_errors=True)
    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    today = datetime.combine(date.today(), datetime.min.time())
    delta = (date.today() - REF_DAY).days
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}
    pats = {p["id"]: p for p in data.PATIENTS}

    db = SessionLocal()
    try:
        for p in data.PATIENTS:
            fields = {k: v for k, v in p.items() if k != "diagnosis_day"}
            fields["diagnosis_date"] = today + timedelta(days=p["diagnosis_day"])
            if fields.get("current_regimen"):
                fields["current_regimen"] = re.sub(
                    r"\{d(-?\d+)\}", lambda m: (today + timedelta(days=int(m.group(1)))).strftime("%d %b %Y"),
                    fields["current_regimen"])
            db.add(Patient(**fields))
        db.commit()

        with tempfile.TemporaryDirectory() as tmp:
            for i, spec in enumerate(data.DOCUMENTS):
                patient = db.get(Patient, spec["pid"])
                f = render(spec, pats[spec["pid"]], today, Path(tmp) / f"d{i}")
                mime = "application/pdf" if f.suffix == ".pdf" else "image/jpeg"
                pre = manifest.get(_key(spec)) if spec["fmt"] != "pdf" else None
                kwargs = {}
                if pre:
                    kwargs = dict(ocr_text=_shift_dates(pre["text"], delta), ocr_method="tesseract",
                                  ocr_conf=pre["confidence"])
                who = {"external": f"ABHA link - {spec['hospital']} (simulated)", "patient": "Patient app (self)"}
                store_document(
                    db, patient, category=spec["category"], subtype=spec["subtype"],
                    record_date=_at(spec["day"], spec["time"], today), title=spec["title"],
                    department=spec["dept"] or CATEGORIES[spec["category"]]["department"],
                    uploaded_by=who.get(spec["source"], f"{spec['dept'] or CATEGORIES[spec['category']]['department']} staff"),
                    source=spec["source"], src_path=f, mime=mime, external_hospital=spec["hospital"],
                    lab_values=[{"test": t, "value": v} for t, v in spec["labs"]],
                    uploaded_at=_at(spec["day"], spec["time"], today) + timedelta(hours=2), **kwargs)

        # scanner samples rendered with today's date
        SCANNER_DIR.mkdir(parents=True, exist_ok=True)
        for old in SCANNER_DIR.glob("*"):
            old.unlink()
        for i, spec in enumerate(data.SCANNER_SAMPLES):
            render(spec, pats[spec["pid"]], today, SCANNER_DIR / f"scan_{i:02d}_{spec['subtype'].lower()}")

        meds = {}
        for pid, name, dose, freq, times in data.MEDICATIONS:
            m = Medication(patient_id=pid, name=name, dose=dose, frequency=freq, times=times,
                           start=today - timedelta(days=30), active=True)
            db.add(m)
            db.flush()
            meds[(pid, name)] = m
        for pid, day, hhmm, name, status in data.MED_LOGS:
            m = meds[(pid, name)]
            db.add(MedLog(medication_id=m.id, patient_id=pid, scheduled_for=_at(day, hhmm, today), status=status,
                          logged_at=_at(day, hhmm, today) + timedelta(minutes=30)))

        names = {s["key"]: s["en"] for s in SYMPTOMS}
        for pid, day, hhmm, lang, sy, missed, text in data.SYMPTOM_REPORTS:
            items = [{"key": k, "name": names[k], "grade": g} for k, g in sy]
            flagged = any(g >= 3 or (k == "fever" and g >= 1) for k, g in sy)
            db.add(SymptomReport(patient_id=pid, reported_at=_at(day, hhmm, today), language=lang, symptoms=items,
                                 missed_meds=missed, free_text=text, flagged=flagged))

        for pid, dept, room, clin, hhmm, mins, vt, notes in data.APPOINTMENTS_TODAY:
            start = _at(0, hhmm, today)
            db.add(Appointment(patient_id=pid, department=dept, clinician=clin, room=room, start=start,
                               end=start + timedelta(minutes=mins), visit_type=vt, notes=notes))
        # a few past + future appointments so the patient app has history
        for pid in [p["id"] for p in data.PATIENTS[:5]]:
            db.add(Appointment(patient_id=pid, department="Medical Oncology OPD", clinician=data.ONCOLOGIST,
                               room="OPD-3", start=_at(14, "10:30", today), end=_at(14, "10:50", today),
                               visit_type="follow_up", notes="Next review"))

        rng = random.Random(11)
        for pid, (base, trend) in data.ACTIVITY.items():
            for k in range(14):
                day = today - timedelta(days=13 - k)
                steps = int(base + trend * k + rng.randint(-600, 600))
                db.add(Activity(patient_id=pid, date=day, steps=max(steps, 800),
                                sleep_hours=round(rng.uniform(5.2, 7.6), 1), resting_hr=rng.randint(68, 86)))

        db.merge(Meta(key="seed_date", value=date.today().isoformat()))
        db.commit()
        print("[seed] done")
    finally:
        db.close()


if __name__ == "__main__":
    if "--build-ocr" in sys.argv:
        build_ocr_manifest()
    else:
        ensure_seeded(force=True)
