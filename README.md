# OncoBrief

Connected cancer-care workspaces for patients, doctors and hospital staff.

- [Patient app](https://oncobrief-round2-patient.onrender.com)
- [Doctor app](https://oncobrief-round2-doctor.onrender.com)
- [Staff app](https://oncobrief-round2-staff.onrender.com)

The release combines record search and explanations, role-specific AI chat, symptom check-ins, signed medication requests, caregiver consent, scheduling, appointment advice, transport coordination and wearable trends. The API enforces patient relationships and role permissions.

## Run locally

Use Python 3.13 and Node 24. Install `backend/requirements.txt` and copy `.env.example` to `backend/.env`. Start `uvicorn app.main:app --port 8000` from `backend`. In `frontend`, run `npm ci` followed by `npm run dev`. Open the frontend address printed by Vite.

`DEMO_MODE=true` creates fabricated patients. The sign-in information dialog contains the sample IDs and password. Use a separate database and real authentication configuration before using real patient data.

## Verify a release

Run `pytest -q` in `backend`. In `frontend`, run `npm test`, `npm run test:components`, `npm run test:e2e`, and `npm run build:apps`. Install Playwright Chromium once with `npx playwright install chromium`. CI runs the API suite on SQLite and PostgreSQL, browser journeys, builds, and dependency audits.

The standard entry point includes all application features. Older `app.pantheon_app` and `app.memory_up_app` commands remain compatibility aliases.

## Deploy and configure

`render.yaml` defines the intended five resources. Existing Render services preserve their URLs and secrets; do not create a second Blueprint over existing resources without reviewing its plan. See [release notes](docs/RELEASE.md) and [API setup](docs/API_SETUP.md). Historical contributor notes describe earlier branch states and are not release instructions.

Uploaded documents and appointment attachments are encrypted and saved in PostgreSQL with their records. Local files act as a cache. Back up the database and retain its encryption/signing keys together. Free hosting still has sleep and database lifetime limits.
