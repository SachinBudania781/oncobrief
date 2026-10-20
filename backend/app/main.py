"""OncoBrief: connected care, with server-enforced patient boundaries."""
import os
import asyncio
import re
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from .config import FRONTEND_DIST, HOSPITAL_NAME
from .db import Base, SessionLocal, engine
from . import round2_models
from .routers import auth, brief, care, documents, patients, round2, document_tools, operations
from .security import DEMO_MODE, append_audit, require_patient, roles, session_user


@asynccontextmanager
async def lifespan(app):
    from .seed_round2 import initialise
    if DEMO_MODE:
        from seed.loader import ensure_seeded
        ensure_seeded()
    Base.metadata.create_all(engine)
    initialise()
    async def reminders():
        from .services.jobs import tick
        while True:
            try:
                await asyncio.to_thread(tick)
            except Exception:
                import logging
                logging.getLogger(__name__).exception("Reminder job failed")
            await asyncio.sleep(60)
    task = asyncio.create_task(reminders())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="OncoBrief API", version="2.0.0", lifespan=lifespan, docs_url=None, redoc_url=None)
ORIGINS = [v.strip().rstrip("/") for v in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8000,http://127.0.0.1:8000").split(",") if v.strip()]
for configured_origin in (os.getenv("RENDER_EXTERNAL_URL"), os.getenv("PUBLIC_BASE_URL")):
    if configured_origin:
        ORIGINS.append(configured_origin.rstrip("/"))
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "Authorization"])
_rates = defaultdict(deque)
PUBLIC = {"/api/health", "/api/stats", "/api/taxonomy", "/api/ai-status", "/api/auth/config", "/api/auth/login", "/api/auth/otp", "/api/auth/verify-otp"}


@app.middleware("http")
async def boundaries(request: Request, call_next):
    path = request.url.path
    db = None
    try:
        if path.startswith("/api/"):
            if int(request.headers.get("content-length", "0")) > 25 * 1024 * 1024:
                raise HTTPException(413, "Maximum request size is 25 MB")
            if request.method not in {"GET", "HEAD", "OPTIONS"}:
                origin = request.headers.get("origin")
                host_origin = f"{request.url.scheme}://{request.url.netloc}"
                if origin and origin.rstrip("/") not in ORIGINS + [host_origin]:
                    raise HTTPException(403, "Cross-site request refused")
            key = (request.client.host if request.client else "local", "login" if path.startswith("/api/auth/") and request.method == "POST" else "api")
            queue = _rates[key]
            now = time.monotonic()
            while queue and queue[0] < now - 60:
                queue.popleft()
            if len(queue) >= (15 if key[1] == "login" else 300):
                raise HTTPException(429, "Too many requests. Please try again in a minute.")
            queue.append(now)
            if path not in PUBLIC and path != "/api/webhooks/telephony" and not path.startswith("/api/shared/") and request.method != "OPTIONS":
                db = SessionLocal()
                user = session_user(db, request)
                if not user:
                    raise HTTPException(401, "Please sign in")
                request.state.user = user
                pid = None
                match = re.search(r"/patients/([^/]+)", path)
                if match:
                    pid = match[1].strip().upper()
                if request.query_params.get("patient_id"):
                    pid = request.query_params["patient_id"]
                if request.method in {"POST", "PATCH"} and "application/json" in request.headers.get("content-type", ""):
                    try:
                        body = await request.json()
                    except ValueError:
                        raise HTTPException(422, "Invalid JSON")
                    if isinstance(body, dict) and body.get("patient_id"):
                        pid = body["patient_id"]
                if pid and path != "/api/v2/break-glass":
                    scope = "profile"
                    for word, value in [("medication", "medicines"), ("symptom", "checkin"), ("activity", "activity"),
                                        ("document", "documents"), ("brief", "documents"), ("labs", "documents"),
                                        ("appointment", "appointments"), ("audit", "audit")]:
                        if word in path:
                            scope = value
                    require_patient(db, user, pid, scope)
                if path == "/api/brief":
                    roles(user, "doctor", "admin")
                if path in {"/api/schedule", "/api/slots"}:
                    roles(user, "doctor", "nurse", "frontdesk", "admin")
                if path == "/api/patients" and request.method == "POST":
                    roles(user, "frontdesk", "admin")
                if path.startswith("/api/scanner/"):
                    roles(user, "lab", "nurse", "doctor", "admin")
                if path == "/api/admin/reset-demo":
                    roles(user, "admin")
                append_audit(db, user, f"{request.method} {path}", pid)
        response = await call_next(request)
    except HTTPException as exc:
        response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    finally:
        if db:
            db.close()
    response.headers.update({"X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN",
                             "Referrer-Policy": "no-referrer", "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self)",
                             "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'"})
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    if not DEMO_MODE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


for router in (auth.router, round2.router, document_tools.router, operations.router, patients.router, documents.router, care.router, brief.router):
    app.include_router(router)


@app.get("/api/health")
def health():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        raise HTTPException(503, "Database is unavailable")
    return {"status": "ok", "hospital": HOSPITAL_NAME, "version": "2.0.0", "demo": DEMO_MODE,
            "database": engine.dialect.name}


@app.get("/docs",include_in_schema=False,response_class=HTMLResponse)
def api_docs():
    return '<!doctype html><html><head><title>OncoBrief API</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/swagger/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/swagger/swagger-ui-bundle.js"></script><script src="/swagger/init.js"></script></body></html>'


@app.post("/api/admin/reset-demo")
def reset_demo():
    raise HTTPException(409, "Automatic reset is disabled. Back up data, then run python -m seed.loader manually in demo mode.")


if (FRONTEND_DIST / "swagger").is_dir():
    app.mount("/swagger", StaticFiles(directory=FRONTEND_DIST / "swagger"), name="swagger")


if (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404)
        file = (FRONTEND_DIST / full_path).resolve()
        if not file.is_relative_to(FRONTEND_DIST.resolve()):
            raise HTTPException(404)
        return FileResponse(file if full_path and file.is_file() else FRONTEND_DIST / "index.html")
