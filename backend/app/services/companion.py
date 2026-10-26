from ..timeutil import utcnow
"""Deterministic safety routing and cited record answers. Clinical outputs stay drafts."""
import re
from datetime import datetime, timedelta
from sqlalchemy import select
from ..models import Activity, Appointment, Document, LabValue, Medication, MedLog, Patient, SymptomReport
from ..round2_models import AccessGrant, Alert, Approval, CareRecord, LibraryItem, Notification, User
from .retrieval import question_documents

EMERGENCY = {
    "en": "Go to the nearest emergency department now. Contact your care team while arranging help.",
    "hi": "अभी नज़दीकी आपातकालीन विभाग जाएँ। मदद की व्यवस्था करते हुए अपनी देखभाल टीम से संपर्क करें।",
    "mr": "आत्ताच जवळच्या आपत्कालीन विभागात जा. मदत मिळवताना तुमच्या उपचार पथकाशी संपर्क साधा.",
}
ATTACK = re.compile(r"ignore (?:all |previous |your )?(?:instructions|rules)|system prompt|act as|developer message|disregard.*instruction", re.I)


def safe_text(text):
    return "\n".join(line for line in text.splitlines() if not ATTACK.search(line))


def red_flags(text="", symptoms=None, temperature=None, on_treatment=True):
    low = text.casefold()
    # Remove explicit negations, including Hindi/Marathi phrases, before keyword detection.
    for word in ("fever", "bleeding", "breathlessness", "chest pain", "shortness of breath"):
        low = re.sub(rf"\b(?:no|without|denies|not having|do not have|don't have|not experiencing)\s+{word}\b", "", low)
    low = re.sub(r"(?:बुखार|ताप)\s+(?:नहीं|नाही)(?:\s+है)?", "", low)
    crisis = any(x in low for x in ["kill myself", "end my life", "suicide", "hurt myself", "आत्महत्या", "खुद को मार"])
    urgent = any(x in low for x in ["can't breathe", "cannot breathe", "breathlessness", "shortness of breath", "chest pain", "heavy bleeding", "uncontrolled bleeding", "सांस नहीं", "सांस लेने में दिक्कत", "श्वास घेता", "श्वास घेण्यास त्रास", "खून बह", "बेहोश"])
    hypothetical = any(x in low for x in ["what is", "explain", "instructions", "if i get", "meaning of"])
    experienced = bool(re.search(r"\b(?:have|has|had) (?:a )?fever\b|fever (?:today|since|last)|bukhar hai|बुखार है|ताप आहे", low))
    fever = on_treatment and ((any(x in low for x in ["fever", "bukhar", "बुखार", "ताप", "बुख़ार"]) and (not hypothetical or experienced))
                             or (temperature is not None and temperature >= 38))
    sy = symptoms or []
    fever = fever or (on_treatment and any(s.get("key") == "fever" and s.get("grade", 0) > 0 for s in sy))
    severe = any(s.get("grade", 0) >= 3 for s in sy)
    return {"level": 3 if crisis or urgent or fever else (2 if severe else 0),
            "reason": "Immediate human support needed" if crisis else "Breathing, bleeding or chest symptoms" if urgent else "Fever during cancer treatment" if fever else "Severe symptom reported" if severe else "",
            "crisis": crisis}


def notify_team(db, pid, title, body):
    ids = set(db.scalars(select(AccessGrant.user_id).where(AccessGrant.patient_id == pid, AccessGrant.active.is_(True))))
    now = utcnow()
    for uid in ids:
        u = db.get(User, uid)
        g = db.scalar(select(AccessGrant).where(AccessGrant.user_id == uid, AccessGrant.patient_id == pid))
        if u and u.active and g and (not g.expires_at or g.expires_at > now) and ("all" in g.scopes or "alerts" in g.scopes):
            db.add(Notification(user_id=uid, patient_id=pid, title=title, body=body))
    db.commit()


def alert(db, pid, reason, source, severity="urgent"):
    # Repeated input within one minute updates the same alert rather than paging twice.
    old = db.scalar(select(Alert).where(Alert.patient_id == pid, Alert.reason == reason,
                                        Alert.status != "resolved", Alert.created_at > utcnow() - timedelta(minutes=1)))
    if old:
        return old
    row = Alert(patient_id=pid, severity=severity, reason=reason, source=source)
    db.add(row)
    db.commit()
    notify_team(db, pid, "Care alert: " + severity, reason)
    return row


def records(db, pid, kind=None):
    stmt = select(CareRecord).where(CareRecord.patient_id == pid)
    if kind:
        stmt = stmt.where(CareRecord.kind == kind)
    return db.scalars(stmt.order_by(CareRecord.created_at.desc(), CareRecord.id.desc())).all()


def living_summary(db, pid, include_notes=True, include_checkins=True, include_medicines=True):
    p = db.get(Patient, pid)
    docs = db.scalars(select(Document).where(Document.patient_id == pid).order_by(Document.record_date.desc())).all()
    labs = db.scalars(select(LabValue).where(LabValue.patient_id == pid).order_by(LabValue.measured_at.desc())).all()
    latest = {}
    for l in labs:
        latest.setdefault(l.test, {"test": l.test, "value": l.value, "unit": l.unit, "flag": l.flag,
                                   "date": l.measured_at.isoformat(), "source": f"D{l.document_id}" if l.document_id else "structured lab"})
    notes = [r for r in records(db, pid) if r.kind in {"takeaway", "scribe", "board_decision", "roadmap"} and r.status == "approved"]
    lines = [f"{p.cancer_type or 'Diagnosis not recorded'}; stage {p.stage or 'not recorded'}.",
             f"Recorded regimen: {p.current_regimen or 'none recorded'}."]
    sources = []
    for d in docs:
        snippet = safe_text(d.ocr_text)[:600]
        lines.append(f"[{d.record_date:%Y-%m-%d}] {d.title} [D{d.id}]: {snippet or 'OCR unavailable; open original.'}")
        sources.append({"tag": f"D{d.id}", "title": d.title, "id": d.id})
    if include_notes:
        for r in notes:
            lines.append(f"[R{r.id}, signed by {r.approved_by}] {r.data.get('text', '')}")
    if include_checkins:
        for r in records(db,pid,"checkin")[:7]:
            lines.append(f"[R{r.id}, {r.created_at.date()}, reported by {r.author_role}] "+", ".join(f"{k}: {r.data.get(k,0)}" for k in ("nausea","pain","fatigue","breathing","distress"))+". "+r.data.get("text",""))
    if include_medicines:
        for m in db.scalars(select(Medication).where(Medication.patient_id==pid,Medication.active.is_(True))):
            lines.append(f"[Active prescription M{m.id}] {m.name} {m.dose}; {m.frequency}; times {', '.join(m.times)}.")
    text = "\n".join(lines)
    row = db.scalar(select(CareRecord).where(CareRecord.patient_id == pid, CareRecord.kind == "living_summary"))
    if not row:
        row = CareRecord(patient_id=pid, kind="living_summary", author_id=0, author_name="Records engine", author_role="system")
        db.add(row)
    row.data = {"text": text, "sources": sources}
    row.updated_at = utcnow()
    db.commit()
    return {"text": text, "sources": sources, "latest_labs": list(latest.values()), "updated_at": row.updated_at}


def answer(db, pid, question, language="en", clinical_user=False, allow_notes=True):
    p = db.get(Patient, pid)
    flag = red_flags(question, on_treatment=bool(p.current_regimen))
    if flag["level"] == 3:
        a = alert(db, pid, flag["reason"], "companion", "emergency")
        text = EMERGENCY.get(language, EMERGENCY["en"])
        if flag["crisis"]:
            text = {"en": "Contact a trusted person or your hospital emergency team now. Stay with someone while help is arranged.",
                    "hi": "अभी किसी भरोसेमंद व्यक्ति या अस्पताल की आपातकालीन टीम से संपर्क करें। मदद आने तक किसी के साथ रहें।",
                    "mr": "आत्ताच विश्वासू व्यक्तीशी किंवा रुग्णालयाच्या आपत्कालीन पथकाशी संपर्क साधा. मदत येईपर्यंत कोणासोबत राहा."}.get(language, "Contact your hospital emergency team now.")
        return {"level": 3, "answer": text, "sources": [], "alert_id": a.id}
    low = question.lower()
    if ATTACK.search(question):
        return {"level": 0, "answer": "I can find and explain this patient's records. Instructions in documents or requests to bypass approval cannot change the care rules.", "sources": []}
    clinical = bool(re.search(r"\b(prescribe|dosage|change dose|increase.*dose|reduce.*dose|double.*dose|should i take|can i take|can i use|stop taking|start taking|medicine for|treatment change|prognosis|how long.*live)\b|दवा चाहिए|औषध|दवाई", low))
    if clinical and not clinical_user:
        req = Approval(patient_id=pid, kind="clinical_question", request=question, draft={"text": "Treating doctor review required."}, requested_by="Companion")
        db.add(req)
        db.commit()
        notify_team(db, pid, "Clinical question awaiting review", "A patient question needs the treating doctor.")
        return {"level": 2, "answer": {"en": "Your question has been sent to your treating doctor. Continue only your current signed plan until your doctor advises you.", "hi": "आपका प्रश्न डॉक्टर को भेज दिया गया है। डॉक्टर की सलाह तक अपनी हस्ताक्षरित योजना का पालन करें।", "mr": "तुमचा प्रश्न डॉक्टरांकडे पाठवला आहे. डॉक्टरांचा सल्ला येईपर्यंत सध्याच्या स्वाक्षरी केलेल्या योजनेचे पालन करा."}.get(language, "Sent to your treating doctor."), "sources": [], "request_id": req.id}
    if any(w in low for w in ["lonely", "scared", "worried", "sad", "anxious", "डर", "चिंता", "भीती"]):
        return {"level": 0, "answer": {"en": "That sounds difficult. What has felt hardest today? I can listen and help you ask your care team for support. I am a support companion, not a therapist.", "hi": "यह मुश्किल लग रहा है। आज सबसे कठिन क्या लगा? मैं आपकी बात सुन सकता हूँ और टीम से सहायता माँगने में मदद कर सकता हूँ। मैं चिकित्सक नहीं हूँ।", "mr": "हे कठीण वाटत आहे. आज सर्वात अवघड काय वाटले? मी ऐकू शकतो आणि पथकाची मदत मागण्यास सहाय्य करू शकतो. मी थेरपिस्ट नाही."}.get(language, "I can listen and help contact your care team."), "sources": [{"title": "NCI: Emotions and Cancer", "url": "https://www.cancer.gov/about-cancer/coping/feelings"}]}
    guide_key = "meals" if any(w in low for w in ["food", "meal", "diet", "खाना", "जेवण"]) else "activity" if any(w in low for w in ["walk", "exercise", "yoga", "व्यायाम", "चाल"]) else None
    if guide_key:
        g = db.scalar(select(LibraryItem).where(LibraryItem.key == guide_key, LibraryItem.approved_by.is_not(None)))
        if g:
            return {"level": 1, "answer": g.content.get(language, g.content.get("en", "Ask your care team for approved guidance.")),
                    "sources": [{"title": g.title, "url": g.source_url}], "library_approved_by": g.approved_by}
    translated_query=question
    for local,english in {"सीबीसी":"CBC","हीमोग्लोबिन":"haemoglobin","खून की रिपोर्ट":"CBC","रक्त तपासणी":"CBC","स्कैन":"scan","रिपोर्ट":"report","अहवाल":"report","मतली":"nausea","मळमळ":"nausea","थकान":"fatigue","थकवा":"fatigue"}.items():
        translated_query=translated_query.replace(local,english)
    docs = db.scalars(select(Document).where(Document.patient_id == pid)).all()
    hits = question_documents(docs, translated_query)
    note_hits=[]
    if allow_notes:
        terms=set(re.findall(r"\w{3,}",translated_query.lower()))-{"the","what","was","were","show","find","last"}
        for r in records(db,pid):
            if r.kind in {"takeaway","scribe","board_decision","roadmap","survivorship"} and r.status=="approved":
                text=" ".join(str(r.data.get(k,"")) for k in ("text","assessment","plan"))
            elif r.kind=="checkin":
                text=f"Reported {r.created_at.date()}: "+", ".join(f"{k} {r.data.get(k,0)}" for k in ("nausea","pain","fatigue","appetite","breathing","distress"))+". "+r.data.get("text","")
            else:
                continue
            score=sum(t in text.lower() for t in terms)
            if score:
                note_hits.append((score,r,text))
        note_hits.sort(key=lambda x:(x[0],x[1].id),reverse=True)
    if not hits and not note_hits:
        return {"level": 0, "answer": {"en": "I could not find that in your records. Please ask your care team or upload the relevant report.", "hi": "यह जानकारी आपके रिकॉर्ड में नहीं मिली। अपनी देखभाल टीम से पूछें या संबंधित रिपोर्ट जोड़ें।", "mr": "ही माहिती तुमच्या नोंदीत सापडली नाही. उपचार पथकाला विचारा किंवा संबंधित अहवाल जोडा."}.get(language, "Not found in your records."), "sources": []}
    lines, sources, context = [], [], []
    for _,r,text in note_hits[:2]:
        lines.append(f"{r.kind.replace('_',' ')} [R{r.id}] ({r.approved_by or r.author_name}):\n{safe_text(text)[:700]}")
        sources.append({"tag":f"R{r.id}","record_id":r.id,"title":r.kind.replace('_',' ')})
        context.append({"tag": f"R{r.id}", "title": r.kind.replace('_', ' '), "text": safe_text(text)[:1800]})
    for d, snippet in hits:
        clean = safe_text(snippet)[:1800]
        if not clinical_user:
            active = db.scalars(select(Medication).where(Medication.patient_id == pid, Medication.active.is_(True))).all()
            allowed = lambda line: any(m.name.lower() in line.lower() and m.dose.lower() in line.lower() for m in active)
            clean = "\n".join(line for line in clean.splitlines() if not re.search(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|mg/m2|units)\b", line, re.I) or allowed(line))
        if not clean.strip():
            continue
        lines.append(f"{d.title} ({d.record_date:%d %b %Y}) [D{d.id}]\n{clean}")
        sources.append({"tag": f"D{d.id}", "title": d.title, "id": d.id})
        context.append({"tag": f"D{d.id}", "title": d.title,
                        "text": f"Report date: {d.record_date:%Y-%m-%d}\n{clean}"})
    prefix = {"en": "These are excerpts from your reports, not a new clinical recommendation:", "hi": "ये आपकी रिपोर्ट के अंश हैं, नई चिकित्सीय सलाह नहीं। मूल रिपोर्ट का पाठ:", "mr": "हे तुमच्या अहवालातील उतारे आहेत, नवीन वैद्यकीय सल्ला नाही. मूळ अहवालाचा मजकूर:"}.get(language, "From your records:")
    if not lines:
        return {"level": 2, "answer": "This passage needs your doctor's explanation. Please open your original record and ask your treating team.", "sources": []}
    from .record_ai import explain_sources
    generated = explain_sources(p, context, question, language)
    if generated:
        cited = {tag for item in generated["items"] for tag in item["sources"]}
        return {"level": 0, "answer": "\n\n".join(item["text"] for item in generated["items"]),
                "sources": [s for s in sources if s["tag"] in cited],
                "citations": generated["items"], "language": language,
                "model": generated["model"], "generation": generated["generation"], "translation": None}
    return {"level": 0, "answer": prefix + "\n\n" + "\n\n".join(lines), "sources": sources,
            "model": "records", "generation": "extractive", "language": "en",
            "translation": "Original report language. Use configured translation for a translated transcript." if language != "en" else None}


def command_centre(db, ids):
    out = []
    now = utcnow()
    for pid in ids:
        p = db.get(Patient, pid)
        reasons, score = [], 0
        alerts = db.scalars(select(Alert).where(Alert.patient_id == pid, Alert.status != "resolved")).all()
        for a in alerts:
            score += 100 if a.severity == "emergency" else 30
            reasons.append(a.reason)
        missed = db.scalars(select(MedLog).where(MedLog.patient_id == pid, MedLog.status == "missed", MedLog.logged_at > now - timedelta(days=7))).all()
        if missed:
            score += 10 * len(missed)
            reasons.append(f"{len(missed)} missed doses this week")
        labs = db.scalars(select(LabValue).where(LabValue.patient_id == pid).order_by(LabValue.measured_at.desc())).all()
        latest_labs = {}
        for l in labs:
            latest_labs.setdefault(l.test, l)
        flagged_labs = [l for l in latest_labs.values() if l.flag and l.measured_at > now - timedelta(days=7)]
        if flagged_labs:
            score += min(30, len(flagged_labs) * 5)
            reasons.append("Recent flagged labs: " + ", ".join(l.test for l in flagged_labs))
        activities = db.scalars(select(Activity).where(Activity.patient_id == pid).order_by(Activity.date.desc()).limit(7)).all()
        if len(activities) >= 4 and activities[0].steps < sum(a.steps for a in activities[1:]) / len(activities[1:]) * .5:
            score += 15
            reasons.append("Steps below half of personal recent average")
        for row in records(db, pid, "checkin")[:1]:
            if row.data.get("distress", 0) >= 7:
                score += 20
                reasons.append("High distress reported")
        prefs = records(db, pid, "preferences")
        travel = prefs[0].data.get("travel_km", 0) if prefs else 0
        missed_visits = db.scalars(select(Appointment).where(Appointment.patient_id == pid, Appointment.status == "missed")).all()
        rescue = len(missed_visits) >= 2 or travel >= 150 or any(r.kind == "finance" and r.data.get("cost_worry") for r in records(db, pid))
        if missed_visits:
            score += 20 * len(missed_visits)
            reasons.append(f"{len(missed_visits)} missed visits")
        first_treatment = db.scalar(select(Document).where(Document.patient_id == pid, Document.category == "Treatment").order_by(Document.record_date).limit(1))
        categories = set(db.scalars(select(Document.category).where(Document.patient_id == pid)))
        blocker = "No first-treatment record; coordinator review required" if not first_treatment else "First treatment is recorded"
        if not first_treatment and "Pathology" not in categories:
            blocker = "Pathology record not in the folder"
        out.append({"patient_id": pid, "name": p.name, "score": score, "risk": "red" if score >= 60 else "amber" if score else "green", "reasons": reasons,
                    "rescue": rescue, "travel_km": travel, "open_alerts": len(alerts),
                    "first_treatment_date": first_treatment.record_date.date().isoformat() if first_treatment else None,
                    "diagnosis_to_treatment_days": max(0, (first_treatment.record_date - p.diagnosis_date).days) if first_treatment and p.diagnosis_date else None,
                    "blocker": blocker,
                    "diagnosis_days": (now - p.diagnosis_date).days if p.diagnosis_date else None})
    return sorted(out, key=lambda r: r["score"], reverse=True)
