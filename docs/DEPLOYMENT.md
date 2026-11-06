# Deployment

The existing deployment has three static apps, one FastAPI Docker service and PostgreSQL in Singapore. `render.yaml` is the canonical configuration. The backend starts with `app.main:app`; it includes every integrated route, including Memory Up.

## Existing resources

- Patient: https://oncobrief-round2-patient.onrender.com
- Doctor: https://oncobrief-round2-doctor.onrender.com
- Staff: https://oncobrief-round2-staff.onrender.com
- API readiness/monitor: https://oncobrief-round2-api.onrender.com/api/health (GET and HEAD)

The existing Render services are linked to `deploy/round2-independent`. During this release, that deployment branch and `main` receive the same verified commit. Keep them aligned until the service branch settings are changed deliberately. The canonical Blueprint uses `main` for future infrastructure synchronization; this release does not create replacement services or change their URLs.

## Release procedure

1. Develop on an isolated branch. Run the complete CI checks, including PostgreSQL and browser journeys.
2. Preserve the current deployed commit and retain its keys. Never reset or replace the live database during an app release.
3. Fast-forward the release/deployment branches only after checks pass. Render rebuilds the API and each app independently.
4. Wait for `/api/health` to report the release commit and for each static app's `/release.json` to report the same commit and correct target.
5. Verify sign-in through each app's own origin, protected report access, appointment advice assets, and one controlled AI request. Avoid real outbound invitations or SMS during a smoke test.

The API image is `deploy/api.Dockerfile`. The static builds are `npm run build:patient`, `npm run build:doctor`, and `npm run build:staff` in `frontend`; outputs are `frontend/dist/<role>`. Same-origin `/api/*` rewrites forward requests to the shared API while retaining each app's session boundary.

## Data and provider configuration

Uploaded files are encrypted and stored with database records. Keep `DATA_ENCRYPTION_KEY`, `FILE_SIGNING_KEY` and `DATABASE_URL` stable. Free-host filesystem loss is supported; database expiry and loss of encryption keys are not recoverable without backups. Download database backups before the free database's expiry date in Render.

Preserve the existing Gemini settings. See [API setup](API_SETUP.md) for Calendar credentials and optional provider adapters. Source files under `deploy/legacy` and contributor audit documents are historical references, not the release deployment configuration. Do not apply them to this deployment.

For a new environment, validate `render.yaml` with the Render CLI and review its plan before applying it. Generate a valid Fernet encryption key for `DATA_ENCRYPTION_KEY`; arbitrary random text is not a Fernet key. Set all secrets in the deployment dashboard.
