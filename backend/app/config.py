"""Runtime configuration — everything comes from environment variables."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent          # backend/
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR / "data"))  # db + patient folders
STORAGE_DIR = DATA_DIR / "storage"                          # storage/<patient_id>/<category>/
SEED_DIR = BASE_DIR / "seed"
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))

DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DATA_DIR / 'oncobrief.db'}")

# LLM is optional. Without a key the brief is written by the deterministic engine.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "none").lower()   # gemini | anthropic | openai | none
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "")               # for OpenAI-compatible hosts (Groq, Together…)

HOSPITAL_NAME = os.getenv("HOSPITAL_NAME", "OncoBrief Demo Cancer Centre")

DATA_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
