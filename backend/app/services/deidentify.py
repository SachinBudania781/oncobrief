import re


def for_model(text, patient):
    from .companion import safe_text
    text = safe_text(text)
    for value in (patient.name, patient.phone, patient.abha_id):
        if value:
            text = re.sub(re.escape(value), "[redacted]", text, flags=re.I)
    text = re.sub(r"(?im)\b(?:name|phone|mobile|ABHA|UHID)\s*[:\-]\s*[^\n]+", "[identifying line removed]", text)
    text = re.sub(r"(?<!\d)(?:\+91[ -]?)?[6-9]\d{9}(?!\d)", "[phone removed]", text)
    return text
