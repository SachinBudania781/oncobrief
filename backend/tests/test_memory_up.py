from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool


@pytest.fixture
def memory_client(tmp_path, monkeypatch):
    from app import memory_up as feature
    from app.db import Base, get_db
    from app.models import Appointment, Patient
    from app.round2_models import AccessGrant, User

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    users = {}
    with Session(engine, expire_on_commit=False) as db:
        for pid in ["MEM-1", "MEM-2"]:
            db.add(Patient(id=pid, name=pid, sex="F", age=40))
        for name, role, department, scopes, pid in [
            ("doctor", "doctor", "Radiology", ["documents"], "MEM-1"),
            ("nurse", "nurse", "Radiology", ["documents"], "MEM-1"),
            ("other-department", "doctor", "Pathology", ["documents"], "MEM-1"),
            ("patient", "patient", "", ["documents"], "MEM-1"),
            ("caregiver", "caregiver", "", ["documents"], "MEM-1"),
            ("other-patient", "patient", "", ["documents"], "MEM-2"),
            ("no-documents", "caregiver", "", ["appointments"], "MEM-1"),
        ]:
            user = User(username=name, name=name, role=role, department=department)
            db.add(user)
            db.flush()
            db.add(AccessGrant(user_id=user.id, patient_id=pid, scopes=scopes))
            users[name] = user
        start = datetime(2040, 1, 2, 10)
        for aid, department, status in [(1, "Radiology", "booked"), (2, "Pathology", "booked"), (3, "Radiology", "cancelled")]:
            db.add(Appointment(id=aid, patient_id="MEM-1", department=department,
                               start=start, end=start + timedelta(minutes=20),
                               clinician="Doctor", room="Test", visit_type="follow_up", status=status))
        db.commit()
    monkeypatch.setattr(feature, "MEMORY_DIR", tmp_path / "memory-up")
    app = FastAPI()

    @app.middleware("http")
    async def test_identity(request: Request, call_next):
        name = request.headers.get("x-test-user", "doctor")
        request.state.user = users[name]
        return await call_next(request)

    def database():
        with Session(engine, expire_on_commit=False) as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.include_router(feature.router)
    with TestClient(app) as client:
        yield client, users, engine, feature
    engine.dispose()


def draft(client, **changes):
    body = {"appointment_id": 1, "title": "Memory Up", "advice": "Bring the prior scan to the next appointment.",
            "identity_confirmed": "true"} | changes
    return client.post("/api/memory-up/patients/MEM-1", data=body)


def test_doctor_review_then_patient_and_caregiver_access(memory_client):
    client, _, _, _ = memory_client
    created = draft(client)
    assert created.status_code == 200, created.text
    note_id = created.json()["id"]
    for who in ["patient", "caregiver"]:
        assert client.get("/api/memory-up/patients/MEM-1", headers={"x-test-user": who}).json() == []
    client.headers["x-test-user"] = "nurse"
    assert client.post(f"/api/memory-up/{note_id}/publish").status_code == 403
    client.headers["x-test-user"] = "doctor"
    assert client.post(f"/api/memory-up/{note_id}/publish").status_code == 200
    assert client.post(f"/api/memory-up/{note_id}/publish").status_code == 409
    for who in ["patient", "caregiver"]:
        rows = client.get("/api/memory-up/patients/MEM-1", headers={"x-test-user": who}).json()
        assert len(rows) == 1 and rows[0]["approved_by"] == "doctor"


def test_patient_and_department_isolation(memory_client):
    client, _, _, _ = memory_client
    note_id = draft(client).json()["id"]
    assert draft(client, appointment_id=2).status_code == 403
    assert draft(client, appointment_id=3).status_code == 422
    assert client.get("/api/memory-up/patients/MEM-1", headers={"x-test-user": "other-patient"}).status_code == 403
    assert client.get("/api/memory-up/patients/MEM-1", headers={"x-test-user": "no-documents"}).status_code == 403
    client.headers["x-test-user"] = "other-department"
    assert client.get("/api/memory-up/patients/MEM-1").json() == []
    assert client.post(f"/api/memory-up/{note_id}/publish").status_code == 403
    assert client.get(f"/api/memory-up/{note_id}/attachment").status_code == 403


def test_attachment_encrypted_and_hidden_until_published(memory_client):
    client, _, _, feature = memory_client
    data = {"appointment_id": 1, "title": "Memory Up", "identity_confirmed": "true"}
    result = client.post("/api/memory-up/patients/MEM-1", data=data,
                         files={"file": ("visit.txt", b"Bring the original report.", "text/plain")})
    assert result.status_code == 200, result.text
    note_id = result.json()["id"]
    assert next(feature.MEMORY_DIR.iterdir()).read_bytes().startswith(b"OBENC1:")
    url = f"/api/memory-up/{note_id}/attachment"
    assert client.get(url, headers={"x-test-user": "patient"}).status_code == 404
    assert client.post(f"/api/memory-up/{note_id}/publish").status_code == 200
    assert client.get(url, headers={"x-test-user": "patient"}).content == b"Bring the original report."


def test_empty_wrong_type_and_missing_confirmation_rejected(memory_client):
    client, _, _, _ = memory_client
    assert draft(client, advice="").status_code == 422
    assert draft(client, identity_confirmed="false").status_code == 422
    result = client.post("/api/memory-up/patients/MEM-1", data={"appointment_id": 1, "identity_confirmed": "true"},
                         files={"file": ("bad.pdf", b"not a PDF", "application/pdf")})
    assert result.status_code == 422


def test_context_shows_only_accessible_patients_and_department_visits(memory_client):
    client, _, _, _ = memory_client
    result = client.get("/api/memory-up/context?patient_id=MEM-1").json()
    assert [p["id"] for p in result["patients"]] == ["MEM-1"]
    assert [a["id"] for a in result["appointments"]] == [1]
    patient = client.get("/api/memory-up/context?patient_id=MEM-1", headers={"x-test-user": "patient"}).json()
    assert patient["can_write"] is False


def test_page_assets_and_traversal_protection(memory_client):
    client, _, _, _ = memory_client
    assert client.get("/memory-up").status_code == 200
    assert client.get("/memory-up-assets/app.js").status_code == 200
    assert client.get("/memory-up-assets/unknown").status_code == 404
