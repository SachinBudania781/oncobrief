import io
import re
import unicodedata
from fastapi import HTTPException
from PIL import Image


def validate_file(data, suffix):
    if not data:
        raise HTTPException(422, "File is empty")
    if suffix == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise HTTPException(422, "File content is not a PDF")
        import pypdfium2 as pdfium
        try:
            with pdfium.PdfDocument(data) as doc:
                if len(doc) > 100:
                    raise HTTPException(422, "Maximum 100 pages per bundle")
                for page in doc:
                    width,height=page.get_size()
                    if width<=0 or height<=0 or width*height>4_000_000:
                        raise HTTPException(422,"PDF page dimensions exceed the safe rendering limit")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "Unreadable or password-protected PDF")
        return "application/pdf"
    if suffix in {".png", ".jpg", ".jpeg", ".webp"}:
        try:
            with Image.open(io.BytesIO(data)) as img:
                if img.width * img.height > 40_000_000:
                    raise HTTPException(422, "Image is too large (maximum 40 megapixels)")
                img.verify()
                return Image.MIME[img.format]
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "Invalid image file")
    if suffix == ".txt":
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(422, "Text files must use UTF-8")
        if b"\x00" in data:
            raise HTTPException(422, "Binary files are not accepted as text")
        return "text/plain"
    raise HTTPException(422, "Unsupported file type")


def check_identity(text, patient, confirmed=False, reason=""):
    ids = {s.upper() for s in re.findall(r"\bOB-\d{4}-\d{4}\b", text, re.I)}
    if ids and ids != {patient.id}:
        raise HTTPException(409, f"Wrong-patient guard: report IDs {', '.join(sorted(ids))} do not match selected patient {patient.id}")
    name = re.search(r"(?:patient\s+name|name)\s*[:\-]\s*([^\n]+?)(?:\s{2,}|\s+Age|$)", text, re.I)
    normal = lambda s: "".join(c for c in unicodedata.normalize("NFKC",s).casefold() if unicodedata.category(c)[0] in {"L","M","N"})
    if name and normal(name.group(1)) and normal(name.group(1)) != normal(patient.name):
        raise HTTPException(409, f"Wrong-patient guard: report name '{name.group(1).strip()}' does not match selected patient '{patient.name}'")
    if patient.id in ids or (name and normal(name.group(1)) == normal(patient.name)):
        return "matched printed identity"
    if not confirmed or len(reason.strip()) < 10:
        raise HTTPException(422, "Printed identity could not be verified. Check the original, tick identity confirmation and record how you verified it (at least 10 characters).")
    return "manual identity verification: " + reason[:200]
