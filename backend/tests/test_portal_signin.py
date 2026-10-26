"""Issued identifiers and phone sign-in must preserve portal and role boundaries."""
import pytest

PASSWORD = "OncoDemo!2026"


@pytest.mark.parametrize("username,portal,prefix", [("doctor", "doctor", "DOC-"), ("nurse", "staff", "STF-"), ("frontdesk", "staff", "STF-"), ("meera", "patient", "OB-"), ("caregiver", "patient", "CG-")])
def test_issued_id_signin(client, username, portal, prefix):
    account = next(a for a in client.get("/api/auth/config").json()["accounts"] if a["username"] == username)
    assert account["sign_in_id"].startswith(prefix)
    client.cookies.clear()
    result = client.post("/api/auth/login", json={"username": account["sign_in_id"].lower(), "password": PASSWORD, "portal": portal})
    assert result.status_code == 200, result.text
    assert result.json()["username"] == username
    assert result.json()["sign_in_id"] == account["sign_in_id"]


@pytest.mark.parametrize("username,portal", [("doctor", "staff"), ("nurse", "doctor"), ("meera", "doctor"), ("doctor", "patient"), ("caregiver", "staff")])
def test_wrong_portal_cannot_create_session(client, username, portal):
    account = next(a for a in client.get("/api/auth/config").json()["accounts"] if a["username"] == username)
    client.cookies.clear()
    result = client.post("/api/auth/login", json={"username": account["sign_in_id"], "password": PASSWORD, "portal": portal})
    assert result.status_code == 401
    assert "ob_session" not in result.cookies


@pytest.mark.parametrize("username,portal", [("doctor", "doctor"), ("frontdesk", "staff")])
def test_phone_signin_needs_password_and_correct_portal(client, username, portal):
    account = next(a for a in client.get("/api/auth/config").json()["accounts"] if a["username"] == username)
    assert account["phone"]
    client.cookies.clear()
    body = {"username": account["phone"], "password": PASSWORD, "portal": portal, "identifier_type": "phone"}
    assert client.post("/api/auth/login", json={**body, "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={**body, "portal": "patient"}).status_code == 401
    result = client.post("/api/auth/login", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["username"] == username


def test_hospital_phone_does_not_receive_patient_otp(client):
    phone = next(a["phone"] for a in client.get("/api/auth/config").json()["accounts"] if a["username"] == "doctor")
    client.cookies.clear()
    result = client.post("/api/auth/otp", json={"phone": phone})
    assert result.status_code == 200
    assert "demo_code" not in result.json()


def test_id_prefix_cannot_impersonate_a_different_role(client):
    doctor = next(a for a in client.get("/api/auth/config").json()["accounts"] if a["username"] == "doctor")
    client.cookies.clear()
    result = client.post("/api/auth/login", json={"username": doctor["sign_in_id"].replace("DOC-", "STF-"), "password": PASSWORD, "portal": "staff"})
    assert result.status_code == 401


def test_phone_signin_keeps_production_authenticator_requirement(client, monkeypatch):
    import pyotp
    from sqlalchemy import select
    from app.db import SessionLocal
    from app.round2_models import User
    from app.routers import auth
    secret = pyotp.random_base32()
    with SessionLocal() as db:
        doctor = db.scalar(select(User).where(User.username == "doctor"))
        doctor.totp_secret = secret
        phone = doctor.phone
        db.commit()
    monkeypatch.setattr(auth, "DEMO_MODE", False)
    client.cookies.clear()
    body = {"username": phone, "password": PASSWORD, "portal": "doctor", "identifier_type": "phone"}
    assert client.post("/api/auth/login", json=body).status_code == 401
    assert client.post("/api/auth/login", json={**body, "totp": pyotp.TOTP(secret).now()}).status_code == 200
