import io
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from ..config import DATA_DIR, STORAGE_DIR
from ..db import get_db
from ..models import Document, Medication, Patient
from ..round2_models import BulkImport, CareRecord, DocumentOwner
from ..security import append_audit, encrypt_file, identity, read_file, require_patient, roles
from ..services.ocr import extract_text
from ..services.uploads import check_identity, validate_file
from ..taxonomy import CATEGORIES
from ..timeutil import hospital_now
from .documents import store_document
from .round2 import patient_access, serial

router = APIRouter(prefix="/api/v2", tags=["document intelligence"])


@router.post("/patients/{patient_id}/voice-reminder")
async def voice_reminder(patient_id: str, request: Request, file: UploadFile = File(...), db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "medicines")
    roles(user, "patient", "caregiver", "nurse", "doctor")
    data = await file.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024 or not data:
        raise HTTPException(422, "Voice messages must be between 1 byte and 5 MB")
    if data.startswith(b"\x1aE\xdf\xa3"):
        suffix, mime = ".webm", "audio/webm"
    elif data.startswith(b"OggS"):
        suffix, mime = ".ogg", "audio/ogg"
    elif data.startswith(b"RIFF") and data[8:12] == b"WAVE":
        suffix, mime = ".wav", "audio/wav"
    else:
        raise HTTPException(422, "Unsupported voice recording format; use WebM, Ogg or WAV")
    from ..models import Patient
    with tempfile.TemporaryDirectory(dir=DATA_DIR) as tmp:
        path = Path(tmp) / ("family-voice" + suffix)
        path.write_bytes(data)
        doc, _ = store_document(db, db.get(Patient, patient_id), category="Patient-reported", subtype="Other", record_date=hospital_now(),
                                title="Family voice reminder", department="Patient", uploaded_by=f"{user.name} ({user.role})", source="family_voice",
                                src_path=path, mime=mime, ocr_text="Patient-consented family voice reminder", ocr_method="audio")
    append_audit(db, user, "record_family_voice", patient_id, f"D{doc.id}")
    return {"document_id": doc.id}


@router.post("/patients/{patient_id}/medicine-scan")
async def medicine_scan(patient_id: str, request: Request, file: UploadFile = File(...),
                        medication_id: int | None = Form(None), db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "medicines")
    data = await file.read(15 * 1024 * 1024 + 1)
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Image too large")
    suffix = Path(file.filename or "image.jpg").suffix.lower()
    mime = validate_file(data, suffix)
    if not mime.startswith("image/"):
        raise HTTPException(422, "Photograph the strip or bottle")
    with tempfile.TemporaryDirectory(dir=DATA_DIR) as tmp:
        path = Path(tmp) / ("strip" + suffix)
        path.write_bytes(data)
        text, method, conf = await run_in_threadpool(extract_text,path,mime)
    meds = db.scalars(select(Medication).where(Medication.patient_id == patient_id, Medication.active.is_(True))).all()
    if medication_id is not None:
        meds = [m for m in meds if m.id == medication_id]
        if not meds:
            raise HTTPException(422, "Select an active prescription belonging to this patient")
    normal = lambda s: re.sub(r"\W+", "", s.lower())
    matched = [m for m in meds if normal(m.name) in normal(text)]
    warnings = []
    if not text or conf is None or conf < 75:
        warnings.append("OCR could not verify this strip reliably. Ask the pharmacist before taking it.")
    if not matched:
        warnings.append("No exact active generic-name match. Brand equivalents must be confirmed by the pharmacist.")
    if re.search(r"aspirin|ibuprofen|diclofenac|naproxen|ayur|herbal|warfarin", text, re.I):
        from .round2 import ReviewIn, prescription_checks
        checks = prescription_checks(db, patient_id, ReviewIn(action="approve", medicine=text[:150]))
        warnings.extend(issue for issue in checks["issues"] if "platelet" in issue.lower() or "allergy" in issue.lower() or "high-risk" in issue.lower())
        if any(re.search(r"warfarin|apixaban|rivaroxaban", m.name, re.I) for m in meds) and re.search(r"aspirin|ibuprofen|diclofenac|naproxen", text, re.I):
            warnings.append("Potential bleeding-risk combination with a recorded anticoagulant; pharmacist confirmation required")
    verified = False
    exp = re.search(r"(?:exp(?:iry)?|use before)\s*[:.\-]?\s*(\d{1,2})\s*[/\-]\s*(\d{2,4})", text, re.I)
    expiry = None
    if exp:
        year = int(exp[2]) + (2000 if len(exp[2]) == 2 else 0)
        month = int(exp[1])
        if not 1 <= month <= 12:
            warnings.append("Expiry month could not be read reliably")
        else:
            expiry = f"{year}-{month:02d}"
            current_month = hospital_now().date().replace(day=1)
            if (year, month) < (current_month.year, current_month.month):
                warnings.append("Printed expiry is in the past. Do not use this strip; contact the pharmacist.")
    else:
        warnings.append("Expiry not verified; check it with the pharmacist")
    for m in matched:
        dose_match = re.search(r"\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)\b", m.dose, re.I)
        if dose_match and normal(dose_match.group(0)) not in normal(text):
            warnings.append("Printed strength does not match the active prescription or could not be read")
    verified = bool(matched and not warnings)
    row = CareRecord(patient_id=patient_id, kind="medicine_scan", author_id=user.id, author_name=user.name,
                     author_role=user.role, data={"ocr_text": text, "confidence": conf, "expiry": expiry,
                                                 "matches": [m.id for m in matched], "warnings": warnings,
                                                 "verified": verified}, status="verified" if verified else "pharmacist_review")
    db.add(row)
    db.commit()
    append_audit(db, user, "medicine_strip_check", patient_id)
    return serial(row) | {"message": "Compare against the signed prescription. Record a dose only after you actually take it.", "auto_taken": False}


@router.get("/documents/{document_id}/explain")
@router.post("/documents/{document_id}/explain")
def explain(document_id: int, request: Request, language: Literal["en", "hi", "mr"] = "en", db=Depends(get_db)):
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    user = patient_access(db, request, doc.patient_id, "documents")
    if user.role == "lab" and (not db.get(DocumentOwner,doc.id) or db.get(DocumentOwner,doc.id).user_id!=user.id):
        raise HTTPException(403, "Only your uploads are accessible")
    from ..services.companion import safe_text
    from ..models import LabValue
    labs = db.scalars(select(LabValue).where(LabValue.document_id == doc.id)).all()
    terms = {"Haemoglobin": "Haemoglobin carries oxygen in the blood.", "ANC": "ANC counts infection-fighting neutrophils.", "Platelets": "Platelets help blood clot.", "Creatinine": "Creatinine is one marker used when checking kidney function."}
    explanation = [{"text": f"{l.test}: {l.value} {l.unit}. {terms.get(l.test, 'Ask your team how this result fits your plan.')} " + ("The value is outside this report's reference range; your doctor interprets it in context." if l.flag else "The value is within this report's recorded reference range."), "source": f"D{doc.id}"} for l in labs]
    result = {"document_id": doc.id, "title": doc.title, "language": "en", "requested_language": language,
            "explanation": explanation, "original_excerpt": safe_text(doc.ocr_text)[:4000],
            "questions": ["What does this result mean for my current plan?", "Do I need a repeat test?", "Which symptoms should I report?"],
            "translation_required": language != "en", "source": f"D{doc.id}",
            "model": "records", "generation": "extractive",
            "notice": "Read alongside the original report. Your treating team interprets findings in context."}
    # Generating an explanation is an explicit action. Legacy GET remains a local preview.
    if request.method == "POST":
        from ..services.record_ai import explain_sources
        evidence = safe_text(doc.ocr_text or "")[:10000]
        if labs:
            evidence += "\nRecorded lab values:\n" + json.dumps([
                {"test": l.test, "value": l.value, "unit": l.unit, "flag": l.flag,
                 "ref_low": l.ref_low, "ref_high": l.ref_high} for l in labs], ensure_ascii=False)
        if evidence.strip():
            generated = explain_sources(db.get(Patient, doc.patient_id),
                [{"tag": f"D{doc.id}", "title": doc.title,
                  "text": f"Report date: {doc.record_date:%Y-%m-%d}\n{evidence}"}],
                "Explain this report's recorded findings in plain language. State what is missing or unclear. "
                "Do not infer conclusions from unreadable text or propose a treatment plan.", language)
            if generated:
                result.update({"explanation": [{**item, "source": f"D{doc.id}"} for item in generated["items"]],
                               "language": language, "translation_required": False,
                               "model": generated["model"], "generation": generated["generation"]})
                result["questions"] = {
                    "en": result["questions"],
                    "hi": ["मेरी उपचार योजना में इस नतीजे का क्या अर्थ है?", "क्या जाँच दोबारा करानी है?", "कौन से लक्षण अपनी टीम को बताऊँ?"],
                    "mr": ["माझ्या उपचार योजनेसाठी या निकालाचा अर्थ काय आहे?", "ही तपासणी पुन्हा करावी लागेल का?", "कोणती लक्षणे उपचार पथकाला सांगावीत?"],
                }[language]
    return result


@router.post("/patients/{patient_id}/bulk-import")
async def bulk_import(patient_id: str, request: Request, file: UploadFile = File(...), db=Depends(get_db)):
    user = patient_access(db, request, patient_id, "documents")
    roles(user, "nurse", "doctor", "lab", "admin")
    data = await file.read(20 * 1024 * 1024 + 1)
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "Maximum bundle size 20 MB")
    validate_file(data, ".pdf")
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(io.BytesIO(data))
    pages = []
    with tempfile.TemporaryDirectory(dir=DATA_DIR) as tmp:
        for i, page in enumerate(reader.pages):
            writer = PdfWriter()
            writer.add_page(page)
            path = Path(tmp) / f"page-{i}.pdf"
            with path.open("wb") as stream:
                writer.write(stream)
            text, method, conf = await run_in_threadpool(extract_text,path,"application/pdf")
            category = "Lab report" if re.search(r"haemoglobin|platelets|cbc", text, re.I) else "Imaging" if re.search(r"impression|CT scan|MRI", text, re.I) else "Clinical note"
            subtype = "CBC" if category == "Lab report" else "CT" if category == "Imaging" else "Consultation transcript"
            when = re.search(r"\b(\d{2})/(\d{2})/(\d{4})\b", text)
            date = f"{when[3]}-{when[2]}-{when[1]}" if when else ""
            pages.append({"page": i, "category": category, "subtype": subtype, "date": date, "title": f"Imported page {i + 1}", "text": text, "confidence": conf, "method": method, "group": i + 1, "confirmed": False})
    folder = DATA_DIR / "imports"
    folder.mkdir(exist_ok=True)
    import secrets
    path = folder / (secrets.token_hex(16) + ".pdf")
    path.write_bytes(data)
    encrypt_file(path)
    row = BulkImport(patient_id=patient_id, author_id=user.id, file_path=str(path.relative_to(DATA_DIR)), pages=pages)
    db.add(row)
    db.commit()
    return serial(row, ("file_path",))


class BulkPage(BaseModel):
    page: int = Field(ge=0, le=99)
    group: int = Field(ge=1, le=100)
    category: str
    subtype: str
    date: str
    title: str = Field(min_length=1, max_length=200)
    confirmed: bool
    identity_confirmed: bool = False
    identity_reason: str = Field(default="", max_length=500)


class BulkConfirm(BaseModel):
    pages: list[BulkPage] = Field(min_length=1, max_length=100)


@router.post("/bulk-import/{import_id}/confirm")
def confirm_bulk(import_id: int, body: BulkConfirm, request: Request, db=Depends(get_db)):
    row = db.get(BulkImport, import_id)
    if not row:
        raise HTTPException(404, "Import not found")
    user = patient_access(db, request, row.patient_id, "documents")
    if row.author_id != user.id or row.status != "review":
        raise HTTPException(409, "Only the uploading staff member can confirm a pending import")
    from ..models import Patient
    p = db.get(Patient, row.patient_id)
    if sorted(x.page for x in body.pages) != list(range(len(row.pages))):
        raise HTTPException(422, "Confirm every page exactly once")
    groups = {}
    for page in body.pages:
        if not page.confirmed or page.category not in CATEGORIES or page.subtype not in CATEGORIES[page.category]["subtypes"]:
            raise HTTPException(422, "Every page needs confirmed valid filing tags")
        if user.role == "lab" and page.category != "Lab report":
            raise HTTPException(403, "Lab staff may file lab reports only")
        try:
            datetime.fromisoformat(page.date)
        except ValueError:
            raise HTTPException(422, "Every page needs a valid date")
        check_identity(row.pages[page.page]["text"], p, page.identity_confirmed, page.identity_reason)
        group = groups.setdefault(page.group, [])
        if group and any(getattr(page, k) != getattr(group[0], k) for k in ("date", "category", "subtype", "title")):
            raise HTTPException(422, "Pages in a document group must use identical filing tags")
        group.append(page)
    from pypdf import PdfReader, PdfWriter
    reader = PdfReader(io.BytesIO(read_file(DATA_DIR / row.file_path)))
    saved = []
    with tempfile.TemporaryDirectory(dir=DATA_DIR) as tmp:
        for group, pages in groups.items():
            writer = PdfWriter()
            for page in sorted(pages, key=lambda p: p.page):
                writer.add_page(reader.pages[page.page])
            path = Path(tmp) / f"group-{group}.pdf"
            with path.open("wb") as stream:
                writer.write(stream)
            first = pages[0]
            doc, _ = store_document(db, p, category=first.category, subtype=first.subtype, record_date=datetime.fromisoformat(first.date), title=first.title,
                                    department=CATEGORIES[first.category]["department"], uploaded_by=f"{user.name} ({user.role})", source="bulk_import", src_path=path, mime="application/pdf",
                                    ocr_text="\n".join(row.pages[x.page]["text"] for x in pages), ocr_method="bulk-reviewed", commit=False)
            saved.append(doc.id)
            db.add(DocumentOwner(document_id=doc.id,user_id=user.id))
    row.status = "filed"
    db.commit()
    (DATA_DIR / row.file_path).unlink(missing_ok=True)
    append_audit(db, user, "confirm_bulk_filing", p.id, ",".join(map(str, saved)))
    return {"documents": saved, "status": "filed"}
