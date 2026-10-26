from .timeutil import utcnow
"""Server-side identities, patient relationships, scoped consent and audit integrity."""
import hashlib
import hmac
import json
import os
import secrets
import threading
from datetime import datetime, timedelta
from fastapi import HTTPException, Request
from sqlalchemy import select
from .config import DATA_DIR
from .round2_models import AccessGrant, AuditChain, LoginSession, User

DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"
SESSION_MINUTES = int(os.getenv("SESSION_MINUTES", "30"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
_audit_lock = threading.RLock()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ":" + hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1).hex()


def password_ok(password, stored):
    return bool(stored) and hmac.compare_digest(password_hash(password, stored.split(":")[0]), stored)


def identity(request: Request):
    user = getattr(request.state, "user", None)
    if not user:
        raise HTTPException(401, "Please sign in")
    return user


def roles(user, *allowed):
    if user.role not in allowed:
        raise HTTPException(403, "Your role does not allow this action")


def grants(db, user):
    return db.scalars(select(AccessGrant).where(AccessGrant.user_id == user.id, AccessGrant.active.is_(True))).all()


def visible_ids(db, user, scope="profile"):
    if user.role == "admin":
        from .models import Patient
        return list(db.scalars(select(Patient.id)).all())
    now = utcnow()
    return [g.patient_id for g in grants(db, user)
            if (not g.expires_at or g.expires_at > now)
            and ("all" in g.scopes or scope in g.scopes or (scope == "profile" and g.scopes))]


def require_patient(db, user, patient_id, scope="profile"):
    if patient_id not in visible_ids(db, user, scope):
        raise HTTPException(403, "No active patient relationship or consent for this information")


def session_user(db, request):
    token = request.cookies.get("ob_session", "")
    if not token:
        return None
    row = db.scalar(select(LoginSession).where(LoginSession.token_hash == digest(token)))
    now = utcnow()
    if not row or row.revoked or row.expires_at < now or row.last_seen < now - timedelta(minutes=SESSION_MINUTES):
        return None
    user = db.get(User, row.user_id)
    if not user or not user.active:
        return None
    row.last_seen = now
    db.commit()
    request.state.session_id = row.id
    return user


def chain_payload(row):
    return json.dumps({k: (getattr(row, k).isoformat() if k == "at" else getattr(row, k))
                       for k in ("at", "actor_id", "actor_role", "actor_name", "action", "patient_id", "detail", "previous_hash")},
                      sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def append_audit(db, user, action, patient_id=None, detail=""):
    with _audit_lock:
        prev = db.scalar(select(AuditChain).order_by(AuditChain.id.desc()).limit(1))
        row = AuditChain(at=utcnow(), actor_id=getattr(user, "id", 0),
                         actor_role=user.role, actor_name=user.name, action=action,
                         patient_id=patient_id, detail=detail[:2000], previous_hash=prev.digest if prev else "0" * 64)
        row.digest = digest(chain_payload(row))
        db.add(row)
        db.commit()
        return row


def verify_chain(db):
    prev = "0" * 64
    for row in db.scalars(select(AuditChain).order_by(AuditChain.id)):
        if row.previous_hash != prev or row.digest != digest(chain_payload(row)):
            return {"valid": False, "first_invalid_id": row.id}
        prev = row.digest
    return {"valid": True, "head": prev}


def cipher():
    from cryptography.fernet import Fernet
    key = os.getenv("DATA_ENCRYPTION_KEY", "")
    if not key:
        if not DEMO_MODE:
            raise RuntimeError("Set DATA_ENCRYPTION_KEY before starting production")
        path = DATA_DIR / ".encryption-key"
        if not path.exists():
            path.write_bytes(Fernet.generate_key())
        key = path.read_bytes()
    return Fernet(key)


def encrypt_file(path):
    data = path.read_bytes()
    if not data.startswith(b"OBENC1:"):
        path.write_bytes(b"OBENC1:" + cipher().encrypt(data))


def read_file(path):
    data = path.read_bytes()
    return cipher().decrypt(data[7:]) if data.startswith(b"OBENC1:") else data
