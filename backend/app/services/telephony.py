from ..timeutil import utcnow
import os
import secrets
from datetime import datetime, timedelta
from fastapi import HTTPException
from ..round2_models import ShareLink
from ..security import digest


def call_payload(db, patient_id, user_id):
    base = (os.getenv("PUBLIC_BASE_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
    if not base.startswith("https://"):
        raise HTTPException(503, "Set PUBLIC_BASE_URL to the public HTTPS address before enabling phone callbacks")
    token = secrets.token_urlsafe(40)
    db.add(ShareLink(patient_id=patient_id, token_hash=digest(token), kind="phone_callback", fields=[],
                     expires_at=utcnow() + timedelta(hours=1), created_by=user_id))
    db.commit()
    return {"callback_url": base + "/api/webhooks/telephony", "callback_token": token,
            "questions": ["temperature", "nausea", "pain", "fatigue", "appetite", "breathing", "distress", "text"],
            "identity_verification_required": True}
