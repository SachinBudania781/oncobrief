"""Assistant actions stay two-step, permission-checked and role-limited."""
from datetime import timedelta

from app.timeutil import hospital_now


def _future_slot():
    day = hospital_now() + timedelta(days=3)
    while day.weekday() == 6:
        day += timedelta(days=1)
    return day.replace(hour=15, minute=40, second=0, microsecond=0).isoformat()


def test_plan_has_no_side_effects_and_parses_booking(client):
    before = len(client.get("/api/appointments?upcoming=true&patient_id=OB-2026-0002").json())
    plan = client.post("/api/v2/assistant/plan", json={"text": "Book Rajesh in radiology tomorrow at 11am", "patient_id": "OB-2026-0001"}).json()
    assert plan["intent"] == "book_visit"
    assert plan["patient_id"] == "OB-2026-0002"
    assert plan["params"]["department"] == "Radiology"
    assert plan["params"]["start"].endswith("T11:00:00")
    assert len(client.get("/api/appointments?upcoming=true&patient_id=OB-2026-0002").json()) == before


def test_plan_recognises_message_and_task(client):
    msg = client.post("/api/v2/assistant/plan", json={"text": "Remind Meera to drink 3 litres of water", "patient_id": "OB-2026-0001"}).json()
    assert msg["intent"] == "notify_patient" and "water" in msg["params"]["message"].lower()
    task = client.post("/api/v2/assistant/plan", json={"text": "Ask the nurse to call Meera about her fever", "patient_id": "OB-2026-0001"}).json()
    assert task["intent"] == "care_task"
    other = client.post("/api/v2/assistant/plan", json={"text": "hello there", "patient_id": "OB-2026-0001"}).json()
    assert other["intent"] is None


def test_execute_books_in_person_visit(client):
    out = client.post("/api/v2/assistant/execute", json={"intent": "book_visit", "patient_id": "OB-2026-0003",
                                                          "params": {"mode": "in_person", "department": "Medical Oncology OPD", "start": _future_slot()}})
    assert out.status_code == 200, out.text
    assert out.json()["appointment"]["patient_id"] == "OB-2026-0003"


def test_execute_message_reaches_patient(client, login):
    out = client.post("/api/v2/assistant/execute", json={"intent": "notify_patient", "patient_id": "OB-2026-0001", "params": {"message": "Please bring your echo report"}})
    assert out.status_code == 200, out.text
    login("meera")
    notes = client.get("/api/v2/notifications").json()
    assert any("echo report" in n["body"] for n in notes)


def test_patients_cannot_use_assistant_actions(client, login):
    login("meera")
    assert client.post("/api/v2/assistant/plan", json={"text": "book tomorrow 4pm", "patient_id": "OB-2026-0001"}).status_code == 403
    assert client.post("/api/v2/assistant/execute", json={"intent": "care_task", "patient_id": "OB-2026-0001", "params": {"task": "x"}}).status_code == 403


def test_patient_sos_creates_emergency_alert(client, login):
    login("meera")
    out = client.post("/api/v2/patients/OB-2026-0001/sos", json={"note": "Feeling faint"})
    assert out.status_code == 200, out.text
    login("doctor")
    assert client.post("/api/v2/patients/OB-2026-0001/sos", json={}).status_code == 403


def test_reminders_are_staff_only(client, login):
    assert client.post("/api/v2/schedule/remind", json={}).status_code == 403  # doctor
    login("frontdesk")
    out = client.post("/api/v2/schedule/remind", json={})
    assert out.status_code == 200, out.text
    assert "patients" in out.json()


CONSULT = ("Doctor: How have you been since cycle 4?\nPatient: Nausea for three days and tingling in my fingers.\n"
           "Doctor: Temperature 37.2, haemoglobin 10.1.\nDoctor: The tingling is likely mild neuropathy.\n"
           "Doctor: Plan: continue ondansetron, repeat CBC and review in 1 week by video.")


def test_consult_note_draft_requires_consent_and_doctor(client, login):
    assert client.post("/api/v2/patients/OB-2026-0001/consult-note", json={"transcript": CONSULT, "consent": False}).status_code == 422
    note = client.post("/api/v2/patients/OB-2026-0001/consult-note", json={"transcript": CONSULT, "consent": True}).json()
    assert "ondansetron" in note["plan"].lower()
    assert "neuropathy" in note["assessment"].lower()
    assert note["follow_up_days"] == 7 and note["follow_up_mode"] == "google_meet"
    assert "?" not in note["plan"]
    login("nurse")
    assert client.post("/api/v2/patients/OB-2026-0001/consult-note", json={"transcript": CONSULT, "consent": True}).status_code == 403


def test_signed_consult_reaches_patient(client, login):
    out = client.post("/api/v2/patients/OB-2026-0001/consult-note/sign", json={"transcript": CONSULT, "plan": "Repeat CBC", "patient_summary": "We will repeat your blood test next week."})
    assert out.status_code == 200, out.text
    records = client.get("/api/v2/patients/OB-2026-0001/records?kind=scribe").json()
    assert any(r["id"] == out.json()["record_id"] and r["status"] == "approved" for r in records)
    login("meera")
    assert any("blood test next week" in n["body"] for n in client.get("/api/v2/notifications").json())
