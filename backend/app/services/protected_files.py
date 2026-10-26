from ..timeutil import utcnow
"""Encrypted storage, short-lived viewer-bound links and watermarked page delivery."""
import hashlib
import hmac
import io
import json
import os
import time
from datetime import datetime
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from fastapi import HTTPException
from sqlalchemy import select
from ..config import DATA_DIR
from ..round2_models import DocumentGeometry
from ..security import read_file


def _secret():
    value = os.getenv("FILE_SIGNING_KEY", "")
    if not value:
        value = (DATA_DIR / ".encryption-key").read_text() if (DATA_DIR / ".encryption-key").exists() else os.getenv("DATA_ENCRYPTION_KEY", "")
    return value.encode()


def file_token(doc_id, user_id):
    exp = int(time.time()) + 180
    message = f"{doc_id}:{user_id}:{exp}"
    return f"{exp}." + hmac.new(_secret(), message.encode(), hashlib.sha256).hexdigest()


def verify_token(token, doc_id, user_id):
    try:
        exp, sig = token.split(".")
        message = f"{doc_id}:{user_id}:{exp}"
        if int(exp) < time.time() or not hmac.compare_digest(sig, hmac.new(_secret(), message.encode(), hashlib.sha256).hexdigest()):
            raise ValueError()
    except (ValueError, AttributeError):
        raise HTTPException(403, "Document link expired. Reopen the document to refresh it.")


def stamp_image(img, name):
    img = img.convert("RGB")
    draw = ImageDraw.Draw(img)
    text = f"OncoBrief | {name} | {utcnow():%Y-%m-%d %H:%M} UTC"
    size = max(13, img.width // 75)
    try:
        font = ImageFont.truetype("arial.ttf" if os.name == "nt" else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", size)
    except OSError:
        font = ImageFont.load_default(size=size)
    draw.rectangle((0, img.height - size * 3, img.width, img.height), fill="#eee6fc")
    draw.text((8, img.height - size * 2), text, font=font, fill="#4b2e83")
    return img


def watermarked(data, mime, name):
    if mime.startswith("image/"):
        buf = io.BytesIO()
        stamp_image(Image.open(io.BytesIO(data)), name).save(buf, "PNG")
        return buf.getvalue(), "image/png"
    if mime == "application/pdf":
        from pypdf import PdfReader, PdfWriter
        from reportlab.pdfgen.canvas import Canvas
        reader, writer = PdfReader(io.BytesIO(data)), PdfWriter()
        for page in reader.pages:
            buf = io.BytesIO()
            c = Canvas(buf, pagesize=(float(page.mediabox.width), float(page.mediabox.height)))
            c.setFillColorRGB(.38, .22, .58)
            c.setFont("Helvetica", 8)
            c.drawString(15, 12, f"OncoBrief | {name.encode('ascii', 'replace').decode()} | {utcnow():%Y-%m-%d %H:%M} UTC")
            c.save()
            writer.add_page(page)
            page = writer.pages[-1]
            page.merge_page(PdfReader(io.BytesIO(buf.getvalue())).pages[0])
        buf = io.BytesIO()
        writer.write(buf)
        return buf.getvalue(), mime
    return data, mime


def geometry(path, mime):
    pages = []
    if mime == "application/pdf":
        import pdfplumber
        with pdfplumber.open(io.BytesIO(read_file(path))) as pdf:
            for i, p in enumerate(pdf.pages[:100]):
                words = p.extract_words()
                pages.append({"number": i, "width": p.width, "height": p.height,
                              "words": [{"text": w["text"], "x": w["x0"] / p.width, "y": w["top"] / p.height,
                                         "w": (w["x1"] - w["x0"]) / p.width, "h": (w["bottom"] - w["top"]) / p.height} for w in words]})
                if not words:
                    from .ocr import TESSERACT_OK
                    if TESSERACT_OK:
                        import pypdfium2 as pdfium
                        import pytesseract
                        with pdfium.PdfDocument(read_file(path)) as rendered:
                            img=rendered[i].render(scale=2).to_pil()
                            d=pytesseract.image_to_data(img,config="--psm 6",output_type=pytesseract.Output.DICT)
                            pages[-1]["words"]=[{"text":t,"x":d["left"][j]/img.width,"y":d["top"][j]/img.height,
                                                "w":d["width"][j]/img.width,"h":d["height"][j]/img.height}
                                               for j,t in enumerate(d["text"]) if t.strip()]
    elif mime.startswith("image/"):
        from .ocr import TESSERACT_OK
        if TESSERACT_OK:
            import pytesseract
            img = Image.open(io.BytesIO(read_file(path)))
            d = pytesseract.image_to_data(img, config="--psm 6", output_type=pytesseract.Output.DICT)
            pages.append({"number": 0, "width": img.width, "height": img.height, "words": [
                {"text": t, "x": d["left"][i] / img.width, "y": d["top"][i] / img.height,
                 "w": d["width"][i] / img.width, "h": d["height"][i] / img.height}
                for i, t in enumerate(d["text"]) if t.strip()]})
    return pages


def doc_geometry(db, doc, path):
    row = db.scalar(select(DocumentGeometry).where(DocumentGeometry.document_id == doc.id))
    if not row:
        try:
            pages = geometry(path, doc.mime)
        except Exception:
            pages = []
        row = DocumentGeometry(document_id=doc.id, pages=pages)
        db.add(row)
        db.commit()
    return row.pages


def render_page(data, mime, page, name):
    if mime == "application/pdf":
        import pypdfium2 as pdfium
        with pdfium.PdfDocument(data) as doc:
            if not 0 <= page < len(doc):
                raise HTTPException(404, "Page not found")
            img = doc[page].render(scale=1.6).to_pil()
    elif mime.startswith("image/") and page == 0:
        img = Image.open(io.BytesIO(data))
    else:
        raise HTTPException(404, "No image page available")
    buf = io.BytesIO()
    stamp_image(img, name).save(buf, "PNG")
    return buf.getvalue()
