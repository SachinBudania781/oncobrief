import json
import mimetypes
import math
import re
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import FileResponse, Response
from starlette.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import DATA_DIR, STORAGE_DIR
from ..db import get_db
from ..models import Document, LabValue, Patient
from ..round2_models import DocumentOwner
from ..services.ocr import extract_text, parse_lab_values
from ..services.retrieval import search_documents
from ..taxonomy import CATEGORIES, DEPARTMENTS, LAB_REFERENCE, SYMPTOMS, VISIT_TYPES, flag_for
from ..security import identity, require_patient, read_file, encrypt_file, roles
from ..services.protected_files import file_token, verify_token, watermarked, doc_geometry, render_page
from .common import Actor, audit, get_actor, load_patient

router = APIRouter(prefix="/api", tags=["documents"])

ALLOWED = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".txt"}
MAX_BYTES = 15 * 1024 * 1024


def doc_dict(d: Document, snippet: str | None = None, full: bool = False) -> dict:
    out = {
        "id": d.id, "tag": f"D{d.id}", "patient_id": d.patient_id, "category": d.category, "subtype": d.subtype,
        "department": d.department, "title": d.title, "record_date": d.record_date.isoformat(),
        "uploaded_at": d.uploaded_at.isoformat(), "uploaded_by": d.uploaded_by, "source": d.source,
        "external_hospital": d.external_hospital, "mime": d.mime, "ocr_method": d.ocr_method,
        "ocr_confidence": d.ocr_confidence, "file_url": f"/api/documents/{d.id}/file",
        "folder_path": d.file_path,
    }
    if snippet is not None:
        out["snippet"] = snippet
    if full:
        out["ocr_text"] = d.ocr_text
    return out


@router.get("/taxonomy")
def taxonomy():
    return {"categories": CATEGORIES, "departments": DEPARTMENTS, "symptoms": SYMPTOMS,
            "visit_types": VISIT_TYPES, "lab_tests": {k: v["unit"] for k, v in LAB_REFERENCE.items()}}


@router.get("/patients/{patient_id}/documents")
def list_documents(patient: Patient = Depends(load_patient), q: str = "", category: str = "", subtype: str = "",
                   date_from: str = "", date_to: str = "", db: Session = Depends(get_db),
                   actor: Actor = Depends(get_actor)):
    stmt = select(Document).where(Document.patient_id == patient.id).order_by(Document.record_date.desc())
    if category:
        stmt = stmt.where(Document.category == category)
    if subtype:
        stmt = stmt.where(Document.subtype == subtype)
    if date_from:
        stmt = stmt.where(Document.record_date >= datetime.fromisoformat(date_from))
    if date_to:
        stmt = stmt.where(Document.record_date <= datetime.fromisoformat(date_to + "T23:59:59"))
    if actor.role == "lab":
        stmt = stmt.where(Document.id.in_(select(DocumentOwner.document_id).where(DocumentOwner.user_id==actor.id)))
    docs = db.scalars(stmt).all()
    if q:
        audit(db, actor, "search_records", patient.id, q)
        return [doc_dict(d, s) for d, s in search_documents(docs, q)]
    return [doc_dict(d) for d in docs]


@router.get("/documents/recent")
def recent_documents(request: Request, department: str = "", limit: int = 15, db: Session = Depends(get_db)):
    from ..security import visible_ids
    user = identity(request)
    stmt = select(Document).where(Document.patient_id.in_(visible_ids(db, user, "documents"))).order_by(Document.uploaded_at.desc()).limit(min(max(limit, 1), 100))
    if user.role == "lab":
        stmt = stmt.where(Document.id.in_(select(DocumentOwner.document_id).where(DocumentOwner.user_id==user.id)))
    if department:
        stmt = stmt.where(Document.department == department)
    return [doc_dict(d) | {"patient_name": d.patient.name} for d in db.scalars(stmt).all()]


@router.get("/documents/{doc_id}")
def get_document(doc_id: int, request: Request, db: Session = Depends(get_db), actor: Actor = Depends(get_actor)):
    d = db.get(Document, doc_id)
    if not d:
        raise HTTPException(404, "Document not found")
    user = identity(request)
    require_patient(db, user, d.patient_id, "medicines" if d.source == "family_voice" else "documents")
    if user.role == "lab" and (not db.get(DocumentOwner,d.id) or db.get(DocumentOwner,d.id).user_id!=user.id):
        raise HTTPException(403, "Lab staff may open only their own uploads")
    audit(db, actor, "open_document", d.patient_id, f"D{d.id} {d.title}")
    labs = db.scalars(select(LabValue).where(LabValue.document_id == d.id)).all()
    return doc_dict(d, full=True) | {"file_url": f"/api/documents/{d.id}/file?token={file_token(d.id, user.id)}", "geometry": doc_geometry(db, d, STORAGE_DIR.parent / d.file_path), "viewer": user.name, "lab_values": [{"test": l.test, "value": l.value, "unit": l.unit,
                                                      "flag": l.flag, "ref_low": l.ref_low, "ref_high": l.ref_high}
                                                     for l in labs]}


@router.get("/documents/{doc_id}/file")
def document_file(doc_id: int, request: Request, token: str = "", download: bool = False, db: Session = Depends(get_db)):
    d = db.get(Document, doc_id)
    user = identity(request)
    if not d:
        raise HTTPException(404, "File not found")
    require_patient(db, user, d.patient_id, "medicines" if d.source == "family_voice" else "documents")
    if user.role == "lab" and (not db.get(DocumentOwner,d.id) or db.get(DocumentOwner,d.id).user_id!=user.id):
        raise HTTPException(403, "Lab staff may open only their own uploads")
    verify_token(token, d.id, user.id)
    if download:
        roles(user, "patient", "doctor", "admin")
    path = (STORAGE_DIR.parent / d.file_path).resolve()
    if not path.is_relative_to(STORAGE_DIR.resolve()) or not path.exists():
        raise HTTPException(404, "File not found")
    data, mime = watermarked(read_file(path), d.mime, user.name)
    return Response(data, media_type=mime, headers={"Content-Disposition": f'{"attachment" if download else "inline"}; filename="document-{d.id}{".pdf" if d.mime == "application/pdf" else ".png" if d.mime.startswith("image/") else ".txt"}"'})


@router.get("/documents/{doc_id}/page/{page}")
def document_page(doc_id: int, page: int, request: Request, token: str = "", db: Session = Depends(get_db)):
    d = db.get(Document, doc_id)
    user = identity(request)
    if not d:
        raise HTTPException(404, "Document not found")
    require_patient(db, user, d.patient_id, "medicines" if d.source == "family_voice" else "documents")
    if user.role == "lab" and (not db.get(DocumentOwner,d.id) or db.get(DocumentOwner,d.id).user_id!=user.id):
        raise HTTPException(403, "Only your own uploads are accessible")
    verify_token(token, d.id, user.id)
    path = (STORAGE_DIR.parent / d.file_path).resolve()
    if not path.is_relative_to(STORAGE_DIR.resolve()):
        raise HTTPException(404)
    return Response(render_page(read_file(path), d.mime, page, user.name), media_type="image/png")


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def store_document(db: Session, patient: Patient, *, category: str, subtype: str, record_date: datetime,
                   title: str, department: str, uploaded_by: str, source: str, src_path: Path, mime: str,
                   external_hospital: str | None = None, lab_values: list[dict] | None = None,
                   ocr_text: str | None = None, ocr_method: str | None = None, ocr_conf: float | None = None,
                   auto_parse_labs: bool = True, uploaded_at: datetime | None = None, commit: bool = True) -> tuple[Document, list[LabValue]]:
    """Files a document: validates tags, copies into storage/<patient>/<category>/, OCRs, flags lab values."""
    if category not in CATEGORIES:
        raise HTTPException(422, f"Unknown category {category}")
    if subtype not in CATEGORIES[category]["subtypes"]:
        raise HTTPException(422, f"Unknown subtype {subtype} for {category}")
    folder = STORAGE_DIR / patient.id / _slug(category)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{record_date:%Y-%m-%d_%H%M}_{_slug(subtype)}{src_path.suffix.lower()}"
    dest = folder / name
    i = 1
    while dest.exists():
        dest = folder / f"{dest.stem}-{i}{dest.suffix}"
        i += 1
    shutil.copyfile(src_path, dest)
    if ocr_text is None:
        ocr_text, ocr_method, ocr_conf = extract_text(dest, mime)
    d = Document(patient_id=patient.id, category=category, subtype=subtype, department=department, title=title,
                 record_date=record_date, uploaded_by=uploaded_by, source=source,
                 external_hospital=external_hospital, file_path=dest.relative_to(STORAGE_DIR.parent).as_posix(),
                 mime=mime, ocr_text=ocr_text or "", ocr_method=ocr_method or "none", ocr_confidence=ocr_conf,
                 uploaded_at=uploaded_at or datetime.now())
    encrypt_file(dest)
    db.add(d)
    db.flush()
    values = lab_values or []
    auto = False
    if not values and category == "Lab report" and auto_parse_labs:
        values = parse_lab_values(ocr_text or "")
        auto = bool(values)
    rows = []
    for v in values:
        test = v["test"]
        if test not in LAB_REFERENCE:
            continue
        val = float(v["value"])
        lo, hi, flag = flag_for(test, val, patient.sex)
        rows.append(LabValue(patient_id=patient.id, document_id=d.id, test=test, value=val,
                             unit=LAB_REFERENCE[test]["unit"], ref_low=lo, ref_high=hi, flag=flag,
                             measured_at=record_date))
    db.add_all(rows)
    if commit:
        db.commit()
        db.refresh(d)
    else:
        db.flush()
    d._auto_parsed = auto  # type: ignore[attr-defined]
    return d, rows


@router.post("/documents")
async def upload_document(
    request: Request, patient_id: str = Form(...), category: str = Form(...), subtype: str = Form(...),
    record_date: str = Form(...), title: str = Form(""), department: str = Form(""),
    source: str = Form("staff"), lab_values: str = Form(""), file: UploadFile = File(...),
    identity_confirmed: bool = Form(False), identity_reason: str = Form(""),
    db: Session = Depends(get_db), actor: Actor = Depends(get_actor),
):
    patient = db.get(Patient, patient_id.strip().upper())
    if not patient:
        raise HTTPException(404, f"No patient with ID {patient_id}")
    user = identity(request)
    require_patient(db, user, patient.id, "documents")
    roles(user, "patient", "caregiver", "doctor", "nurse", "lab", "admin")
    if category not in CATEGORIES or subtype not in CATEGORIES[category]["subtypes"]:
        raise HTTPException(422, "Choose a valid document category and subtype")
    if user.role == "lab" and category != "Lab report":
        raise HTTPException(403, "Lab staff may upload lab reports only")
    suffix = Path(file.filename or "upload").suffix.lower() or ".jpg"
    if suffix not in ALLOWED:
        raise HTTPException(422, f"File type {suffix} not allowed. Use PDF, JPG or PNG.")
    tmp = STORAGE_DIR.parent / "tmp"
    tmp.mkdir(exist_ok=True)
    tmp_path = tmp / f"upload_{datetime.now():%H%M%S%f}{suffix}"
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File too large (max 15 MB)")
    try:
        from ..services.uploads import validate_file, check_identity
        mime = validate_file(data, suffix)
        tmp_path.write_bytes(data)
        try:
            when = datetime.fromisoformat(record_date).replace(tzinfo=None)
            values = json.loads(lab_values) if lab_values else None
        except (ValueError, TypeError):
            raise HTTPException(422, "Invalid report date or lab values JSON")
        if values is not None and (not isinstance(values, list) or any(not isinstance(v, dict) or v.get("test") not in LAB_REFERENCE or not isinstance(v.get("value"), (float, int)) or not math.isfinite(v["value"]) for v in values)):
            raise HTTPException(422, "Invalid lab values")
        text, method, confidence = await run_in_threadpool(extract_text,tmp_path,mime)
        identity_status = check_identity(text, patient, identity_confirmed, identity_reason)
        d, rows = store_document(
            db, patient, category=category, subtype=subtype, record_date=when,
            title=title[:200] or f"{subtype} — {when:%d %b %Y}", department=user.department if user.role == "lab" else department or CATEGORIES[category]["department"],
            uploaded_by=f"{actor.name} ({actor.role})", source=user.role, src_path=tmp_path, mime=mime, lab_values=values,
            ocr_text=text, ocr_method=method, ocr_conf=confidence,
        )
        db.add(DocumentOwner(document_id=d.id,user_id=user.id))
        db.commit()
        audit(db, actor, "upload_document", patient.id, f"D{d.id} {category}/{subtype}; {identity_status}")
        return doc_dict(d, full=True) | {
            "file_url": f"/api/documents/{d.id}/file?token={file_token(d.id, user.id)}",
            "lab_values": [{"test": r.test, "value": r.value, "unit": r.unit, "flag": r.flag} for r in rows],
            "lab_values_auto_parsed": getattr(d, "_auto_parsed", False), "identity_check": identity_status,
        }
    finally:
        tmp_path.unlink(missing_ok=True)



@router.get("/scanner/scan")
def simulated_scanner(n: int = 0):
    """Simulated Bluetooth document scanner: returns a scanned page image (a real scanner agent would
    push pages to this same upload pipeline)."""
    scans = sorted((DATA_DIR / "scanner_samples").glob("*.jpg"))
    if not scans:
        raise HTTPException(404, "No scanner samples")
    f = scans[n % len(scans)]
    return FileResponse(f, media_type="image/jpeg", headers={"X-Scan-Name": f.name})
