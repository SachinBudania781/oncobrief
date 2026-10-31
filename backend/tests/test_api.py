"""End-to-end API checks on a freshly seeded demo database (run: cd backend && pytest -q)."""
import pytest


def test_health_and_seed(client):
    assert client.get("/api/health").json()["status"] == "ok"
    stats = client.get("/api/stats").json()
    assert stats["patients"] >= 5 and stats["documents"] > 40


def test_upload_requires_type_and_files_into_patient_folder(client):
    from app.services.ocr import TESSERACT_OK
    if not TESSERACT_OK:
        pytest.skip("Tesseract executable required for live scan OCR; PDF and text uploads are tested separately")
    scan = client.get("/api/scanner/scan").content
    bad = client.post("/api/documents", data={"patient_id": "OB-2026-0001", "category": "Lab report",
                                              "subtype": "Not a real type", "record_date": "2026-10-02T08:40"},
                      files={"file": ("scan.jpg", scan, "image/jpeg")})
    assert bad.status_code == 422
    ok = client.post("/api/documents", data={"patient_id": "OB-2026-0001", "category": "Lab report",
                                             "subtype": "CBC", "record_date": "2026-10-02T08:40"},
                     files={"file": ("scan.jpg", scan, "image/jpeg")}).json()
    assert ok["folder_path"].startswith("storage/OB-2026-0001/lab-report/")
    values = {v["test"]: v for v in ok["lab_values"]}
    assert values["Haemoglobin"]["value"] == 9.4 and values["Haemoglobin"]["flag"] == "L"


def test_brief_cites_only_this_patients_documents(client):
    for pid, visit in [("OB-2026-0001", "follow_up"), ("OB-2026-0002", "transfer"), ("OB-2026-0003", "new")]:
        b = client.post("/api/brief", json={"patient_id": pid, "visit_type": visit}).json()
        own = {d["tag"] for d in client.get(f"/api/patients/{pid}/documents").json()}
        c = b["content"]
        assert c["summary"], "brief must have a summary"
        for block in (c["summary"], c["key_findings"], c["alerts"]):
            for item in block:
                for s in item["sources"]:
                    if s.startswith("D"):
                        assert s in own, f"{s} cited for {pid} but not in their folder"


def test_new_patient_brief_lists_missing_documents(client):
    b = client.post("/api/brief", json={"patient_id": "OB-2026-0003", "visit_type": "new"}).json()
    assert "Imaging: MRI" in b["content"]["missing_documents"]


def test_negated_imaging_is_not_flagged(client):
    b = client.post("/api/brief", json={"patient_id": "OB-2026-0005", "visit_type": "follow_up"}).json()
    assert not [a for a in b["content"]["alerts"] if a.get("kind") == "imaging"]


def test_schedule_detects_clashes(client):
    clashes = client.get("/api/schedule").json()["clashes"]
    kinds = {c["type"] for c in clashes}
    assert {"patient", "room"} <= kinds


def test_schedule_and_taxonomy_share_hospital_calendar_clock(client, monkeypatch):
    from datetime import datetime
    import app.routers.care as care_router
    import app.routers.documents as documents_router

    hospital_now = datetime(2040, 1, 2, 12, 34)
    monkeypatch.setattr(care_router, "hospital_now", lambda: hospital_now)
    monkeypatch.setattr(documents_router, "hospital_now", lambda: hospital_now)

    taxonomy = client.get("/api/taxonomy").json()
    schedule = client.get("/api/schedule").json()

    assert taxonomy["hospital_today"] == "2040-01-02"
    assert taxonomy["hospital_now"] == "2040-01-02T12:34"
    assert schedule["date"] == taxonomy["hospital_today"]
    assert schedule["current_time"] == taxonomy["hospital_now"]


def test_upcoming_appointments_use_hospital_clock_and_exclude_cancelled(client, monkeypatch):
    from datetime import datetime, timedelta
    from sqlalchemy import delete
    from app.db import SessionLocal
    from app.models import Appointment
    import app.routers.care as care_router

    hospital_now = datetime(2040, 1, 2, 12, 0)
    monkeypatch.setattr(care_router, "hospital_now", lambda: hospital_now)
    past = Appointment(patient_id="OB-2026-0001", department="Medical Oncology OPD", room="OPD-3",
                       clinician="Dr. R. Menon", start=hospital_now - timedelta(hours=1),
                       end=hospital_now - timedelta(minutes=40), visit_type="follow_up", status="booked")
    future = Appointment(patient_id="OB-2026-0001", department="Medical Oncology OPD", room="OPD-3",
                         clinician="Dr. R. Menon", start=hospital_now + timedelta(hours=1),
                         end=hospital_now + timedelta(hours=1, minutes=20), visit_type="follow_up", status="booked")
    cancelled = Appointment(patient_id="OB-2026-0001", department="Medical Oncology OPD", room="OPD-3",
                            clinician="Dr. R. Menon", start=hospital_now + timedelta(hours=2),
                            end=hospital_now + timedelta(hours=2, minutes=20), visit_type="follow_up", status="cancelled")
    with SessionLocal() as db:
        db.add_all([past, future, cancelled])
        db.commit()
        future_id = future.id
        created_ids = [past.id, future.id, cancelled.id]

    try:
        rows = client.get("/api/appointments", params={"upcoming": "true", "patient_id": "OB-2026-0001"}).json()
        assert [row["id"] for row in rows] == [future_id]
    finally:
        with SessionLocal() as db:
            db.execute(delete(Appointment).where(Appointment.id.in_(created_ids)))
            db.commit()


def test_day_pass_hides_cancelled_appointments(client):
    from datetime import datetime, timedelta
    from sqlalchemy import delete
    from app.db import SessionLocal
    from app.models import Appointment

    start = datetime(2040, 1, 2, 10, 0)
    booked = Appointment(patient_id="OB-2026-0001", department="Medical Oncology OPD", room="OPD-3",
                         clinician="Dr. R. Menon", start=start, end=start + timedelta(minutes=20),
                         visit_type="follow_up", status="booked")
    cancelled = Appointment(patient_id="OB-2026-0001", department="Medical Oncology OPD", room="OPD-4",
                            clinician="Dr. R. Menon", start=start + timedelta(hours=1),
                            end=start + timedelta(hours=1, minutes=20), visit_type="follow_up", status="cancelled")
    with SessionLocal() as db:
        db.add_all([booked, cancelled])
        db.commit()
        booked_id, cancelled_id = booked.id, cancelled.id

    try:
        response = client.get("/api/v2/patients/OB-2026-0001/day-pass", params={"day": "2040-01-02"})
        assert response.status_code == 200
        assert [stop["id"] for stop in response.json()["stops"]] == [booked_id]
        assert cancelled_id not in [stop["id"] for stop in response.json()["stops"]]
    finally:
        with SessionLocal() as db:
            db.execute(delete(Appointment).where(Appointment.id.in_([booked_id, cancelled_id])))
            db.commit()


def test_stats_use_hospital_day_and_exclude_cancelled_appointments(client, monkeypatch):
    from datetime import datetime
    from sqlalchemy import delete
    from app.db import SessionLocal
    from app.models import Appointment
    import app.routers.patients as patients_router

    hospital_today = datetime(2040, 1, 2, 12, 0)
    monkeypatch.setattr(patients_router, "hospital_now", lambda: hospital_today)
    created_ids = []
    with SessionLocal() as db:
        booked = Appointment(patient_id="OB-2026-0001", department="Medical Oncology OPD", room="OPD-3",
                             clinician="Dr. R. Menon", start=hospital_today.replace(hour=10),
                             end=hospital_today.replace(hour=10, minute=20), visit_type="follow_up", status="booked")
        cancelled = Appointment(patient_id="OB-2026-0002", department="Medical Oncology OPD", room="OPD-4",
                                clinician="Dr. R. Menon", start=hospital_today.replace(hour=11),
                                end=hospital_today.replace(hour=11, minute=20), visit_type="follow_up", status="cancelled")
        db.add_all([booked, cancelled])
        db.commit()
        created_ids = [booked.id, cancelled.id]

    try:
        assert client.get("/api/stats").json()["appointments_today"] == 1
    finally:
        with SessionLocal() as db:
            db.execute(delete(Appointment).where(Appointment.id.in_(created_ids)))
            db.commit()


def test_dense_wearable_history_is_bucketed_across_requested_range(client):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import delete
    from app.db import SessionLocal
    from app.models import WearableReading

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    readings = [WearableReading(
        patient_id="OB-2026-0001", metric="heart_rate", value=60 + (index % 20), unit="bpm",
        observed_at=now - timedelta(minutes=1500 - index), source="android_ble", device_name="Test sensor",
    ) for index in range(1501)]
    with SessionLocal() as db:
        db.add_all(readings)
        db.commit()
        created_ids = [row.id for row in readings]

    try:
        response = client.get("/api/v2/patients/OB-2026-0001/wearables", params={"days": 2})
        assert response.status_code == 200
        payload = response.json()
        points = [row for row in payload["items"] if row["metric"] == "heart_rate"]
        assert payload["aggregated"] is True
        assert payload["bucket_seconds"] == 900
        assert len(points) < len(readings)
        assert sum(row["sample_count"] for row in points) == len(readings)
        assert min(row["min_value"] for row in points) == 60
        assert max(row["max_value"] for row in points) == 79
    finally:
        with SessionLocal() as db:
            db.execute(delete(WearableReading).where(WearableReading.id.in_(created_ids)))
            db.commit()


def test_low_activity_review_uses_hospital_local_day(client, monkeypatch):
    from datetime import datetime
    from sqlalchemy import delete, select
    from app.db import SessionLocal
    from app.models import WearableReading
    from app.round2_models import AccessGrant, JobReceipt, Notification, User
    import app.services.jobs as jobs

    monkeypatch.setenv("HOSPITAL_TIME_ZONE", "Asia/Kolkata")
    patient_id = "OB-2026-0001"
    recipient = User(username="activity-boundary-test", name="Activity test caregiver", role="caregiver")
    readings = [
        WearableReading(patient_id=patient_id, metric="steps", value=100, unit="steps",
                        observed_at=datetime(2040, 1, 1, 12, 0), source="manual", device_name="test"),
        # This second sample is already Jan 2 in the hospital timezone and must
        # not hide the low total recorded on Jan 1.
        WearableReading(patient_id=patient_id, metric="steps", value=5000, unit="steps",
                        observed_at=datetime(2040, 1, 1, 20, 0), source="manual", device_name="test"),
    ]
    key = "low-activity:OB-2026-0001:2040-01-01"
    with SessionLocal() as db:
        db.add(recipient)
        db.flush()
        recipient_id = recipient.id
        db.add(AccessGrant(user_id=recipient_id, patient_id=patient_id, scopes=["activity"], consent_by="test"))
        db.add_all(readings)
        db.commit()
        reading_ids = [row.id for row in readings]

    try:
        jobs.tick(now=datetime(2040, 1, 2, 0, 5))
        with SessionLocal() as db:
            assert db.get(JobReceipt, key) is not None
            assert db.scalar(select(Notification.id).where(
                Notification.user_id == recipient_id,
                Notification.patient_id == patient_id,
                Notification.channel == "activity",
            )) is not None
    finally:
        with SessionLocal() as db:
            db.execute(delete(JobReceipt).where(JobReceipt.key == key))
            db.execute(delete(Notification).where(Notification.user_id == recipient_id))
            db.execute(delete(AccessGrant).where(AccessGrant.user_id == recipient_id))
            db.execute(delete(User).where(User.id == recipient_id))
            db.execute(delete(WearableReading).where(WearableReading.id.in_(reading_ids)))
            db.commit()


def test_search_reads_ocr_text(client):
    hits = client.get("/api/patients/OB-2026-0002/documents", params={"q": "EGFR"}).json()
    assert any("EGFR" in (h.get("snippet") or "") for h in hits)

