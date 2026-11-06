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



def test_dense_wearable_history_is_bucketed_across_requested_range(client, monkeypatch):
    from datetime import datetime, timedelta, timezone
    from sqlalchemy import delete
    from app.db import SessionLocal
    from app.models import WearableReading

    now = datetime(2042, 1, 2, 12)
    from app.routers import round2
    monkeypatch.setattr(round2, "utcnow", lambda: now)
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
        points = [row for row in payload["items"] if row["metric"] == "heart_rate" and row.get("source") == "android_ble"]
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



def test_uploaded_document_survives_ephemeral_file_loss(client, login):
    from pathlib import Path
    from app.config import DATA_DIR
    from app.db import SessionLocal
    from app.models import Document
    from app.file_storage import StoredFile
    from app.security import read_file

    text = b"Patient ID: OB-2026-0001\nName: Meera Kulkarni\nRelease persistence check."
    response = client.post("/api/documents", files={"file": ("release.txt", text, "text/plain")},
        data={"patient_id": "OB-2026-0001", "category": "Clinical note", "subtype": "Consultation transcript", "record_date": "2026-11-06", "title": "Persistence check"})
    assert response.status_code == 200, response.text
    doc_id = response.json()["id"]
    with SessionLocal() as db:
        doc = db.get(Document, doc_id)
        path = DATA_DIR / doc.file_path
        blob = db.get(StoredFile, Path(doc.file_path).as_posix())
        assert blob and blob.ciphertext.startswith(b"OBENC1:")
        assert text not in blob.ciphertext
        path.unlink()
        assert read_file(path) == text
    opened = client.get(f"/api/documents/{doc_id}")
    assert opened.status_code == 200, opened.text
    assert client.get(opened.json()["file_url"]).status_code == 200
    login("rajesh")
    assert client.get(f"/api/documents/{doc_id}").status_code == 403


def test_standard_entrypoint_contains_all_features(client):
    assert client.get("/api/memory-up/context").status_code == 200
    assert client.get("/memory-up").status_code == 200
    schema = client.get("/openapi.json").json()
    assert "/api/memory-up/{note_id}/publish" in schema["paths"]


def test_medication_schedule_is_an_absolute_instant(client, monkeypatch):
    from datetime import datetime, timedelta
    from app.routers import care
    monkeypatch.setenv("HOSPITAL_TIME_ZONE", "Asia/Kolkata")
    monkeypatch.setattr(care, "hospital_now", lambda: datetime(2040, 1, 2, 8))
    response = client.get("/api/patients/OB-2026-0001/medications")
    assert response.status_code == 200
    assert response.json()
    for medicine in response.json():
        for dose in medicine["today"]:
            instant = datetime.fromisoformat(dose["scheduled_at"].replace("Z", "+00:00"))
            assert (instant + timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d %H:%M") == "2040-01-02 " + dose["time"]


def test_source_reference_lookup_never_crosses_cancer_site_or_stage():
    from app.services.knowledge_base import ClinicalReferenceRetriever
    lookup = ClinicalReferenceRetriever()
    assert lookup.query_guideline_with_provenance("therapy", "breast", "II")
    assert not lookup.query_guideline_with_provenance("breast therapy", "colon", "II")
    assert not lookup.query_guideline_with_provenance("breast therapy", "breast", "unknown")
