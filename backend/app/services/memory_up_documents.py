"""Connect reviewed Memory Up notes to normal documents without editing core routes."""
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock

from ..models import Patient
from ..round2_models import DocumentOwner
from ..security import encrypt_file, read_file
from ..timeutil import utcnow
from .ocr import extract_text

_filing_lock = RLock()


def file_reviewed_advice(db, note, doctor, visit, memory_dir):
    from ..routers.documents import store_document

    Path(memory_dir).mkdir(parents=True, exist_ok=True)
    patient = db.get(Patient, note.patient_id)
    written = note.advice
    if note.attachment and not written:
        attachment = Path(memory_dir) / note.attachment
        # Extract from a short-lived decrypted copy; never pass encrypted bytes
        # into OCR. The original attachment remains protected in Memory Up.
        with NamedTemporaryFile(dir=memory_dir, suffix=attachment.suffix, delete=False) as temporary:
            source = Path(temporary.name)
            temporary.write(read_file(attachment))
        try:
            written, _, _ = extract_text(source, note.attachment_mime)
        finally:
            source.unlink(missing_ok=True)
    text = (f"Memory Up #{note.id}\nPatient ID: {patient.id}\nPatient name: {patient.name}\n"
            f"Department: {note.department}\nAppointment: {visit.start.isoformat()}\n"
            f"Reviewed by: {doctor.name}\n\nDoctor's appointment advice:\n"
            f"{written or 'See the original attachment in Memory Up.'}\n")
    if note.attachment_name:
        text += f"\nOriginal attachment in Memory Up: {note.attachment_name}\n"
    with NamedTemporaryFile(dir=memory_dir, suffix=".txt", delete=False) as temporary:
        source = Path(temporary.name)
        temporary.write(text.encode("utf-8"))
    try:
        # The existing filing service copies before encrypting. Supply an already
        # encrypted source so its destination is never left plaintext on failure.
        encrypt_file(source)
        # The existing naming service chooses a free suffix by checking files.
        # Serialize that operation in the supported single-worker runtime so two
        # notes for the same appointment cannot overwrite each other's summary.
        with _filing_lock:
            document, _ = store_document(
                db, patient, category="Clinical note", subtype="Consultation transcript",
                record_date=visit.start, title=f"Memory Up · {note.title}"[:200],
                department=note.department, uploaded_by=doctor.name, source="doctor",
                src_path=source, mime="text/plain", ocr_text=text,
                ocr_method="clinician-reviewed", ocr_conf=None, auto_parse_labs=False,
                uploaded_at=utcnow(), commit=False,
            )
        db.add(DocumentOwner(document_id=document.id, user_id=doctor.id))
        return document
    finally:
        source.unlink(missing_ok=True)


def remove_filed_copy(relative_path):
    from ..routers.documents import STORAGE_DIR

    path = (STORAGE_DIR.parent / relative_path).resolve()
    if path.is_relative_to(STORAGE_DIR.resolve()):
        path.unlink(missing_ok=True)
