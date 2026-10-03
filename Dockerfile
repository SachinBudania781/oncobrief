# ---- 1. build the React frontend (three apps in one SPA) ----
FROM node:20-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG VITE_REPO_URL=""
ARG VITE_VIDEO_URL=""
ENV VITE_REPO_URL=$VITE_REPO_URL VITE_VIDEO_URL=$VITE_VIDEO_URL
RUN npm run build

# ---- 2. Python backend: API + OCR + RAG brief, also serves the built frontend ----
FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr fonts-dejavu-core tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Kolkata \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIST=/app/frontend/dist \
    DATA_DIR=/app/backend/data
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/frontend/dist
EXPOSE 8000
# Render/Railway/HF set $PORT; default 8000 locally. One worker: the demo DB is SQLite.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
