# Build self-hosted API documentation without bundling any frontend app.
FROM node:24-slim AS docs
ENV SCARF_ANALYTICS=false
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/scripts/copy-swagger.mjs ./scripts/copy-swagger.mjs
RUN node scripts/copy-swagger.mjs

FROM python:3.13-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr fonts-dejavu-core tzdata \
 && rm -rf /var/lib/apt/lists/*
ENV TZ=Asia/Kolkata \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIST=/app/web \
    DATA_DIR=/app/backend/data
WORKDIR /app/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=docs /web/public/swagger /app/web/swagger
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
