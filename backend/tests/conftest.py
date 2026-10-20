import os
import tempfile
from pathlib import Path
import pytest

# Keep test data out of the real patient database and leave fixtures reproducible.
root = Path(__file__).resolve().parents[2] / ".test-data"
root.mkdir(exist_ok=True)
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="pytest-", dir=root)
os.environ["DEMO_MODE"] = "true"
os.environ["LLM_PROVIDER"] = "none"


@pytest.fixture(scope="session")
def server():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture
def client(server):
    from app.main import _rates
    _rates.clear()
    server.cookies.clear()
    r = server.post("/api/auth/login", json={"username": "doctor", "password": "OncoDemo!2026"})
    assert r.status_code == 200, r.text
    yield server


@pytest.fixture
def login(client):
    def sign_in(username):
        from app.main import _rates
        _rates.clear()
        client.cookies.clear()
        r = client.post("/api/auth/login", json={"username": username, "password": "OncoDemo!2026"})
        assert r.status_code == 200, r.text
        return r.json()
    return sign_in
