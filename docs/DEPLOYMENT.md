# Independent development deployments

Deploy six resources: the patient, doctor and staff websites, a role-selection hub, the FastAPI backend, and PostgreSQL. The hub lists all three roles and links to both the Round 2 workspace and the original Round 1 screen for each role. The individual role websites remain available. All four websites use the same backend and records, and can install on Android and iPhone as home-screen web apps.

The current live deployment remains on `deploy/round2-independent`. This feature branch adds the hub and restores links to the retained Round 1 screens in source; it does not update that live branch or its services.

| Resource | Address |
| --- | --- |
| Patient app | https://oncobrief-round2-patient.onrender.com |
| Doctor app | https://oncobrief-round2-doctor.onrender.com |
| Staff app | https://oncobrief-round2-staff.onrender.com |
| Role hub | Created as `oncobrief-round2-hub` when the updated frontend Blueprint is applied |
| Backend and API docs | https://oncobrief-round2-api.onrender.com/docs |
| PostgreSQL dashboard | https://dashboard.render.com/d/dpg-dbbmsqrbc2fs73bnhvb0-a |

Resource IDs are recorded in `deploy/resources.json`; it contains no passwords or connection strings. The database expires on **19 November 2026**.

## Free hosting limits

This setup uses fabricated demo records and published demo accounts. Render's free backend sleeps when idle, and waking it can take a minute. Free PostgreSQL expires 30 days after creation. Free backend storage is temporary: uploaded files disappear on restart or redeploy even while their database records remain. The generated encryption and file-signing secrets must stay unchanged in the backend environment.

Keep this environment for integration development and demos. For retained uploads, add persistent file storage. For a longer-lived free database, replace `DATABASE_URL` with a free external PostgreSQL service before the Render database expires. These are separate follow-up changes.

The backend recreates missing fabricated sample documents after a restart while keeping their database rows and original dates. It cannot recreate uploaded files. This recovery runs only in demo mode and only for the known sample records.

Current provider limits: [Render free services](https://render.com/docs/free), [static site routing](https://render.com/docs/redirects-rewrites), and [Blueprint configuration](https://render.com/docs/blueprint-spec).

## Backend and database

`deploy/render.api-free.yaml` describes a free Docker backend and a separate free PostgreSQL 16 database in Singapore. This is a development region, not an India-residency claim. The API-only image is `deploy/api.Dockerfile` and includes Tesseract plus self-hosted Swagger documentation.

Create these resources from the deployment branch using a Blueprint, or create equivalent resources in the dashboard. Reuse existing resources with the same names. Keep the database's external IP allowlist empty. Link the backend's `DATABASE_URL` to the database's internal connection string through Render. Set `DEMO_MODE=true`, `COOKIE_SECURE=true`, and `LLM_PROVIDER=none`. Generate stable `DATA_ENCRYPTION_KEY` (a Fernet key) and `FILE_SIGNING_KEY` in the hosting environment. The Blueprint generates both; never commit their values.

Run one backend instance and one Uvicorn worker. Verify the actual backend URL at `/api/health` and `/docs`.

## Role websites and hub

After Render assigns the backend's actual HTTPS URL, generate the frontend Blueprint:

```powershell
.\.venv\Scripts\python.exe scripts\configure_frontends.py --api-url https://YOUR-ACTUAL-API.onrender.com
```

This writes `deploy/render.frontends-free.yaml`. It contains three independently deployable static sites with these settings:

| Site | Build command, from repository root | Publish directory |
| --- | --- | --- |
| Patient | `cd frontend && npm ci && npm run build:patient` | `frontend/dist/patient` |
| Doctor | `cd frontend && npm ci && npm run build:doctor` | `frontend/dist/doctor` |
| Staff | `cd frontend && npm ci && npm run build:staff` | `frontend/dist/staff` |
| Hub | `cd frontend && npm ci && npm run build:hub` | `frontend/dist/hub` |

Use Node 24. Each site needs the generated rewrite rules, in order: `/api/*` to the backend's `/api/*`, `/docs` to backend `/docs`, `/openapi.json` to backend `/openapi.json`, then `/*` to `/index.html`. Swagger assets are included in each static build. Importing the generated Blueprint sets the rules and headers. If creating services with an API that cannot set routes, finish them in the dashboard before treating the deployment as usable.

The browser calls each website's own `/api` path. This preserves HTTP-only secure sessions and relative report/image/PDF URLs without depending on third-party cookies. Verify POST forwarding and cookie round-trips on the real provider before declaring completion.

Once all four actual frontend URLs are known, set backend `ALLOWED_ORIGINS` to those four HTTPS origins, separated by commas. Set `PUBLIC_BASE_URL` to the patient website's origin so QR and shared-card links open the patient frontend. Redeploy the backend after updating its environment.

App targeting chooses the starting screen, title, manifest, portal accent and sign-in methods. Patient, doctor and staff IDs are checked against the selected portal by the backend. Doctor/staff phone sign-in uses a password and retains production TOTP; phone OTP remains patient-only. Each frontend shares the care-workspace source, so fixes can reach all three without copying code.

Desktop uses a persistent navigation sidebar and tables; mobile uses a floating navigation dock, a feature sheet, report cards and tabbed document viewing. Motion respects the device's reduced-motion preference. Workspace provenance and feature guidance are available in information dialogs. Urgent clinical alerts remain visible in their workflows.

## Install on phones

On Android, open the desired site's HTTPS URL in Chrome and choose **Install app** or **Add to Home screen**. On iPhone, open it in Safari, choose **Share**, then **Add to Home Screen**. Repeat for any other role app you need. These are installable web apps; native store packages are not generated.

An internet connection is required. The service worker does not cache patient records, API responses, documents, or signed links. Device installation must be checked on a real Android/iPhone; a successful web build alone does not verify it. See [web app installation](https://web.dev/learn/pwa/installation).

## Verification and integration work

```powershell
# Build the three role apps locally.
cd frontend
npm run build:apps
cd ..
# The hub is an optional all-role build with the app selector at its homepage.
cd frontend
npm run build:hub
cd ..
# Use the three actual deployed URLs.
.\.venv\Scripts\python.exe scripts\check_deployment.py --patient https://PATIENT.onrender.com --doctor https://DOCTOR.onrender.com --staff https://STAFF.onrender.com
```

The smoke check verifies branding, phone manifests and icons, API GET/POST forwarding, secure session cookies, an authenticated patient list, and logout for the three role websites. It deliberately refuses non-demo environments. Confirm the hub opens, lists all three roles, and preserves the requested Round 1 URL through sign-in before publishing it.

Use backend `/docs` for API integration. Configure provider keys and adapter endpoints on the backend only; `docs/INTEGRATIONS.md` lists their contracts. Never put API secrets in frontend build variables.

For the existing live setup, keep using its current branch and service configuration. To preview the hub integration, create the new services from the feature branch and leave `deploy/round2-independent` unchanged. Render's current GitHub connection does not include this repository; public-repository deployments do not receive automatic push triggers. Check each service's deployed commit before handing out its URL.
