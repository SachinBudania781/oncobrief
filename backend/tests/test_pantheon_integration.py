"""Cross-feature journeys through the real combined app and session middleware."""
from datetime import timedelta
from pathlib import Path

from app.pantheon_app import app as integrated_app  # register combined adapters before startup
from app.timeutil import hospital_now, utcnow

P = "OB-2026-0001"


def test_booking_schedule_transport_memory_up_and_record_chat(client, login, monkeypatch):
    from app.routers import round2

    # Provider calls are deliberately stubbed; this test never sends real messages.
    monkeypatch.setattr(round2, "deliver", lambda *args, **kwargs: {"id": "integration-stub"})
    day = (hospital_now() + timedelta(days=181)).date().isoformat()
    login("meera")
    slots = client.get("/api/slots", params={"patient_id": P, "department": "Medical Oncology OPD", "day": day})
    assert slots.status_code == 200, slots.text
    time = slots.json()[0]
    booked = client.post("/api/appointments", json={"patient_id": P, "department": "Medical Oncology OPD",
                                                   "start": f"{day}T{time}"})
    assert booked.status_code == 200, booked.text
    appointment = booked.json()
    remaining = client.get("/api/slots", params={"patient_id": P, "department": "Medical Oncology OPD", "day": day}).json()
    assert time not in remaining
    from datetime import datetime
    pickup = datetime.fromisoformat(appointment["start"]) - timedelta(minutes=40)
    transport = client.post(f"/api/v2/patients/{P}/transport-requests", json={
        "appointment_id": appointment["id"], "pickup_at": pickup.isoformat(),
        "pickup_address": "Synthetic pickup address", "ride_type": "caregiver", "consent": True,
    })
    assert transport.status_code == 200, transport.text
    transport_id = transport.json()["id"]
    login("frontdesk")
    assert any(r["id"] == transport_id for r in client.get("/api/v2/transport-requests").json())
    arranged = client.patch(f"/api/v2/transport-requests/{transport_id}", json={
        "status": "arranged", "arranged_via": "Synthetic caregiver arrangement",
        "confirmed_pickup_at": pickup.isoformat(),
    })
    assert arranged.status_code == 200, arranged.text
    login("doctor")
    schedule = client.get("/api/schedule", params={"day": day, "department": "Medical Oncology OPD"})
    assert any(a["id"] == appointment["id"] for a in schedule.json()["appointments"])
    note = client.post(f"/api/memory-up/patients/{P}", data={
        "appointment_id": appointment["id"], "title": "Integration visit instructions",
        "advice": "Bring the zephyrfolder with previous reports to the next visit.", "identity_confirmed": "true",
    })
    assert note.status_code == 200, note.text
    published = client.post(f"/api/memory-up/{note.json()['id']}/publish")
    assert published.status_code == 200, published.text
    document_id = published.json()["document_id"]
    assert document_id
    login("meera")
    docs = client.get(f"/api/patients/{P}/documents", params={"q": "zephyrfolder"})
    assert any(d["id"] == document_id for d in docs.json())
    detail = client.get(f"/api/documents/{document_id}")
    assert detail.status_code == 200
    assert "zephyrfolder" in client.get(detail.json()["file_url"]).text
    chat = client.post(f"/api/v2/patients/{P}/companion", json={"text": "What do my records say about zephyrfolder?"})
    assert chat.status_code == 200, chat.text
    assert any(s.get("id") == document_id for s in chat.json()["sources"])
    assert any(t["id"] == transport_id and t["status"] == "arranged"
               for t in client.get(f"/api/v2/patients/{P}/transport-requests").json())
    login("caregiver")
    assert any(n["id"] == note.json()["id"] for n in client.get(f"/api/memory-up/patients/{P}").json())
    assert client.get(f"/api/documents/{document_id}").status_code == 200
    login("rajesh")
    assert client.get(f"/api/documents/{document_id}").status_code == 403
    assert client.get(f"/api/memory-up/patients/{P}").status_code == 403
    assert client.get(f"/api/v2/patients/{P}/transport-requests").status_code == 403


def test_device_upload_signed_protocol_caregiver_alert_and_revocation(client, login):
    protocol = client.post(f"/api/v2/patients/{P}/vital-alert-protocol", json={
        "thresholds": {"heart_rate": 60}, "source_url": "https://example.invalid/signed-protocol",
        "rationale": "Synthetic protocol for integration testing only.",
    })
    assert protocol.status_code == 200, protocol.text
    login("meera")
    linked = client.post(f"/api/v2/patients/{P}/wearable-devices", json={"consent": True, "device_name": "Synthetic integration sensor"})
    assert linked.status_code == 200, linked.text
    credential = linked.json()
    now = utcnow()
    batch = {"consent": True, "source": "android_ble", "device_name": "Synthetic integration sensor",
             "readings": [{"metric": "heart_rate", "value": 50, "unit": "bpm",
                           "observed_at": (now - timedelta(seconds=seconds)).isoformat() + "Z"}
                          for seconds in [30, 10]]}
    client.cookies.clear()
    upload = client.post(f"/api/v2/patients/{P}/wearables", json=batch,
                         headers={"Authorization": "Bearer " + credential["token"]})
    assert upload.status_code == 200, upload.text
    login("caregiver")
    assert any(n["channel"] == "vitals" for n in client.get("/api/v2/notifications").json())
    assert client.get(f"/api/v2/patients/{P}/wearables").json()["vital_thresholds"]["heart_rate"] == 60
    login("meera")
    assert not any(n["channel"] == "vitals" for n in client.get("/api/v2/notifications").json())
    assert "vital_thresholds" not in client.get(f"/api/v2/patients/{P}/wearables").json()
    assert client.delete(f"/api/v2/patients/{P}/wearable-devices/{credential['id']}").status_code == 200
    client.cookies.clear()
    assert client.post(f"/api/v2/patients/{P}/wearables", json=batch,
                       headers={"Authorization": "Bearer " + credential["token"]}).status_code == 401


def test_integrated_dependency_pin_preserves_original_manifest():
    backend = Path(__file__).resolve().parents[1]
    def pins(name):
        return {line.split("==", 1)[0]: line.split("==", 1)[1] for line in (backend / name).read_text().splitlines()
                if line and not line.startswith("#")}
    original = pins("requirements.txt")
    integrated = pins("requirements-pantheon-integrated.txt")
    assert original["pypdf"] == "6.21.4"
    assert integrated["pypdf"] == "6.21.4"
    assert "chromadb" not in original
    assert integrated["chromadb"] == "1.0.20"
    assert {key: value for key, value in original.items() if key != "pypdf"} == {
        key: value for key, value in integrated.items() if key not in {"pypdf", "chromadb"}}


def test_slot_adapter_still_requires_session_patient_and_consent(client, login):
    day = (hospital_now() + timedelta(days=181)).date().isoformat()
    params = {"department": "Medical Oncology OPD", "day": day, "patient_id": P}
    client.cookies.clear()
    assert client.get("/api/slots", params=params).status_code == 401
    login("rajesh")
    assert client.get("/api/slots", params=params).status_code == 403
    login("meera")
    assert client.get("/api/slots", params={"department": "Medical Oncology OPD", "day": day}).status_code == 422
    login("privacy")
    assert client.get("/api/slots", params=params).status_code == 403


def test_virtual_appointment_schedule_and_shared_meet_link(client, login, monkeypatch):
    from app.services import google_meet

    monkeypatch.setattr(google_meet, "configured", lambda: False)
    day = (hospital_now() + timedelta(days=182)).date().isoformat()
    login("meera")
    time = client.get("/api/slots", params={"department": "Medical Oncology OPD", "day": day, "patient_id": P}).json()[0]
    booked = client.post("/api/appointments", json={
        "patient_id": P, "department": "Medical Oncology OPD", "start": f"{day}T{time}",
        "visit_mode": "google_meet", "clinician_type": "oncologist", "include_caregiver": True,
        "patient_email": "patient@example.invalid", "caregiver_email": "caregiver@example.invalid",
        "clinician_email": "doctor@example.invalid", "invitation_consent": True,
    })
    assert booked.status_code == 200, booked.text
    assert booked.json()["virtual_visit"]["status"] == "needs_setup"
    aid = booked.json()["id"]
    login("doctor")
    result = client.patch(f"/api/v2/appointments/{aid}/virtual-visit/link",
                          json={"meeting_url": "https://meet.google.com/abc-defg-hij", "clinician_type": "oncologist"})
    assert result.status_code == 200, result.text
    login("caregiver")
    visits = client.get("/api/appointments", params={"patient_id": P, "day": day}).json()
    visit = next(v for v in visits if v["id"] == aid)
    assert visit["virtual_visit"]["meeting_url"] == "https://meet.google.com/abc-defg-hij"
    assert visit["virtual_visit"]["caregiver_included"] is True
    assert any(n["channel"] == "appointment" for n in client.get("/api/v2/notifications").json())
    login("rajesh")
    assert client.get("/api/appointments", params={"patient_id": P, "day": day}).status_code == 403


def test_patient_chat_consent_controls_doctor_summary(client, login):
    login("meera")
    assert client.put(f"/api/v2/patients/{P}/companion-sharing", json={"enabled": False}).status_code == 200
    client.post(f"/api/v2/patients/{P}/companion", json={"text": "My private amberfolder needs organizing."})
    login("doctor")
    private = client.post(f"/api/v2/patients/{P}/companion", json={"text": "What has the patient discussed in chat?"})
    assert private.status_code == 200
    assert "amberfolder" not in private.json()["answer"]
    login("meera")
    assert client.put(f"/api/v2/patients/{P}/companion-sharing", json={"enabled": True}).status_code == 200
    message = client.post(f"/api/v2/patients/{P}/companion", json={"text": "My shared violetgarden folder needs organizing."})
    assert message.status_code == 200
    login("doctor")
    shared = client.post(f"/api/v2/patients/{P}/companion", json={"text": "What has the patient discussed in chat?"})
    assert shared.status_code == 200
    assert "violetgarden" in shared.json()["answer"]
    assert "amberfolder" not in shared.json()["answer"]
    login("meera")
    assert client.put(f"/api/v2/patients/{P}/companion-sharing", json={"enabled": False}).status_code == 200


def test_taken_medicine_status_reaches_reminder_feed(client, login):
    login("meera")
    medicines = client.get(f"/api/patients/{P}/medications").json()
    medicine = next(m for m in medicines if m["today"])
    dose = medicine["today"][0]
    result = client.post("/api/med-logs", json={"medication_id": medicine["id"], "time": dose["time"], "status": "taken"})
    assert result.status_code == 200, result.text
    updated = next(m for m in client.get(f"/api/patients/{P}/medications").json() if m["id"] == medicine["id"])
    assert next(d for d in updated["today"] if d["time"] == dose["time"])["status"] == "taken"
    login("rajesh")
    assert client.post("/api/med-logs", json={"medication_id": medicine["id"], "time": dose["time"], "status": "taken"}).status_code == 403
