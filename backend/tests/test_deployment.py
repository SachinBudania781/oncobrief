from sqlalchemy import func, select
import pytest


def test_health_reports_database(client):
    from app.db import engine
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["database"] == engine.dialect.name


def test_health_accepts_unauthenticated_monitor_head_requests(server):
    server.cookies.clear()
    response = server.head("/api/health")
    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_health_reports_database_failure_for_both_methods(server, monkeypatch, method):
    from app.db import engine
    from sqlalchemy.exc import SQLAlchemyError

    def unavailable():
        raise SQLAlchemyError("private database connection details")

    monkeypatch.setattr(engine, "connect", unavailable)
    response = server.request(method, "/api/health")
    assert response.status_code == 503
    assert b"private database connection details" not in response.content
    if method == "HEAD":
        assert response.content == b""
    else:
        assert response.json()["detail"] == "Database is unavailable"


def test_demo_restart_recovers_seed_files_without_resetting_records(client):
    from app.config import DATA_DIR
    from app.db import SessionLocal
    from app.models import Document
    from app.security import read_file
    from seed.loader import ensure_seeded

    # This file is a fabricated fixture in the test's isolated DATA_DIR.
    with SessionLocal() as db:
        document = db.get(Document, 1)
        path = (DATA_DIR / document.file_path).resolve()
        assert path.is_relative_to(DATA_DIR.resolve())
        original = read_file(path)
        count = db.scalar(select(func.count(Document.id)))
    path.unlink()
    ensure_seeded()
    assert path.read_bytes().startswith(b"OBENC1:")
    restored = read_file(path)
    assert restored[:5] == original[:5]  # PDF or image signature retained.
    with SessionLocal() as db:
        assert db.scalar(select(func.count(Document.id))) == count
        assert db.get(Document, 1).file_path == document.file_path
