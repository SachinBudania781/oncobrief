# Independent combined runtime; does not replace any existing service or Dockerfile.
FROM node:24-slim AS web
ENV SCARF_ANALYTICS=false
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr fonts-dejavu-core tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Kolkata \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIST=/app/frontend/dist \
    DATA_DIR=/app/backend/data
WORKDIR /app/backend
COPY backend/requirements-pantheon-integrated.txt ./
RUN pip install --no-cache-dir -r requirements-pantheon-integrated.txt
COPY backend/ ./
COPY frontend/memory-up/ /app/frontend/memory-up/
COPY --from=web /web/dist /app/frontend/dist
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.pantheon_app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
