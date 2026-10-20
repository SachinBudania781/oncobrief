"""Check deployed app routing, secure sign-in, and PWA assets using demo accounts."""
import argparse
import json
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from configure_frontends import https_origin


def check_app(origin, target, username):
    cookies = CookieJar()
    client = build_opener(HTTPCookieProcessor(cookies))

    def fetch(path, body=None):
        request = Request(origin + path, data=json.dumps(body).encode() if body is not None else None,
                          headers={"Origin": origin, **({"Content-Type": "application/json"} if body is not None else {})})
        with client.open(request, timeout=180) as response:
            return response.read(), response.headers

    page, _ = fetch("/")
    assert f"OncoBrief {target.title()}".encode() in page, "Wrong frontend build"
    manifest, manifest_headers = fetch("/manifest.webmanifest")
    assert "json" in manifest_headers.get("Content-Type", ""), "Phone manifest must have a JSON content type"
    manifest = json.loads(manifest)
    assert manifest["name"] == f"OncoBrief {target.title()}", "Wrong phone app manifest"
    assert manifest["display"] == "standalone"
    for icon in manifest["icons"]:
        content, headers = fetch(icon["src"])
        assert content.startswith(b"\x89PNG\r\n\x1a\n"), "App icon missing"
    worker, _ = fetch("/sw.js")
    assert b"self.addEventListener" in worker, "Service worker missing"
    health, headers = fetch("/api/health")
    health = json.loads(health)
    assert health["status"] == "ok", "API proxy is not returning JSON"
    assert health["database"] == "postgresql", "Backend is not using the separate PostgreSQL database"
    assert "no-store" in headers.get("Cache-Control", ""), "API caching must be disabled"
    config, _ = fetch("/api/auth/config")
    config = json.loads(config)
    assert config["demo"], "This check signs in only to fabricated-data development environments"
    user, _ = fetch("/api/auth/login", {"username": username, "password": config["demo_password"]})
    assert json.loads(user)["username"] == username, "POST did not reach API"
    session_cookie = next((cookie for cookie in cookies if cookie.name == "ob_session"), None)
    assert session_cookie and session_cookie.secure, "Secure session cookie missing"
    current, _ = fetch("/api/auth/me")
    assert json.loads(current)["username"] == username, "Proxy did not preserve session"
    patients, _ = fetch("/api/patients")
    patients = json.loads(patients)
    assert isinstance(patients, list) and patients, "Authenticated data unavailable"
    if target in {"patient", "doctor"}:
        documents, _ = fetch(f"/api/patients/{patients[0]['id']}/documents")
        documents = json.loads(documents)
        assert documents, "Seeded reports are unavailable"
        document, _ = fetch(f"/api/documents/{documents[0]['id']}")
        document = json.loads(document)
        file, headers = fetch(document["file_url"])
        assert file and "text/html" not in headers.get("Content-Type", ""), "Report download was replaced by the app shell"
        assert "no-store" in headers.get("Cache-Control", ""), "Report downloads must not be cached"
    fetch("/api/auth/logout", {})
    print(f"PASS {target}: app, phone manifest/icons, PostgreSQL, API GET/POST, secure session, records, logout")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--patient", required=True, type=https_origin)
    parser.add_argument("--doctor", required=True, type=https_origin)
    parser.add_argument("--staff", required=True, type=https_origin)
    args = parser.parse_args()
    try:
        for target, username in (("patient", "meera"), ("doctor", "doctor"), ("staff", "frontdesk")):
            check_app(getattr(args, target), target, username)
    except (AssertionError, HTTPError) as exc:
        raise SystemExit(f"Deployment verification failed: {exc}")
