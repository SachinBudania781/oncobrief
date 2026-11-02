# Verified Pantheon integration

New branch: `integration/pantheon-verified-2026-11-02`.

## One combined runtime

Use the new entry point to enable the existing patient/doctor/staff app, Memory Up
and the appointment compatibility adapter together:

```sh
pip install -r backend/requirements-pantheon-integrated.txt
cd backend
uvicorn app.pantheon_app:app --host 127.0.0.1 --port 8000 --workers 1
```

Build the normal frontend first with `npm ci && npm run build` in `frontend/`.
The independent container recipe is `deploy/pantheon-integrated.Dockerfile`:

```sh
docker build -f deploy/pantheon-integrated.Dockerfile -t oncobrief-pantheon .
```

This recipe includes the Memory Up static page and starts the combined entry point,
which the old service commands do not. Persistent data/storage, deployment secrets
and provider configuration are still required. No existing service is changed or
deployed by adding this recipe. Docker is unavailable in the local test environment;
the container image has not been built locally.

## What was combined

The starting commit is the latest Memory Up fix, `8e3c3c7`. Its ancestry already
contains the Pantheon branches for Android/wearables, transport, AI Chat, multi-role
portals, Google Meet, dose reminders, department schedules, earlier bug fixes,
both prior integration branches and the new Memory Up work.

One Pantheon branch head is intentionally not merged: `fix/integration-consistency-audit`
at `b4b1fc0`. Its later backend/day-pass/activity fixes edit Sachin-created
`backend/app/routers/round2.py`, `backend/app/services/jobs.py` and
`backend/tests/test_api.py`. The user explicitly forbids changing those files. Its
Wearables UI changes are already present in the newer allowed work. This is a
documented exclusion, not a merge that silently discards source changes.

`fix/seed-hospital-timezone` and `release/round2-into-main` belong to other
contributors and are outside this Pantheon consolidation. Existing branch refs,
PRs, main and deployment branches remain unchanged.

## Integration bugs addressed

- Patient free-slot selection was blocked by a legacy global staff-only guard,
  despite the underlying endpoint allowing patients. A narrow GET compatibility
  adapter routes the existing frontend call through an authenticated alias and
  preserves the original role, department and appointment-consent checks.
- Published Memory Up advice was isolated from ordinary reports and RAG. Publishing
  now creates a linked, encrypted document summary in the same transaction as
  publication. Drafts stay private, duplicate publishing is rejected, and a filing
  failure leaves the note unpublished. No existing document/retrieval source is edited.
- The old dependency manifest pins vulnerable pypdf 6.21.2. An independent Pantheon
  manifest pins 6.21.4; all other package pins match the original manifest. The new
  integration workflow audits this manifest. The untouched legacy CI audit can
  still fail on its original requirements file.

## Cross-feature verification

`backend/tests/test_pantheon_integration.py` uses actual app routes and session
middleware to verify:

1. Patient free-slot booking removes the occupied slot and appears in the department schedule.
2. That appointment supports a transport request, staff coordination and patient status updates.
3. Its Memory Up advice is doctor-published, available to patient/caregiver in Documents,
   searchable, downloadable and cited by record-aware chat; another patient is rejected.
4. Google Meet booking supports a manually supplied hospital link visible to authorized
   caregivers and emits an in-app appointment notification.
5. A signed wearable protocol plus patient device credential accepts simulated Android
   readings, notifies caregivers, hides review lines/alerts from patients and rejects
   uploads after credential revocation.
6. Patient chat is not shared before consent, exposes only messages after consent and
   can be switched off again.
7. A taken dose is reflected in the patient medicine/reminder feed; another patient cannot log it.
8. The slot adapter still rejects unauthenticated, wrong-patient and unauthorized-role requests.

Provider delivery is stubbed or kept unconfigured. This does not prove real SMS/email,
Google Calendar invitations, Android/watch hardware, continuous background sensing,
browser alarm audio, or production deployment. The custom LLM remains optional.

Run the complete backend suite, Node packet tests, optional Memory Up browser tests
and frontend/role builds. The `Pantheon integrated runtime` workflow additionally runs
the complete backend suite on PostgreSQL and audits the independent manifest.

## Remaining constraints

The historical dense-history cap, cancelled day-pass stops and hospital-local
low-activity day boundary still require changes to the excluded shared backend
files. The patient medicine-alarm clock and cross-origin PUT allowance also remain
in untouched shared files. The combined same-origin runtime works around the need
for cross-origin calls but does not change those source limitations. Do not claim
that every historical branch is merged, every bug is fixed, or the legacy audit is green.
