"""OCR: digital PDFs are read from their text layer; scans and photos go through Tesseract.
Also a small rule-based lab-value parser (no AI) for CBC / LFT / KFT / marker reports."""
from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageOps

from ..taxonomy import LAB_ALIASES

try:
    import pytesseract
    TESSERACT_OK = True
    try:
        import os
        if os.getenv("TESSERACT_CMD"):
            pytesseract.pytesseract.tesseract_cmd = os.environ["TESSERACT_CMD"]
        pytesseract.get_tesseract_version()
    except Exception:  # binary missing
        TESSERACT_OK = False
except ImportError:  # pragma: no cover
    TESSERACT_OK = False


def _prep(img: Image.Image) -> Image.Image:
    img = ImageOps.exif_transpose(img).convert("L")
    if img.width < 1200:  # upscale small phone photos — helps Tesseract a lot
        scale = 1600 / img.width
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    return ImageOps.autocontrast(img)


def _run(img: Image.Image) -> tuple[str, float]:
    data = pytesseract.image_to_data(img, config="--psm 6", output_type=pytesseract.Output.DICT,timeout=30)
    words, confs, lines, key = [], [], {}, None
    for i, w in enumerate(data["text"]):
        if not w.strip():
            continue
        c = float(data["conf"][i])
        if c >= 0:
            confs.append(c)
        k = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(k, []).append(w)
    text = "\n".join(" ".join(ws) for ws in lines.values())
    return text, (sum(confs) / len(confs) if confs else 0.0)


def ocr_image(img: Image.Image) -> tuple[str, float | None]:
    """Two passes — greyscale and binarised — keep whichever Tesseract is more confident about."""
    if not TESSERACT_OK:
        return "", None
    g = _prep(img)
    best = _run(g)
    b = g.point(lambda v: 255 if v > 150 else 0)
    alt = _run(b)
    if alt[1] > best[1]:
        best = alt
    return best[0].strip(), round(best[1], 1)


def extract_text(path: Path, mime: str) -> tuple[str, str, float | None]:
    """Returns (text, method, confidence)."""
    path = Path(path)
    if mime == "application/pdf" or path.suffix.lower() == ".pdf":
        page_texts=[]
        try:
            import pdfplumber
            with pdfplumber.open(path) as pdf:
                page_texts=[p.extract_text() or "" for p in pdf.pages[:100]]
        except Exception:
            page_texts=[]
        if page_texts and all(len(t.strip())>40 for t in page_texts):
            return "\n".join(page_texts).strip(), "pdf-text", 99.0
        # Mixed PDFs are processed page-by-page so scanned pages are not silently skipped.
        try:
            import pypdfium2 as pdfium
            parts, confs,missing=[],[],False
            with pdfium.PdfDocument(str(path)) as doc:
                for i in range(min(len(doc),100)):
                    text=page_texts[i] if i<len(page_texts) else ""
                    if len(text.strip())>40:
                        parts.append(text);confs.append(99.0)
                    else:
                        t,c=ocr_image(doc[i].render(scale=2.5).to_pil())
                        parts.append(t or f"[Page {i+1}: text could not be read; verify the original]")
                        if c is not None:
                            confs.append(c)
                        else:
                            missing=True
            method="mixed-pdf" if any(t.strip() for t in page_texts) else "tesseract"
            return "\n".join(parts).strip(),method,None if missing else round(sum(confs)/len(confs),1) if confs else None
        except Exception:
            return "\n".join(page_texts).strip(), "partial-pdf", None
    if mime.startswith("image/") or path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
        try:
            t, c = ocr_image(Image.open(path))
            return t, "tesseract", c
        except Exception:
            return "", "none", None
    try:
        return path.read_text(errors="ignore")[:20000], "plain-text", 99.0
    except Exception:
        return "", "none", None


_NUM = r"(\d{1,4}(?:[.,]\d{1,2})?)"
PLAUSIBLE = {"Haemoglobin": (3, 25), "WBC": (0.1, 150), "ANC": (0, 60), "Platelets": (5, 2000),
             "Creatinine": (0.1, 20), "ALT": (1, 5000), "AST": (1, 5000), "Bilirubin": (0.05, 40),
             "Albumin": (0.5, 7), "CEA": (0, 10000), "CA 15-3": (0, 10000), "Sodium": (100, 180),
             "Potassium": (1.5, 9)}


def parse_lab_values(text: str) -> list[dict]:
    """Find 'Haemoglobin 9.4 g/dL' style lines. Rule-based: every hit is shown to staff to verify."""
    found: dict[str, float] = {}
    for line in text.splitlines():
        low = line.lower().strip()
        if not low:
            continue
        for test, aliases in LAB_ALIASES.items():
            if test in found:
                continue
            for alias in aliases:
                # alias must start the line (after optional bullet) to avoid matching inside sentences
                if re.match(rf"^[\s\-\*•]*{re.escape(alias)}\b", low):
                    rest = low.lstrip(" -*•")[len(alias):]
                    rest = re.sub(r"^\s*\([^)]*\)", "", rest)          # skip "(SGPT)" etc.
                    # value must be the FIRST token after the label — never fall through to the
                    # reference range. Unreadable value -> left blank for staff to type.
                    m = re.match(rf"^\s*[:\-]?\s*{_NUM}(?=\s|$)", rest)
                    if m:
                        val = float(m.group(1).replace(",", "."))
                        lo, hi = PLAUSIBLE.get(test, (0, 1e6))
                        if lo <= val <= hi:
                            found[test] = val
                    break
    return [{"test": k, "value": v} for k, v in found.items()]
