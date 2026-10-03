"""OncoBrief — one backend for the Patient, Doctor and Staff apps."""
import asyncio
from contextlib import asynccontextmanager
from datetime import date

from starlette.concurrency import run_in_threadpool

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .config import FRONTEND_DIST, HOSPITAL_NAME
from .routers import brief, care, documents, patients


@asynccontextmanager
async def lifespan(app: FastAPI):
    from seed.loader import ensure_seeded
    ensure_seeded()
    yield


app = FastAPI(
    title="OncoBrief API",
    description="Central patient database + typed document uploads + on-demand RAG brief for oncologists. "
                "All patient data in this demo is fabricated.",
    version="0.1.0",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_seed_lock = asyncio.Lock()
_seeded_for = {"day": None}


@app.middleware("http")
async def fresh_demo_day(request, call_next):
    """If the server stays awake past midnight, re-seed so "today's clinic" is always today."""
    today = date.today()
    if _seeded_for["day"] != today:
        async with _seed_lock:
            if _seeded_for["day"] != today:
                from seed.loader import ensure_seeded
                await run_in_threadpool(ensure_seeded)
                _seeded_for["day"] = today
    return await call_next(request)

for r in (patients.router, documents.router, care.router, brief.router):
    app.include_router(r)


@app.get("/api/health")
def health():
    return {"status": "ok", "hospital": HOSPITAL_NAME}


@app.post("/api/admin/reset-demo")
def reset_demo():
    from seed.loader import ensure_seeded
    ensure_seeded(force=True)
    return {"status": "reset"}


# ---- serve the built React app (one deployable service) ----
if (FRONTEND_DIST / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404)
        f = FRONTEND_DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(FRONTEND_DIST / "index.html")
