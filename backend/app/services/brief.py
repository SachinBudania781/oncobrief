"""The doctor's brief — the ONLY place AI is used.

Pipeline (one request):
  1. structured pull (SQL)          — profile, labs, meds, symptoms, missed doses, appointments
  2. retrieve (BM25 over OCR text)  — visit-type query plan + recency
  3. rule-based alerts (plain code) — abnormal labs, trends, symptoms, missed meds, low-quality scans
  4. generate                       — LLM writes the narrative with [D#] citations, or the
                                      deterministic writer does it when no key is configured
  5. validate                       — any statement without a real source from THIS patient is dropped
"""
from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Activity, Appointment, Brief, Document, LabValue, Medication, MedLog, Patient, SymptomReport
from ..taxonomy import NEW_PATIENT_CHECKLIST, VISIT_TYPES
from . import llm
from .retrieval import retrieve

LOW_OCR = 75  # % mean Tesseract word confidence below which a scan is flagged
KEY_TESTS = ["Haemoglobin", "WBC", "ANC", "Platelets", "Creatinine", "ALT", "Bilirubin", "CEA", "CA 15-3"]
HEADLINE_KEYS = ("impression", "final diagnosis", "diagnosis", "conclusion", "result", "interpretation",
                 "assessment", "reason for referral", "summary", "plan", "findings")


def fmt(d: datetime) -> str:
    return d.strftime("%d %b %Y").lstrip("0")


def tag(doc_id: int) -> str:
    return f"D{doc_id}"


def headline(doc: Document) -> str:
    """Pick the most informative line of a report (IMPRESSION:, DIAGNOSIS: …) — extractive, no AI."""
    lines = [l.strip() for l in (doc.ocr_text or "").splitlines() if l.strip()]
    heading = re.compile(r"^[A-Z][A-Z /\-&()]{2,40}:")
    stop = re.compile(r"^(electronically signed|oncobrief prototype|demo document)", re.I)
    for key in HEADLINE_KEYS:
        for i, line in enumerate(lines):
            if line.lower().startswith(key) and ":" in line[: len(key) + 4]:
                parts = [line.split(":", 1)[1].strip()]
                for nxt in lines[i + 1:]:  # follow wrapped lines until the next HEADING: or footer
                    if heading.match(nxt) or stop.match(nxt) or sum(len(p) for p in parts) > 320:
                        break
                    parts.append(nxt)
                rest = " ".join(p for p in parts if p)
                if rest:
                    return _clean(rest)
    return doc.title


def _clean(s: str, limit: int = 220) -> str:
    s = re.sub(r"\s+", " ", s).strip(" -:;")
    return s if len(s) <= limit else s[: limit - 1].rsplit(" ", 1)[0] + "…"


# ----------------------------------------------------------------------------------------------
def gather(db: Session, patient: Patient, visit_type: str, now: datetime) -> dict:
    docs = db.scalars(select(Document).where(Document.patient_id == patient.id)
                      .order_by(Document.record_date)).all()
    labs = db.scalars(select(LabValue).where(LabValue.patient_id == patient.id)
                      .order_by(LabValue.measured_at)).all()
    meds = db.scalars(select(Medication).where(Medication.patient_id == patient.id,
                                               Medication.active.is_(True))).all()
    reports = db.scalars(select(SymptomReport).where(SymptomReport.patient_id == patient.id)
                         .order_by(SymptomReport.reported_at)).all()
    logs = db.scalars(select(MedLog).where(MedLog.patient_id == patient.id)).all()
    acts = db.scalars(select(Activity).where(Activity.patient_id == patient.id)
                      .order_by(Activity.date)).all()
    upcoming = db.scalars(select(Appointment).where(Appointment.patient_id == patient.id,
                                                    Appointment.start >= now.replace(hour=0, minute=0))
                          .order_by(Appointment.start)).all()

    # "last visit" = most recent consultation or treatment note before today
    visit_docs = [d for d in docs if d.subtype in ("Consultation transcript", "Chemotherapy cycle note",
                                                   "Targeted / immunotherapy note")
                  and d.record_date < now.replace(hour=0, minute=0)]
    last_visit = visit_docs[-1].record_date if visit_docs else (now - timedelta(days=30))
    if visit_type != "follow_up":
        last_visit = now - timedelta(days=30)
    return dict(docs=docs, labs=labs, meds=meds, reports=reports, logs=logs, acts=acts,
                upcoming=upcoming, last_visit=last_visit, last_visit_doc=visit_docs[-1] if visit_docs else None)


def lab_series(labs: list[LabValue]) -> dict:
    series = defaultdict(list)
    for l in labs:
        series[l.test].append({"date": l.measured_at.isoformat(), "value": l.value, "unit": l.unit,
                               "flag": l.flag, "ref_low": l.ref_low, "ref_high": l.ref_high,
                               "doc": tag(l.document_id) if l.document_id else None})
    ordered = {t: series[t] for t in KEY_TESTS if t in series}
    ordered.update({t: v for t, v in series.items() if t not in ordered})
    return ordered


def build_alerts(ctx: dict, series: dict, visit_type: str, now: datetime) -> list[dict]:
    alerts = []
    for test, pts in series.items():
        last = pts[-1]
        if not last["flag"]:
            continue
        sev = "warning"
        v = last["value"]
        if (test == "ANC" and v < 1.0) or (test == "Haemoglobin" and v < 8) or (test == "Platelets" and v < 50):
            sev = "critical"
        last_dt = datetime.fromisoformat(last["date"])
        if (now - last_dt).days > 60:  # stale values are in the charts, not the alerts
            continue
        msg = f"{test} {v:g} {last['unit']} ({'low' if last['flag'] == 'L' else 'high'}) on {fmt(last_dt)}"
        if len(pts) >= 2:
            prev = pts[-2]
            msg += f" — previous {prev['value']:g} on {fmt(datetime.fromisoformat(prev['date']))}"
            if len(pts) >= 3:
                msg += f", first {pts[0]['value']:g} on {fmt(datetime.fromisoformat(pts[0]['date']))}"
        alerts.append({"level": sev, "kind": "lab", "text": msg, "sources": [s for s in [last["doc"]] if s]})

    window_start = ctx["last_visit"]
    for r in ctx["reports"]:
        if r.reported_at < window_start:
            continue
        for s in r.symptoms:
            g = int(s.get("grade", 0))
            if g >= 3 or (s.get("key") == "fever" and g >= 1):
                alerts.append({"level": "critical" if g >= 3 else "warning", "kind": "symptom",
                               "text": f"Patient reported {s['name'].lower()} (grade {g}) on {fmt(r.reported_at)}",
                               "sources": [f"S{r.id}"]})
    missed = [l for l in ctx["logs"] if l.status == "missed" and l.scheduled_for >= window_start]
    if missed:
        med_names = {m.id: f"{m.name} {m.dose}" for m in ctx["meds"]}
        by_med = defaultdict(list)
        for l in missed:
            by_med[med_names.get(l.medication_id, "medicine")].append(l.scheduled_for)
        for name, dates in by_med.items():
            alerts.append({"level": "warning", "kind": "missed",
                           "text": f"{len(dates)} missed dose{'s' if len(dates) > 1 else ''} of {name} since last visit "
                                   f"({', '.join(fmt(d) for d in sorted(dates)[:3])})",
                           "sources": ["Medication log"]})
    # imaging impressions that use change words — quoted, never interpreted
    for d in ctx["docs"]:
        if d.category == "Imaging" and (now - d.record_date).days <= 60:
            for sent in re.split(r"(?<=\.)\s+", headline(d)):
                # quote sentences that report change; skip negated ones ("No new lesion", "no evidence of…")
                if re.search(r"\bnew\b|progress|increase|metasta", sent, re.I) and \
                        not re.search(r"\bno\b|\bwithout\b|\bnegative\b", sent, re.I):
                    alerts.append({"level": "warning", "kind": "imaging", "text": f"{d.subtype} {fmt(d.record_date)}: {sent}",
                                   "sources": [tag(d.id)]})
                    break
    for d in ctx["docs"]:
        if d.ocr_confidence is not None and d.ocr_confidence < LOW_OCR:
            alerts.append({"level": "info", "kind": "ocr", "text": f"Low-quality scan ({d.ocr_confidence:.0f}% OCR confidence): "
                                                    f"{d.title} — check the original", "sources": [tag(d.id)]})
    order = {"critical": 0, "warning": 1, "info": 2}
    kinds = {"imaging": 0, "symptom": 1, "lab": 2, "missed": 3, "ocr": 4, "missing": 5}
    alerts.sort(key=lambda a: (order[a["level"]], kinds.get(a.get("kind"), 9)))
    return alerts


def missing_documents(patient: Patient, docs: list[Document]) -> list[str]:
    site = (patient.cancer_type or "").lower()
    key = next((k for k in NEW_PATIENT_CHECKLIST if k != "default" and k in site), "default")
    have = {(d.category, d.subtype) for d in docs}
    return [f"{cat}: {sub}" for cat, sub in NEW_PATIENT_CHECKLIST[key] if (cat, sub) not in have]


# ----------------------------------------------------------------------------------------------
def deterministic_narrative(patient: Patient, ctx: dict, retrieved: list[dict], series: dict,
                            visit_type: str, missing: list[str], now: datetime) -> dict:
    docs = ctx["docs"]
    by_id = {d.id: d for d in docs}
    path_docs = [d for d in docs if d.category == "Pathology"]
    treat_docs = [d for d in docs if d.category == "Treatment" and d.subtype != "Function test (PFT etc.)"]
    summary = []

    ct = patient.cancer_type or "a suspected malignancy"
    if len(ct) > 1 and ct[1].islower():
        ct = ct[0].lower() + ct[1:]
    dx = f"{patient.name.split()[0]} is a {patient.age}{patient.sex} with {ct}"
    if patient.stage:
        dx += f", {patient.stage}"
    if patient.diagnosis_date:
        dx += f", diagnosed {patient.diagnosis_date.strftime('%b %Y')}"
    summary.append({"text": dx + ".", "sources": [tag(path_docs[0].id)] if path_docs else []})

    if visit_type == "follow_up":
        if patient.current_regimen:
            s = f"Current treatment: {patient.current_regimen}."
            src = []
            if treat_docs:
                s = s[:-1] + f"; last treatment note: {treat_docs[-1].title} on {fmt(treat_docs[-1].record_date)}."
                src = [tag(treat_docs[-1].id)]
            summary.append({"text": s, "sources": src})
        new_docs = [d for d in docs if d.record_date > ctx["last_visit"]]
        reps = [r for r in ctx["reports"] if r.reported_at > ctx["last_visit"]]
        missed = [l for l in ctx["logs"] if l.status == "missed" and l.scheduled_for > ctx["last_visit"]]
        summary.append({"text": f"Since the last visit on {fmt(ctx['last_visit'])}: {len(new_docs)} new document(s), "
                                f"{len(reps)} patient symptom report(s), {len(missed)} missed medicine dose(s).",
                        "sources": [tag(d.id) for d in new_docs[:4]]})
        cbc = [d for d in docs if d.subtype == "CBC"]
        if cbc and "Haemoglobin" in series:
            parts = []
            for t in ("Haemoglobin", "ANC", "Platelets"):
                if t in series:
                    p = series[t][-1]
                    parts.append(f"{t} {p['value']:g}{' (' + p['flag'] + ')' if p['flag'] else ''}")
            summary.append({"text": f"Latest CBC {fmt(cbc[-1].record_date)}: " + ", ".join(parts) + ".",
                            "sources": [tag(cbc[-1].id)]})
    elif visit_type == "new":
        ref = next((d for d in reversed(docs) if d.subtype == "Referral letter"), None)
        if ref:
            summary.append({"text": f"Referred by {patient.referred_from or 'outside clinician'}: {headline(ref)}",
                            "sources": [tag(ref.id)]})
        if path_docs:
            pd = path_docs[-1]
            low = " (low-quality scan - read the original)" if (pd.ocr_confidence or 100) < LOW_OCR else ""
            summary.append({"text": f"Pathology so far ({fmt(pd.record_date)}): {headline(pd)}{low}",
                            "sources": [tag(path_docs[-1].id)]})
        summary.append({"text": f"{len(docs)} document(s) in the folder"
                                + (f"; not yet in the folder: {', '.join(m.split(': ')[1] for m in missing)}." if missing else "."),
                        "sources": []})
    else:  # transfer
        ext = [d for d in docs if d.source == "external"]
        hosp = sorted({d.external_hospital for d in ext if d.external_hospital})
        summary.append({"text": f"Transferring care from {', '.join(hosp) or patient.referred_from or 'another hospital'}; "
                                f"{len(ext)} external record(s) linked via ABHA (simulated) and merged into this folder.",
                        "sources": [tag(d.id) for d in ext[-2:]]})
        dis = next((d for d in reversed(docs) if d.subtype in ("Discharge summary", "Referral letter")), None)
        if dis:
            summary.append({"text": f"{dis.subtype} ({fmt(dis.record_date)}): {headline(dis)}", "sources": [tag(dis.id)]})
        mol = next((d for d in reversed(docs) if d.subtype == "Molecular / genomics"), None)
        if mol:
            summary.append({"text": f"Molecular profile: {headline(mol)}", "sources": [tag(mol.id)]})
        img = [d for d in docs if d.category == "Imaging"]
        if img:
            summary.append({"text": f"Most recent imaging ({img[-1].subtype}, {fmt(img[-1].record_date)}): {headline(img[-1])}",
                            "sources": [tag(img[-1].id)]})

    # key findings: the headline line of the top retrieved documents
    seen, findings = set(), []
    for c in retrieved:
        d = by_id.get(c["doc_id"])
        if not d or d.id in seen or d.category == "Lab report":
            continue
        seen.add(d.id)
        findings.append({"date": d.record_date.isoformat(),
                         "text": f"{d.subtype}: {headline(d)}",
                         "sources": [tag(d.id)]})
        if len(findings) >= 7:
            break
    findings.sort(key=lambda f: f["date"], reverse=(visit_type == "follow_up"))
    return {"summary": summary, "key_findings": findings}


SYSTEM_PROMPT = """You are OncoBrief, a clinical documentation assistant for oncologists in Indian cancer centres.
You SUMMARISE existing records for a consultation. You never diagnose, never change staging, never recommend
tests, drugs, doses or treatment, and never speculate. Every statement MUST end with source tags taken
ONLY from the ids given (e.g. ["D12","D15"]). If something is not in the records, do not say it.
Write in short, factual clinical English. Use dates. Return ONLY JSON with this shape:
{"summary":[{"text":"...","sources":["D1"]}],"key_findings":[{"date":"YYYY-MM-DD","text":"...","sources":["D3"]}]}
summary = 3-4 sentences tailored to the visit type; key_findings = 4-8 most decision-relevant facts."""

VISIT_FOCUS = {
    "follow_up": "FOLLOW-UP visit: lead with what changed since the last visit, the current cycle, lab trends, "
                 "toxicities and patient-reported symptoms or missed medicines.",
    "new": "NEW PATIENT visit: lead with the referral reason, presenting history, pathology and imaging so far, "
           "and list which expected documents are not yet in the folder.",
    "transfer": "HOSPITAL TRANSFER visit: lead with the full treatment history across hospitals, molecular profile, "
                "last response assessment and any recent new findings.",
}


def llm_narrative(patient: Patient, ctx: dict, retrieved: list[dict], series: dict, alerts: list[dict],
                  visit_type: str, missing: list[str]) -> dict | None:
    excerpts = "\n\n".join(f"[D{c['doc_id']}] {c['date'].date()} · {c['category']} / {c['subtype']} · {c['title']}\n{c['text']}"
                           for c in retrieved)
    facts = {
        "patient_id": patient.id, "age": patient.age, "sex": patient.sex,       # pseudonymised: no name/phone
        "diagnosis": patient.cancer_type, "stage": patient.stage, "regimen": patient.current_regimen,
        "last_visit": ctx["last_visit"].date().isoformat(),
        "latest_labs": {t: {k: s[-1][k] for k in ("date", "value", "unit", "flag", "doc")} for t, s in series.items()},
        "active_medicines": [f"{m.name} {m.dose} {m.frequency}" for m in ctx["meds"]],
        "rule_based_alerts": [a["text"] for a in alerts],
        "documents_not_in_folder": missing if visit_type == "new" else [],
    }
    user = (f"{VISIT_FOCUS[visit_type]}\n\nSTRUCTURED FACTS (from the database):\n{json.dumps(facts, default=str)}\n\n"
            f"RETRIEVED RECORD EXCERPTS:\n{excerpts}")
    out = llm.complete_json(SYSTEM_PROMPT, user)
    if not isinstance(out, dict):
        return None
    return out


def _validate(items, valid: set[str]) -> list[dict]:
    clean = []
    for it in items or []:
        if not isinstance(it, dict) or not it.get("text"):
            continue
        srcs = [s for s in (it.get("sources") or []) if s in valid]
        if not srcs:  # statement without a real source from THIS patient's folder is dropped
            continue
        clean.append({**it, "text": _clean(str(it["text"]), 400), "sources": srcs})
    return clean


# ----------------------------------------------------------------------------------------------
def generate_brief(db: Session, patient: Patient, visit_type: str) -> Brief:
    t0 = time.perf_counter()
    now = datetime.now()
    visit_type = visit_type if visit_type in VISIT_TYPES else "follow_up"
    ctx = gather(db, patient, visit_type, now)
    docs = ctx["docs"]
    retrieved = retrieve(docs, visit_type, now=now)
    series = lab_series(ctx["labs"])
    alerts = build_alerts(ctx, series, visit_type, now)
    missing = missing_documents(patient, docs) if visit_type == "new" else []
    if visit_type == "new":
        for m in missing:
            alerts.append({"level": "info", "kind": "missing", "text": f"Not yet in folder: {m}", "sources": []})

    model = "OncoBrief deterministic writer (no LLM key configured)"
    narrative = None
    if llm.enabled():
        raw = llm_narrative(patient, ctx, retrieved, series, alerts, visit_type, missing)
        if raw:
            valid = {tag(d.id) for d in docs}
            narrative = {"summary": _validate(raw.get("summary"), valid),
                         "key_findings": _validate(raw.get("key_findings"), valid)}
            if narrative["summary"]:
                model = f"{llm.config.LLM_PROVIDER}:{llm.model_name()} + rules"
            else:
                narrative = None
    if narrative is None:
        narrative = deterministic_narrative(patient, ctx, retrieved, series, visit_type, missing, now)
        if llm.enabled():
            model = "OncoBrief deterministic writer (LLM unavailable — fallback)"

    window = ctx["last_visit"]
    short = {"Haemoglobin": "Hb", "Platelets": "Plt", "Creatinine": "Creat", "Bilirubin": "Bili"}
    lab_line = defaultdict(list)
    for l in ctx["labs"]:
        lab_line[l.document_id].append(f"{short.get(l.test, l.test)} {l.value:g}{' ' + l.flag if l.flag else ''}")
    timeline = [{"date": d.record_date.isoformat(), "category": d.category, "subtype": d.subtype,
                 "title": d.title, "headline": " · ".join(lab_line[d.id]) if lab_line.get(d.id) else headline(d),
                 "ocr_confidence": d.ocr_confidence, "source": d.source,
                 "external_hospital": d.external_hospital, "doc": tag(d.id),
                 "new": d.record_date > window} for d in docs]
    reports = [{"id": f"S{r.id}", "date": r.reported_at.isoformat(), "symptoms": r.symptoms,
                "missed_meds": r.missed_meds, "free_text": r.free_text, "language": r.language,
                "flagged": r.flagged}
               for r in ctx["reports"] if r.reported_at > window - timedelta(days=0 if visit_type == "follow_up" else 30)]
    missed = [{"medication_id": l.medication_id, "date": l.scheduled_for.isoformat()}
              for l in ctx["logs"] if l.status == "missed" and l.scheduled_for > window]
    acts = ctx["acts"]
    activity = None
    if len(acts) >= 8:
        last7 = [a.steps for a in acts[-7:]]
        prev7 = [a.steps for a in acts[-14:-7]] or last7
        activity = {"avg_steps_last_7": round(sum(last7) / len(last7)),
                    "avg_steps_prev_7": round(sum(prev7) / len(prev7)),
                    "avg_sleep_last_7": round(sum(a.sleep_hours for a in acts[-7:]) / 7, 1)}

    cited = set()
    for block in (narrative["summary"], narrative["key_findings"], alerts):
        for it in block:
            cited.update(s for s in it.get("sources", []) if s.startswith("D"))
    by_tag = {tag(d.id): d for d in docs}
    sources = [{"tag": t, "id": by_tag[t].id, "title": by_tag[t].title, "category": by_tag[t].category,
                "subtype": by_tag[t].subtype, "date": by_tag[t].record_date.isoformat()}
               for t in sorted(cited, key=lambda x: int(x[1:])) if t in by_tag]

    open_items = [r["free_text"] for r in reports if r["free_text"] and "?" in r["free_text"]]
    latency = int((time.perf_counter() - t0) * 1000)
    content = {
        "visit_type": visit_type, "visit_label": VISIT_TYPES[visit_type],
        "generated_at": now.isoformat(), "since": window.isoformat(),
        "documents_in_folder": len(docs), "chunks_retrieved": len(retrieved),
        "documents_read": len({c["doc_id"] for c in retrieved}),
        "summary": narrative["summary"], "key_findings": narrative["key_findings"], "alerts": alerts,
        "timeline": timeline, "labs": series,
        "treatment": {"regimen": patient.current_regimen,
                      "notes": [{"date": d.record_date.isoformat(), "title": d.title, "doc": tag(d.id)}
                                for d in docs if d.category == "Treatment"],
                      "medicines": [{"name": m.name, "dose": m.dose, "frequency": m.frequency, "times": m.times}
                                    for m in ctx["meds"]]},
        "patient_reported": reports, "missed_doses": missed, "activity": activity,
        "missing_documents": missing, "open_items": open_items,
        "upcoming": [{"department": a.department, "start": a.start.isoformat(), "room": a.room}
                     for a in ctx["upcoming"][:4]],
        "disclaimer": "AI-assisted summary of existing records only. Not a diagnosis or treatment recommendation. "
                      "Verify against source documents.",
    }
    brief = Brief(patient_id=patient.id, visit_type=visit_type, model=model, latency_ms=latency,
                  content=content, sources=sources)
    db.add(brief)
    db.commit()
    db.refresh(brief)
    return brief
