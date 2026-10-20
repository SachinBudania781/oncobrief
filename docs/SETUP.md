# Setup and review checklist

The expanded app is published on `deploy/round2-independent`. See [the independent deployment guide](DEPLOYMENT.md) for the three hosted apps, backend, database, and phone installation. The original prototype remains on `main`.

## Run the expanded app

Python 3.12+ and Node 24 LTS are supported for development. Docker includes Tesseract and serves the built frontend from the API service.

```powershell
Set-Location "C:\Users\Sachin_Budania\Downloads\oncobrief-repo\oncobrief"
docker build -t oncobrief-round2 .
docker run --rm -p 8000:8000 -e DEMO_MODE=true -v oncobrief-demo:/app/backend/data oncobrief-round2
```

Open `http://localhost:8000/app`. The volume preserves demo records and the generated demo encryption key when the container stops. Keep the key with your backups; encrypted files cannot be recovered without it.

For development without Docker, in two terminals:

```powershell
# API
Set-Location "C:\Users\Sachin_Budania\Downloads\oncobrief-repo\oncobrief"
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt pytest
Copy-Item .env.example backend\.env
Set-Location backend
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

```powershell
# Frontend
Set-Location "C:\Users\Sachin_Budania\Downloads\oncobrief-repo\oncobrief\frontend"
npm ci
npm run dev
```

Set `TESSERACT_CMD` if the Windows OCR executable is not on PATH. The upstream [Tesseract Windows installation guidance](https://tesseract-ocr.github.io/tessdoc/Installation.html) links the supported binary distribution. No scanner hardware, phone-health connection or real LLM is implied by the demo fixtures.

For a local production-style build, run `npm run build` in `frontend`, restart the API and use `http://localhost:8000/app`. API documentation at `/docs` uses self-hosted Swagger files generated during the frontend build.

## Demo accounts

Password for every fabricated demo account: `OncoDemo!2026`.

| Username | Role |
| --- | --- |
| `doctor` | Dr. R. Menon, assigned clinician |
| `nurse` | Nurse Asha |
| `lab` | Lab technician; own uploads only |
| `frontdesk` | Registration and schedules |
| `navigator` | Travel, finance and rescue follow-up |
| `dietitian` | Nutrition and guidance review |
| `privacy` | Privacy rights requests and devices |
| `admin` | Account and relationship setup |
| `meera`, `rajesh` | Separate patient accounts |
| `caregiver` | Meera's consented family member |

Use separate browser profiles or sign out between roles. Tabs in the same browser profile share the same secure session cookie. These published credentials exist only with `DEMO_MODE=true`; production refuses to use a database stamped as a seeded public demo.

## Six connected demonstrations

1. Sign in as Meera. Submit a fever check-in in English, Hindi or Marathi. Sign in as nurse and open triage; record acknowledgement, call, ER arrival and outcome. The doctor's brief includes the alert. No actual ER call is claimed unless the configured service accepts it.
2. Submit a medicine request as Meera. The doctor opens **Doctor approvals**, specifies and checks the order, enters rationale and signs. Meera sees approval and reminder times. Repeated approval is refused.
3. Upload a text/PDF report carrying Rajesh's printed ID while Meera is selected. The wrong-patient guard refuses it. Unreadable printed identity needs a manual verification reason; a detected mismatch cannot be bypassed by that checkbox.
4. Invite a caregiver with appointments only. Their account can see the day pass but cannot open reports or medicines. Withdraw the invitation; access stops on the next request.
5. Open a sourced report as the doctor. It carries the viewer's watermark. Tap a lab value to highlight its OCR position where available. Meera can then see the access entry and verify the hash chain.
6. Preview a packed schedule or a clash fix as staff. Review and approve the concrete changes. The patient day pass reflects the updated times.

## What you must fill in

Read `.env.example` and `INTEGRATIONS.md`. The latter lists every URL/key pair and its service contract. Raw vendor keys alone do not implement a gateway. Leave optional services empty until you have a provider; the app reports an explicit setup error instead of pretending a call, translation, match or message happened.

Also supply hospital contact/address and room directions, verified clinical protocols, doctor/dietitian library approval, actual registry and price feeds, a trained survivor directory and clinician review of the evaluation questions. The **Connected services** screen exposes these missing settings. Staff accounts and assigned relationships can be created by the administrator there.

## Render and persistence

The existing `render.yaml` remains a free fabricated-data demonstration. It enables secure cookies and uses Render's service URL for same-origin checks and QR links. No Render service has been created or changed as part of this work.

Free Render filesystems do not preserve changes across redeploys/restarts. A paid persistent disk or external persistent storage is required for saved records. This is a hosting limitation, separate from the app's removal of the old automatic midnight reset. See [Render persistent disks](https://render.com/docs/disks) and [free service limits](https://render.com/docs/free).

For persistent hosting, mount a volume at the configured `DATA_DIR`, keep `DATA_ENCRYPTION_KEY` stable, and back up both database and encrypted storage. `DATABASE_URL` accepts Postgres with the psycopg driver; document files still need persistent storage. Use one service instance and one worker with this version: audit locking, reminder processing and schedule serialization are designed for that topology. Free sleeping services cannot guarantee minute-level reminders or emergency response.

Before real patient use, select an India-region deployment and encrypted database/backups, create a separate empty production database, set `DEMO_MODE=false` and `COOKIE_SECURE=true`, generate stable encryption/signing secrets and bootstrap-admin TOTP credentials, and complete clinical/security/retention review. A successful test run is not clinical certification or proof of legal compliance. Privacy requests are reviewed by the privacy officer rather than silently deleting clinical history.

## Checks

```powershell
# From backend
..\.venv\Scripts\python.exe -m pytest -q

# From frontend
npm run build
npm audit --audit-level=moderate

# From the repository root
.\.venv\Scripts\python.exe -m pip_audit -r backend\requirements.txt
git diff --check
```

Install `pip-audit` in your development environment if needed. Tests use separate temporary databases under `.test-data`; they do not reset the user's database. Live scan OCR is skipped when Tesseract is unavailable. The GitHub workflow installs Tesseract, then runs tests, frontend build and both dependency audits on future pushes.

## Push when you are ready

The verified remote is `https://github.com/SachinBudania781/oncobrief.git` and the current branch is `main`.

```powershell
Set-Location "C:\Users\Sachin_Budania\Downloads\oncobrief-repo\oncobrief"
git status
git add .
git commit -m "Implement OncoBrief Round 2 connected care workflows"
git push origin main
```

The plan document lives outside the Git repository and is not included by these commands. `.env`, generated data, test artifacts, the local Python environment and built frontend are ignored.
