"""Renders fabricated reports as realistic files: digital PDFs (text layer) and 'scanned' / phone-photo
JPEGs (no text layer — OCR has to read them)."""
from __future__ import annotations

import random
import re
import textwrap
import zlib
from datetime import datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .data import HOME

LAB_LABELS = {
    "Haemoglobin": ("Haemoglobin", "g/dL"), "WBC": ("Total WBC", "x10^3/uL"),
    "ANC": ("Absolute Neutrophil Count", "x10^3/uL"), "Platelets": ("Platelet Count", "x10^3/uL"),
    "Creatinine": ("Serum Creatinine", "mg/dL"), "ALT": ("ALT (SGPT)", "U/L"), "AST": ("AST (SGOT)", "U/L"),
    "Bilirubin": ("Total Bilirubin", "mg/dL"), "Albumin": ("Albumin", "g/dL"), "CEA": ("CEA", "ng/mL"),
    "CA 15-3": ("CA 15-3", "U/mL"), "Sodium": ("Sodium", "mmol/L"), "Potassium": ("Potassium", "mmol/L"),
}
REF_TEXT = {
    "Haemoglobin": {"F": "12.0 - 15.5", "M": "13.5 - 17.5"}, "WBC": "4.0 - 11.0", "ANC": "2.0 - 7.5",
    "Platelets": "150 - 410", "Creatinine": "0.6 - 1.2", "ALT": "7 - 40", "AST": "8 - 40",
    "Bilirubin": "0.2 - 1.2", "Albumin": "3.5 - 5.0", "CEA": "< 5.0", "CA 15-3": "< 30",
    "Sodium": "135 - 145", "Potassium": "3.5 - 5.1",
}

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu"]


def _font(bold=False, size=24):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    for d in FONT_DIRS:
        p = Path(d) / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def ddmmyyyy(d: datetime) -> str:
    return d.strftime("%d/%m/%Y")


def fill_dates(text: str, today: datetime) -> str:
    return re.sub(r"\{d(-?\d+)\}", lambda m: ddmmyyyy(today + timedelta(days=int(m.group(1)))), text)


def report_lines(spec: dict, patient: dict, today: datetime) -> dict:
    when = (today + timedelta(days=spec["day"])).replace(
        hour=int(spec["time"][:2]), minute=int(spec["time"][3:]), second=0, microsecond=0)
    hospital = spec["hospital"] or HOME
    external = spec["source"] in ("external", "patient") and spec["hospital"]
    pid_line = (f"UHID: {zlib.crc32((hospital + patient['id']).encode()) % 900000 + 100000}"
                if external else f"Patient ID: {patient['id']}")
    if patient.get("abha_id"):
        pid_line += f"   ABHA: {patient['abha_id']}"
    rows = []
    for test, value in spec["labs"]:
        label, unit = LAB_LABELS[test]
        ref = REF_TEXT[test]
        ref = ref[patient["sex"]] if isinstance(ref, dict) else ref
        rows.append((label, f"{value:g}", unit, ref))
    sections = [(h, fill_dates(t, today)) for h, t in spec["sections"]]
    return dict(hospital=hospital, dept=spec["dept"] or "", title=spec["title"].upper(), when=when,
                patient_line=f"Name: {patient['name']}    Age/Sex: {patient['age']} / {patient['sex']}",
                pid_line=pid_line, date_line=f"Report date: {ddmmyyyy(when)} {when:%H:%M}",
                rows=rows, sections=sections, signer=spec["signer"] or "")


# ------------------------------------------------------------------------------------- PDF
def render_pdf(spec: dict, patient: dict, today: datetime, out: Path) -> Path:
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    r = report_lines(spec, patient, today)
    out = out.with_suffix(".pdf")
    c = canvas.Canvas(str(out), pagesize=A4)
    w, h = A4
    c.setFillColor(HexColor("#4B2E83"))
    c.rect(0, h - 70, w, 70, fill=1, stroke=0)
    c.setFillColor(HexColor("#FFFFFF"))
    c.setFont("Helvetica-Bold", 15)
    c.drawString(40, h - 35, r["hospital"])
    c.setFont("Helvetica", 9)
    c.drawString(40, h - 52, (r["dept"] + "  |  " if r["dept"] else "") + "Demo document - all data fabricated")
    c.setFillColor(HexColor("#111111"))
    y = h - 100
    c.setFont("Helvetica-Bold", 13)
    c.drawString(40, y, r["title"])
    y -= 22
    c.setFont("Helvetica", 10)
    for line in (r["patient_line"], r["pid_line"], r["date_line"]):
        c.drawString(40, y, line)
        y -= 15
    c.line(40, y, w - 40, y)
    y -= 22
    if r["rows"]:
        c.setFont("Helvetica-Bold", 10)
        for x, t in zip((40, 260, 340, 430), ("Test", "Result", "Unit", "Reference")):
            c.drawString(x, y, t)
        y -= 16
        c.setFont("Helvetica", 10)
        for label, val, unit, ref in r["rows"]:
            for x, t in zip((40, 260, 340, 430), (label, val, unit, ref)):
                c.drawString(x, y, t)
            y -= 15
        y -= 10
    for head, text in r["sections"]:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(40, y, f"{head}:")
        y -= 14
        c.setFont("Helvetica", 10)
        for line in textwrap.wrap(text, 95):
            c.drawString(52, y, line)
            y -= 13
        y -= 8
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(40, 60, f"Electronically signed: {r['signer']}")
    c.drawString(40, 46, "OncoBrief prototype - FABRICATED DEMO DATA - not a real patient record")
    c.save()
    return out


# ------------------------------------------------------------------------------------- scans
def render_scan(spec: dict, patient: dict, today: datetime, out: Path, photo: bool = False,
                poor: bool = False) -> Path:
    r = report_lines(spec, patient, today)
    W, H = 1240, 1754
    img = Image.new("L", (W, H), 250)
    d = ImageDraw.Draw(img)
    f_h, f_b, f_t, f_s = _font(True, 36), _font(True, 28), _font(False, 26), _font(False, 20)
    d.rectangle([60, 60, W - 60, 175], outline=40, width=3)
    d.text((90, 80), r["hospital"], font=f_h, fill=20)
    d.text((90, 130), (r["dept"] + " | " if r["dept"] else "") + "Demo document - fabricated data", font=f_s, fill=60)
    y = 215
    d.text((80, y), r["title"], font=f_b, fill=15)
    y += 56
    for line in (r["patient_line"], r["pid_line"], r["date_line"]):
        d.text((80, y), line, font=f_t, fill=25)
        y += 40
    d.line([80, y + 4, W - 80, y + 4], fill=60, width=2)
    y += 30
    if r["rows"]:
        cols = (80, 560, 740, 930)
        for x, t in zip(cols, ("Test", "Result", "Unit", "Reference")):
            d.text((x, y), t, font=f_b, fill=15)
        y += 46
        for label, val, unit, ref in r["rows"]:
            for x, t in zip(cols, (label, val, unit, ref)):
                d.text((x, y), t, font=f_t, fill=20)
            y += 42
        y += 20
    for head, text in r["sections"]:
        d.text((80, y), f"{head}:", font=f_b, fill=15)
        y += 40
        for line in textwrap.wrap(text, 72):
            d.text((100, y), line, font=f_t, fill=25)
            y += 36
        y += 18
    d.text((80, H - 160), f"Electronically signed: {r['signer']}", font=f_s, fill=50)
    d.text((80, H - 125), "OncoBrief prototype - FABRICATED DEMO DATA", font=f_s, fill=50)

    rng = random.Random(f"{spec['pid']}{spec['day']}{spec['title']}")
    # paper texture + scanner noise
    if spec.get("quality") != "clean":
        noise = Image.effect_noise((W, H), 18 if not poor else 30).convert("L")
        img = Image.blend(img, noise, 0.08 if not poor else 0.16)
    angle = rng.uniform(-0.9, 0.9) if not photo else rng.uniform(-3.5, 3.5)
    img = img.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=235)
    if photo:
        # uneven lighting like a phone photo on a table
        grad = Image.linear_gradient("L").resize((W, H)).rotate(rng.choice([20, 160, 200]))
        img = Image.blend(img, grad, 0.18 if not poor else 0.3)
        img = img.filter(ImageFilter.GaussianBlur(1.3 if not poor else 2.3))
        img = img.resize((int(W * 0.72), int(H * 0.72)) if not poor else (int(W * 0.6), int(H * 0.6)))
    elif spec.get("quality") != "clean":
        img = img.filter(ImageFilter.GaussianBlur(0.6))
    out = out.with_suffix(".jpg")
    img.convert("RGB").save(out, "JPEG", quality=88 if spec.get("quality") == "clean" else 55 if not poor else 35)
    return out


def render(spec: dict, patient: dict, today: datetime, out: Path) -> Path:
    if spec["fmt"] == "pdf":
        return render_pdf(spec, patient, today, out)
    return render_scan(spec, patient, today, out, photo=spec["fmt"] == "photo", poor=spec["quality"] == "poor")
