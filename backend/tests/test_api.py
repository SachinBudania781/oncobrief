"""End-to-end API checks on a freshly seeded demo database (run: cd backend && pytest -q)."""
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="oncobrief-test-")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)
client.__enter__()  # runs startup -> seeds the demo world


def test_health_and_seed():
    assert client.get("/api/health").json()["status"] == "ok"
    stats = client.get("/api/stats").json()
    assert stats["patients"] >= 5 and stats["documents"] > 40


def test_upload_requires_type_and_files_into_patient_folder():
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


def test_brief_cites_only_this_patients_documents():
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


def test_new_patient_brief_lists_missing_documents():
    b = client.post("/api/brief", json={"patient_id": "OB-2026-0003", "visit_type": "new"}).json()
    assert "Imaging: MRI" in b["content"]["missing_documents"]


def test_negated_imaging_is_not_flagged():
    b = client.post("/api/brief", json={"patient_id": "OB-2026-0005", "visit_type": "follow_up"}).json()
    assert not [a for a in b["content"]["alerts"] if a.get("kind") == "imaging"]


def test_schedule_detects_clashes():
    clashes = client.get("/api/schedule").json()["clashes"]
    kinds = {c["type"] for c in clashes}
    assert {"patient", "room"} <= kinds


def test_search_reads_ocr_text():
    hits = client.get("/api/patients/OB-2026-0002/documents", params={"q": "EGFR"}).json()
    assert any("EGFR" in (h.get("snippet") or "") for h in hits)
