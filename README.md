# OncoBrief · Round 2

Cancer care that stays connected between visits. One patient folder links the patient, consented caregivers, treating doctor, nurses and hospital teams. AI outputs can inform or draft; the treating clinician signs clinical changes.

Team **TripleT** · Health-a-thon 2026 · Cancer Care (NCG) track

## Start here

- [Run, demo accounts, deployment and push commands](docs/SETUP.md)
- [Separate apps, backend, database and phone installation](docs/DEPLOYMENT.md)
- [Feature-by-feature map for Parts A, B and C](docs/FEATURES.md)
- [Every API/service placeholder and integration contract](docs/INTEGRATIONS.md)
- [Local validation results and remaining inputs](docs/VALIDATION.md)
- [Environment template](.env.example)

The existing [deployed prototype](https://oncobrief.onrender.com) changes only after you push and redeploy. This repository contains the Round 2 implementation.

## Connected workflows

Patients check in by voice or taps in English, Hindi or Marathi, ask questions against their records, track doctor-approved medicine requests, plan a hospital day and invite caregivers with granular, revocable consent. The shared journal covers visit takeaways, priorities, pain/photo/meal tracking, diaries, survivorship, schemes and support requests. Daily-life guidance comes from an approved library. A streak garden, weekly summary and memory game support the routine.

Doctors and nurses have a ranked command centre, triage console, review queue, source-linked brief, consultation scribe, readiness and cumulative-dose checks, response charts, body map, report diffs, personal-baseline changes, smart inbox and tumour-board pack. Clinical drafts stay behind the treating-doctor gate. Sources and originals remain available for verification.

Staff can file typed reports, check printed patient identity, review and group whole-file imports, register patients, manage arrival/queues/chairs and preview schedule packing or clash fixes before applying them. Each staff member has an account and assigned patient relationships. Lab accounts can read only their own uploads.

## What runs without external services

Authentication, patient boundaries, consent, local OCR/PDF extraction, encrypted files, readable record summaries, extractive cited answers, check-ins, in-app alerts/chat/reminders, clinical drafts/approvals, scheduling, histories, report viewing/highlights, case-pack PDF, diary/nutrition/pain records and the games run locally. Live scan OCR needs Tesseract; Docker includes it. The ordinary-phone demonstration uses the browser and is labelled accordingly.

Ordinary phone calls, SMS/WhatsApp, dedicated speech/translation, live registry/prices, vision, wearables, telemedicine, cross-hospital evidence and ER pre-alerts need configured services. They show explicit setup states and never fabricate a delivery, translation, cohort result or match. See the integration table and contracts before supplying keys.

## Run

```bash
docker build -t oncobrief-round2 .
docker run --rm -p 8000:8000 -v oncobrief-demo:/app/backend/data oncobrief-round2
```

Open **http://localhost:8000/app**. In demo mode, open **Workspace information** to select a test ID; the published fabricated-data password is **OncoDemo!2026**. `/docs` hosts local API documentation after the frontend is built.

For development, install `backend/requirements.txt`, run `uvicorn app.main:app` from `backend`, and run `npm ci && npm run dev` from `frontend` with Node 24. The full Windows commands are in the setup guide.

## Data and safety boundaries

All seeded people, hospitals, reports, measurements and approval fixtures are fabricated. Production uses a separate database, secure cookies, password plus staff TOTP and clinician-reviewed content. Production refuses the public demo database. The old automatic midnight reset has been removed; data is not dropped just because the date changes.

Phone/ABHA fields and document files are encrypted. File links expire and are bound to the signed-in viewer; originals/pages are watermarked. Audit entries are hash-chained, with an optional independent anchor. Relationships, role restrictions and consent are checked on the server. A privacy-officer workflow handles access/correction/deletion requests; it does not silently destroy medical history.

The application cannot establish India residency, encrypted database volumes/backups, legal compliance, trained volunteers or emergency-response staffing by itself. Free Render filesystems are ephemeral and sleeping instances cannot guarantee minute-level jobs. Use persistent, appropriately located hosting and clinical/security review before real patient use.

The companion question fixture contains 100 engineering regression cases and explicitly marks clinician review as pending. Passing these checks is not evidence of clinical efficacy.

## Checks

```bash
cd backend
pytest -q
# Separate terminal, from frontend:
npm run build
npm audit --audit-level=moderate
# From repository root:
python -m pip_audit -r backend/requirements.txt
```

CI installs Tesseract, tests the API, builds the frontend and checks dependency advisories. Tests use isolated data directories. The live image OCR check is skipped locally if no Tesseract executable is available.

## Repository

- `backend/app/routers`: authentication, existing record APIs, connected care, document intelligence and schedule operations.
- `backend/app/services`: retrieval, OCR, guarded companion, clinical drafts, integrations, jobs and protected files.
- `backend/app/workflows.py`: shared validated workflow form definitions.
- `frontend/src/care`: role-aware care workspace, patient/team/clinical/hospital tools and responsive styles.
- `backend/tests`: API, authorization, consent, safety, export and 100-question regression checks.
- `backend/assets/fonts`: licensed embedded Latin/Devanagari font for shaped Hindi/Marathi PDFs.

## Team TripleT

| Member | Role |
| --- | --- |
| Shreyansh Tripathi | Team lead · IIT Bombay |
| Sachin Budania | Technical lead · IIT Bombay |
| Yogesh Sanjay Dudhgaonkar Patil | Engineer · IIIT Pune |
| Dr Venkatesh Darshan A N | Doctor partner · Medical Oncology, Tata Memorial Hospital |

MIT licence. Third-party font licensing is included with the embedded font.
