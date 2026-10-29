from ..timeutil import utcnow
import os
import secrets
from datetime import datetime, timedelta
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from ..db import get_db
from ..models import Patient
from ..taxonomy import DEPARTMENTS
from ..round2_models import AccessGrant, Challenge, LoginSession, User
from ..security import (COOKIE_SECURE, DEMO_MODE, SESSION_MINUTES, append_audit, digest,
                        identity, password_hash, password_ok, roles, visible_ids)

router = APIRouter(prefix="/api/auth", tags=["authentication"])

PORTAL_ROLES = {
    "patient": {"patient", "caregiver"}, "doctor": {"doctor"},
    "staff": {"nurse", "lab", "frontdesk", "navigator", "dietitian", "privacy", "admin"},
}


def sign_in_id(db, user):
    if user.role == "patient":
        grant = db.scalar(select(AccessGrant).where(AccessGrant.user_id == user.id, AccessGrant.active.is_(True)))
        if grant:
            return grant.patient_id
    prefix = "DOC" if user.role == "doctor" else "CG" if user.role == "caregiver" else "STF"
    return f"{prefix}-{user.id:04d}"


def user_dict(db, user):
    return {"id": user.id, "username": user.username, "sign_in_id": sign_in_id(db, user), "name": user.name, "role": user.role,
            "department": user.department, "patient_ids": visible_ids(db, user), "demo": DEMO_MODE,
            "permissions": {g.patient_id: g.scopes for g in db.scalars(select(AccessGrant).where(AccessGrant.user_id == user.id, AccessGrant.active.is_(True))) if not g.expires_at or g.expires_at > utcnow()}, "idle_minutes": SESSION_MINUTES}


def login_session(db, user, request, response):
    token = secrets.token_urlsafe(48)
    db.add(LoginSession(user_id=user.id, token_hash=digest(token),
                        expires_at=utcnow() + timedelta(hours=8),
                        device=request.headers.get("user-agent", "Unknown device")[:200]))
    db.commit()
    response.set_cookie("ob_session", token, httponly=True, secure=COOKIE_SECURE, samesite="strict", max_age=8 * 3600)
    append_audit(db, user, "sign_in")
    return user_dict(db, user)


@router.get("/config")
def config(db=Depends(get_db)):
    return {"demo": DEMO_MODE, "idle_minutes": SESSION_MINUTES,
            "accounts": [{"username": u.username, "sign_in_id": sign_in_id(db, u), "phone": u.phone, "name": u.name, "role": u.role}
                         for u in db.scalars(select(User).where(User.active.is_(True))) ] if DEMO_MODE else [],
            "demo_password": "OncoDemo!2026" if DEMO_MODE else None}


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)
    totp: str = Field(default="", max_length=10)
    portal: Literal["all", "patient", "doctor", "staff"] = "all"
    identifier_type: Literal["id", "phone"] = "id"


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db=Depends(get_db)):
    value = body.username.strip()
    user = None
    if body.identifier_type == "phone":
        # Staff phone sign-in still requires a password and, outside demo, TOTP.
        # OTP remains patient-only. Never select a patient's account in a staff portal.
        allowed = PORTAL_ROLES.get(body.portal, set()) if body.portal in {"doctor", "staff"} else set()
        matches = [u for u in db.scalars(select(User).where(User.active.is_(True), User.role.in_(allowed)))
                   if u.phone and u.phone == value]
        user = matches[0] if len(matches) == 1 else None
    elif value.upper().startswith(("DOC-", "STF-", "CG-")):
        prefix, _, number = value.upper().partition("-")
        candidate = db.get(User, int(number)) if number.isdigit() and len(number) <= 10 else None
        if candidate and candidate.active and sign_in_id(db, candidate) == f"{prefix}-{int(number):04d}":
            user = candidate
    elif value.upper().startswith("OB-"):
        user = db.scalar(select(User).join(AccessGrant, AccessGrant.user_id == User.id).where(
            User.role == "patient", User.active.is_(True), AccessGrant.active.is_(True),
            AccessGrant.patient_id == value.upper()))
    else:
        # Keep existing API clients and issued usernames working.
        user = db.scalar(select(User).where(User.username == value.lower(), User.active.is_(True)))
    if user and body.portal != "all" and user.role not in PORTAL_ROLES[body.portal]:
        user = None
    if not user or not password_ok(body.password, user.password_hash):
        raise HTTPException(401, "Invalid sign-in details")
    if not DEMO_MODE:
        if user.role == "patient":
            raise HTTPException(403, "Use phone OTP to sign in")
        import pyotp
        if user.role != "caregiver" and (not user.totp_secret or not pyotp.TOTP(user.totp_secret).verify(body.totp, valid_window=1)):
            raise HTTPException(401, "Enter the current authenticator code")
    return login_session(db, user, request, response)


class OTPIn(BaseModel):
    phone: str = Field(pattern=r"^\+?[0-9]{10,15}$")


@router.post("/otp")
def otp(body: OTPIn, db=Depends(get_db)):
    user = next((u for u in db.scalars(select(User).where(User.role == "patient", User.active.is_(True))) if u.phone == body.phone), None)
    challenge_id = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1000000):06d}"
    if user:
        db.add(Challenge(id=challenge_id, user_id=user.id, code_hash=digest(challenge_id + code),
                         expires_at=utcnow() + timedelta(minutes=5)))
        db.commit()
        if not DEMO_MODE:
            from ..services.integrations import deliver
            deliver("sms", {"to": body.phone, "body": "Your OncoBrief code is " + code})
    return {"challenge_id": challenge_id, "message": "If the account exists, a code has been sent.",
            **({"demo_code": code} if DEMO_MODE and user else {})}


class VerifyIn(BaseModel):
    challenge_id: str = Field(max_length=100)
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/verify-otp")
def verify(body: VerifyIn, request: Request, response: Response, db=Depends(get_db)):
    c = db.get(Challenge, body.challenge_id)
    if not c or c.used or c.attempts >= 5 or c.expires_at < utcnow():
        raise HTTPException(401, "Code expired or invalid")
    c.attempts += 1
    db.commit()
    if not secrets.compare_digest(c.code_hash, digest(c.id + body.code)):
        raise HTTPException(401, "Code expired or invalid")
    c.used = True
    db.commit()
    return login_session(db, db.get(User, c.user_id), request, response)


@router.get("/me")
def me(request: Request, db=Depends(get_db)):
    return user_dict(db, identity(request))


@router.post("/logout")
def logout(request: Request, response: Response, db=Depends(get_db)):
    user = identity(request)
    row = db.get(LoginSession, request.state.session_id)
    row.revoked = True
    db.commit()
    response.delete_cookie("ob_session")
    append_audit(db, user, "sign_out")
    return {"ok": True}


@router.get("/devices")
def devices(request: Request, db=Depends(get_db)):
    user = identity(request)
    return [{"id": s.id, "device": s.device, "last_seen": s.last_seen, "expires_at": s.expires_at,
             "current": s.id == request.state.session_id}
            for s in db.scalars(select(LoginSession).where(LoginSession.user_id == user.id,
                                                          LoginSession.revoked.is_(False),
                                                          LoginSession.expires_at > utcnow()))]


@router.delete("/devices/{session_id}")
def revoke(session_id: int, request: Request, db=Depends(get_db)):
    user = identity(request)
    row = db.get(LoginSession, session_id)
    if not row or row.user_id != user.id:
        raise HTTPException(404, "Device not found")
    row.revoked = True
    db.commit()
    append_audit(db, user, "revoke_device")
    return {"ok": True}


class UserIn(BaseModel):
    username: str = Field(min_length=3, max_length=100, pattern=r"^[a-z0-9_.@+-]+$")
    name: str = Field(min_length=2, max_length=100)
    role: Literal["doctor", "nurse", "lab", "frontdesk", "navigator", "dietitian", "privacy", "patient"]
    password: str = Field(min_length=12, max_length=200)
    phone: str = ""
    department: str = ""
    ward: str = ""
    patient_ids: list[str] = Field(default_factory=list, max_length=100)


@router.post("/users")
def create_user(body: UserIn, request: Request, db=Depends(get_db)):
    user = identity(request)
    roles(user, "admin")
    department_names = {d["name"] for d in DEPARTMENTS if d["name"] != "Front desk / Records"}
    if body.role in {"doctor", "nurse", "lab"} and body.department and body.department not in department_names:
        raise HTTPException(422, "Choose a valid department")
    default_departments = {
        "doctor": "Medical Oncology OPD",
        "nurse": "Day-care Chemotherapy",
        "lab": "Biochemistry & Haematology Lab",
    }
    department = body.department or default_departments.get(body.role, "")
    if body.role == "frontdesk" and department and department not in department_names:
        raise HTTPException(422, "Choose a valid clinical department or leave central front desk unassigned")
    if body.role=="patient" and (len(body.patient_ids)!=1 or not body.phone):
        raise HTTPException(422,"A patient account needs exactly one patient folder and a registered phone number")
    if db.scalar(select(User).where(User.username == body.username)):
        raise HTTPException(409, "Username already exists")
    if any(not db.get(Patient, p) for p in body.patient_ids):
        raise HTTPException(422, "Unknown patient")
    import pyotp
    secret = pyotp.random_base32()
    row_data = body.model_dump(exclude={"password", "patient_ids"})
    row_data["department"] = department
    row = User(**row_data, password_hash=password_hash(body.password), totp_secret=secret)
    db.add(row)
    db.flush()
    for pid in body.patient_ids:
        scopes = {"frontdesk": ["profile", "appointments"], "lab": ["profile", "documents"],
                  "navigator": ["profile", "appointments", "finance", "chat"], "dietitian": ["profile", "nutrition"]}.get(body.role, ["all"])
        db.add(AccessGrant(user_id=row.id, patient_id=pid, scopes=scopes, consent_by="Hospital administrator"))
    db.commit()
    append_audit(db, user, "create_user", detail=row.username)
    return {"id": row.id, "sign_in_id": sign_in_id(db, row), "totp_setup_uri": pyotp.TOTP(secret).provisioning_uri(row.username, issuer_name="OncoBrief"),
            "message": "Store this one-time authenticator setup securely. It will not be shown again."}


@router.get("/users")
def users(request: Request, db=Depends(get_db)):
    roles(identity(request), "admin")
    return [{"id":u.id,"sign_in_id":sign_in_id(db,u),"name":u.name,"username":u.username,"role":u.role,"department":u.department,"ward":u.ward} for u in db.scalars(select(User).where(User.active.is_(True)))]


class DepartmentAssignmentIn(BaseModel):
    department: str = ""


@router.patch("/users/{user_id}/department")
def assign_department(user_id: int, body: DepartmentAssignmentIn, request: Request, db=Depends(get_db)):
    actor = identity(request)
    roles(actor, "admin")
    member = db.get(User, user_id)
    if not member or member.role not in {"doctor", "nurse", "lab", "frontdesk"}:
        raise HTTPException(404, "Department staff account not found")
    department_names = {d["name"] for d in DEPARTMENTS if d["name"] != "Front desk / Records"}
    if member.role in {"doctor", "nurse", "lab"} and body.department not in department_names:
        raise HTTPException(422, "Doctors, nurses and lab staff must be assigned to a department")
    if member.role == "frontdesk" and body.department and body.department not in department_names:
        raise HTTPException(422, "Choose a valid clinical department or leave central front desk unassigned")
    member.department = body.department
    db.commit()
    append_audit(db, actor, "assign_department", detail=f"{member.username}: {body.department or 'central front desk'}")
    return {"id": member.id, "department": member.department}


class RelationshipIn(BaseModel):
    user_id: int
    patient_id: str
    reason: str = Field(min_length=10, max_length=1000)


@router.post("/relationships")
def assign(body: RelationshipIn, request: Request, db=Depends(get_db)):
    actor = identity(request)
    roles(actor, "admin")
    user, p = db.get(User,body.user_id), db.get(Patient,body.patient_id)
    if not user or not p or user.role in {"caregiver", "privacy", "admin"}:
        raise HTTPException(422,"Choose a valid hospital account or the patient's own account")
    if user.role == "patient" and any(g.patient_id != p.id for g in db.scalars(select(AccessGrant).where(AccessGrant.user_id==user.id,AccessGrant.active.is_(True)))):
        raise HTTPException(409,"A patient account can belong to only one patient folder")
    row=db.scalar(select(AccessGrant).where(AccessGrant.user_id==user.id,AccessGrant.patient_id==p.id)) or AccessGrant(user_id=user.id,patient_id=p.id)
    row.scopes={"frontdesk":["profile","appointments"],"lab":["profile","documents"],"navigator":["profile","appointments","finance","notes","chat","alerts"],"dietitian":["profile","nutrition","documents"]}.get(user.role,["all"])
    row.active,row.expires_at,row.consent_by=True,None,actor.name+": "+body.reason
    db.add(row)
    if user.role=="doctor":
        p.treating_oncologist=user.name
        from ..round2_models import TreatingClinician
        primary=db.get(TreatingClinician,p.id) or TreatingClinician(patient_id=p.id)
        primary.user_id=user.id
        db.add(primary)
    db.commit()
    append_audit(db,actor,"assign_care_relationship",p.id,f"{user.name}; ward {user.ward}; {body.reason}")
    return {"ok":True}
