# Memory Up

Branch: `feat/pantheon-memory-up`. Built in new files to respect the restriction
against changing Sachin-created files or branches.

## Run

From `backend/`, start the existing environment with:

```sh
uvicorn app.memory_up_app:app --host 127.0.0.1 --port 8000
```

Use a single worker, as documented for the existing appointment scheduler.
Sign in through the normal OncoBrief portal, then open `/memory-up` on the same
origin. This entry point composes Memory Up with the existing app and its normal
authentication, consent, encryption, audit middleware and startup. Existing files
and entry points are not edited. It creates the additive `pantheon_memory_up` table
at startup and keeps encrypted attachments under the normal persistent storage.

The existing deployment command `app.main:app` does not enable this extension. A
service running the new entry point must be deliberately configured before the
feature is live. Nothing in this branch deploys it.

## Workflow

- A staff member with patient document access and the matching department selects
  a patient and non-cancelled appointment.
- Type the doctor's actual advice, attach a PDF/text/image document, or do both.
  Confirm the patient and appointment identity before saving.
- A doctor from the same department reviews and publishes the draft.
- The patient and consented caregivers can read published notes across departments,
  filter by department, see appointment/doctor/reviewer details and download the
  original attachment. Drafts are not patient-visible.
- Other department staff cannot read or publish the draft. Existing patient consent
  controls still apply. Published advice is immutable; add a new note for corrections.

## Integration boundary

The feature has its own page, linked from the Pantheon-created doctor clinic and
staff upload-activity panels when the extension is enabled. The existing Documents screen, taxonomy, routes,
navigation and permission code were created by Sachin and remain untouched, so no
Memory Up button is inserted into that screen. A future authorized integration can
link `/memory-up` from Documents without changing this feature's storage or API.
Memory Up records currently live in the extension's table, not in the existing
document list or record-retrieval pipeline.

## Verify

```sh
cd backend
pytest -q tests/test_memory_up.py
```

The tests cover doctor review, draft hiding, patient and department isolation,
document-scope consent, encrypted attachments, invalid uploads, context filtering
and static asset allowlisting.

## Audit fixes

The follow-up audit adds checks for conflicting printed patient identity in uploaded
documents, rejects publication after an appointment's patient or department changes,
and atomically publishes a draft only once. It also preserves unsaved advice and its
attachment/appointment when refreshing or publishing another note, clears stale
history immediately on patient changes, and shows readable validation messages.

Eleven backend tests cover these cases. Optional browser regressions are in
`frontend/memory-up/tests/browser.cjs`. Run with Playwright available on Node's
module path and an installed browser. Set `MEMORY_UP_BROWSER_CHANNEL=chrome` to use
installed Chrome; otherwise the test uses Playwright Chromium. This test mocks the
API with synthetic data and verifies the browser's state transitions; the backend
tests separately verify actual access and storage rules. No production dependency
manifest is changed to install the optional test runner.
