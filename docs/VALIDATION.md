# Local validation — 18 October 2026

The implementation and checks below were completed locally. No commit, GitHub push or Render deployment was made.

| Check | Result |
| --- | --- |
| Backend regression suite | 145 passed, 1 skipped; 0 failures and 0 errors |
| Frontend production build | Passed with Vite 7.3.7 |
| npm dependency audit | 0 known vulnerabilities |
| Full Python requirements audit | No known vulnerabilities found |
| Git whitespace check | Passed |
| Browser smoke checks | Doctor dashboard, journey, scribe, patient check-in, nurse triage and self-hosted API documentation opened successfully |
| Connected browser flow | Patient fever report → urgent-help panel → nurse queue → recorded acknowledgement |
| PDF export | A 15-page case pack rendered successfully; page contact sheet, Hindi text and imaging source pages checked visually |

The skipped test needs a real Tesseract executable for scan OCR. Text/PDF extraction, identity guards, bulk filing and scanner parsing rules are covered separately. The Dockerfile and CI install Tesseract, but Docker was unavailable on this Windows machine, so the container image and live scan OCR were not validated here. The test run produced one upstream Starlette test-client deprecation warning.

The regression suite checks patient and role isolation, consent revocation, account-ID ownership, treating-doctor signatures, concurrent approval deduplication, password/OTP/TOTP paths, expiring document/share access, encryption, watermarks, audit-chain integrity, workflow validation, reminders, schedule conflicts/packing, telephone callback replay protection, and grounded answers. The 100-question companion set is an engineering regression set; its fixture explicitly records that clinician review is pending.

The browser flow used fabricated patients in a separate temporary demo database. No real patient data, SMS, WhatsApp message, ordinary phone call or ER notification was sent. External gateway responses are covered with test substitutes; no live-provider result is implied.

## Work that needs your inputs

See [the service checklist](INTEGRATIONS.md) and [environment placeholders](../.env.example) for the required URLs, keys, hospital details and verified data. An adapter is a service implementing the documented JSON contract; entering a raw vendor key is not enough. Unconfigured services report their missing setup in the app.

Before real patient use, complete clinician review of rules, protocols, translations, food guidance and the question set; connect and verify the required providers; and configure persistent storage, stable encryption secrets, backups, staff TOTP and India-region hosting. Free sleeping Render services cannot guarantee timely reminders or emergency delivery. The present scheduler, audit locking and schedule serialization support a single instance with one worker.

The local results establish the tested behavior above. They do not certify clinical accuracy, legal compliance, uptime or the absence of every possible defect.
