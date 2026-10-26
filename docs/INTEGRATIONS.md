# Services and placeholders

The app runs with fabricated data and no API keys. Browser speech depends on browser support and microphone permission. Reports, check-ins, care chat, consent, review queues, reminders, scheduling and exports use the local backend.

Copy `.env.example` to `backend/.env` for local configuration, or enter the variables in your hosting dashboard. Never put secrets in `VITE_*` variables or commit `.env` files. The **Connected services** screen shows which pairs are missing.

## What you need to supply

| Feature | Settings / input | Without them |
| --- | --- | --- |
| Cited clinician briefs, Ask my records / Ask the chart, Explain report | `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, optionally `LLM_BASE_URL` | Deterministic briefs, extractive answers and local report explanations remain available |
| Patient phone OTP / SMS | `SMS_ADAPTER_URL`, `SMS_ADAPTER_KEY` | Demo sign-ins work; production OTP returns a setup error |
| WhatsApp reminders/check-ins | `WHATSAPP_ADAPTER_URL`, `WHATSAPP_ADAPTER_KEY` | In-app reminders work |
| Ordinary phone calls | `TELEPHONY_ADAPTER_URL`, `TELEPHONY_ADAPTER_KEY`, public HTTPS `PUBLIC_BASE_URL` | Browser call demo works; no ordinary phone rings |
| Bhashini / open speech service | `BHASHINI_ADAPTER_URL`, `BHASHINI_API_KEY` | Browser speech and typed input work |
| Live interpreter / translation | `TRANSLATION_ADAPTER_URL`, `TRANSLATION_API_KEY` | Original-language captions and editable transcript work; no fabricated translation |
| CTRI matching feed | `CTRI_ADAPTER_URL`, `CTRI_API_KEY` | Doctor can enter verified registry records for review and sign-off |
| Jan Aushadhi price/store feed | `JAN_AUSHADHI_ADAPTER_URL`, `JAN_AUSHADHI_API_KEY` | Doctor can record verified prices and substitution decisions |
| Full formulary interactions | `FORMULARY_ADAPTER_URL`, `FORMULARY_ADAPTER_KEY` | Limited screening rules plus signed patient-specific dose protocols |
| Cross-hospital evidence | `EVIDENCE_ADAPTER_URL`, `EVIDENCE_ADAPTER_KEY` | No invented cohort evidence; consented local cohorts require at least 10 matching real records |
| Photo severity / meal estimates | `VISION_ADAPTER_URL`, `VISION_API_KEY` | Photo history and manual clinician/dietitian entries work; AI output remains a review draft |
| AQI / weather | `ENVIRONMENT_ADAPTER_URL`, `ENVIRONMENT_API_KEY` | Approved seasonal advice works; no live AQI or forecast is invented |
| Wearables | Standard BLE GATT profiles can be read directly in supported secure browsers; `WEARABLE_ADAPTER_URL`, `WEARABLE_API_KEY` remain for vendor/hospital adapters | Patient-consented live capture supports standard heart-rate, blood-pressure, pulse-oximeter and thermometer services while the page stays open; steps/distance/sleep need manual entry or a vendor/phone-health feed. WHOOP history requires a separately registered OAuth app. |
| Video visits | `TELEMEDICINE_ADAPTER_URL`, `TELEMEDICINE_API_KEY` | Scheduling and care chat work |
| ER pre-alert | `ER_ALERT_ADAPTER_URL`, `ER_ALERT_ADAPTER_KEY` | Emergency instructions, nurse triage, share card and maps link work; ER delivery is not claimed |
| Navigation and care contact | `HOSPITAL_ADDRESS`, `HOSPITAL_EMERGENCY_PHONE`, `PUBLIC_BASE_URL` | No invented hospital address, phone or indoor route |
| Survivor buddies | `BUDDY_DIRECTORY_PATH`, trained volunteers and a navigator | Requests are recorded; matches are not fabricated |
| Live scan OCR on Windows | Install Tesseract, set `TESSERACT_CMD` if outside PATH | PDF text extraction works; unreadable images require manual identity verification. Docker includes Tesseract |

An **adapter URL is an HTTPS JSON service**, not a vendor's web page. Vendor keys alone do not implement an adapter. Connect an existing hospital gateway, or have a provider implement the contract below.

## Record explanations with the shared AI provider

The same backend provider powers clinician briefs, `POST /api/v2/patients/{id}/companion`, and `POST /api/v2/documents/{id}/explain?language=en`. Record answers and report explanations support `en`, `hi`, and `mr`. The document viewer requests generation only when Explain report is selected; the existing GET endpoint returns the local extractive preview without contacting a provider.

Access checks run before retrieval. Only the authorized patient's report passages and permitted signed notes/check-ins enter the model context. Known identifying details and detected instruction lines are removed first. Responses must cite supplied sources; unknown citations, unsupported numbers, malformed responses and provider failures use the original extractive fallback. Fever/emergency routing and patient treatment-change questions are handled before AI generation. Provider/model and generation metadata distinguish generated responses from fallbacks without exposing credentials.

## Adapter contract

OncoBrief sends `POST <ADAPTER_URL>` with `Authorization: Bearer <ADAPTER_KEY>` and a JSON body. Endpoints are set by the server administrator, never supplied by a patient request. Timeout is 25 seconds. Return a JSON object; return a non-2xx status on failure. Do not put secret keys or raw provider errors in the response.

Examples:

```json
{"to":"+91...","body":"Your OncoBrief code is 123456"}
```

```json
{"text":"...","source_language":"en","target_language":"mr"}
```

```json
{"cancer_type":"...","stage":"...","biomarkers":"..."}
```

Speech and vision can receive a patient-selected document with `media_base64`, `mime` and its OCR text. Image metadata is removed and images are resized before sending. Return e.g. `{"text":"..."}`, `{"translation":"..."}` or a structured draft `{"suggested_grade":2,"basis":"..."}`. Clinical and vision estimates are never automatically published as prescriptions or confirmed grades.

Trial/evidence responses should include source URLs, registry identifiers, eligibility criteria, retrieval dates and cohort sample sizes. Price responses should include generic name, strength, unit quantity, verification date and store/source. Unknown fields are preserved in the review record, not silently turned into an approved decision.

Medication, appointment and daily check-in jobs include `idempotency_key`. A gateway must deduplicate retries and distinguish provider acceptance from actual delivery. Production delivery receipts and retry policies belong to that gateway. The app records in-app receipt state and provider acceptance/failure; it does not label an accepted job “delivered”. Configure provider callbacks, sender approvals and consent templates before enabling outbound channels.

## Ordinary-phone check-in callback

The call request includes `callback_url`, a random one-hour `callback_token`, question keys and `identity_verification_required`. The gateway handles the ordinary phone conversation and verifies the person before returning answers. It must stop its conversation and give emergency instructions when the backend response has level 3.

Send `POST /api/webhooks/telephony` with `Authorization: Bearer <callback_token>`:

```json
{
  "identity_verified": true,
  "answers": {
    "language": "mr", "temperature": 38.5,
    "nausea": 1, "pain": 0, "fatigue": 2,
    "appetite": 1, "breathing": 0, "distress": 3,
    "text": "Patient's verified answer"
  }
}
```

Symptoms use grades 0–4; distress uses 0–10; temperature is Celsius. Tokens are patient-bound, single-use and revocable. Calls run only after the patient's **Reminders & daily phone check-in consent** workflow is saved. The scheduler checks due work every minute while the server is awake. Sleeping free instances cannot guarantee timely calls or emergency alert delivery.

## Verified survivor directory

`BUDDY_DIRECTORY_PATH` points to a private hospital-managed JSON list. Publish aliases rather than private contact details. Only entries explicitly marked trained, moderated and consented can match; cancer type and preferred language must match the patient.

```json
[
  {
    "volunteer_id": "REPLACE_WITH_VERIFIED_ID",
    "display_name": "REPLACE_WITH_CONSENTED_ALIAS",
    "language": "mr",
    "cancer_type": "REPLACE_WITH_MATCHING_CANCER_TYPE",
    "trained": false, "moderated": false, "consented": false
  }
]
```

The navigator verifies availability and arranges the introduction. A patient can then invite the buddy with chat-only access through the care circle. The assigned care team moderates that conversation. No real volunteer is implied by the demo.

## Human inputs that are not API keys

- Treating clinician review of the 100-question regression set, emergency rules, protocols, translations and clinical workflows. The fixture explicitly says `clinician_reviewed: false`.
- Doctor and dietitian approval of food-library items; doctor approval of the other guidance library items. Demo approvals are labelled as demo fixtures. Production starts unpublished.
- Real formulary protocols, verified trial records and prices, hospital room directions, trained buddy directory, escalation contacts and ER arrangements.
- India-region hosting, encrypted database volume/backups, persistent document storage, restore testing, retention policy and privacy-officer procedures. These cannot be established by pasting an API key.

Only fabricated patients belong on the public demo. In production, select a separate database and persistent data directory, configure a stable encryption key, turn on secure cookies and staff TOTP, and approve processing terms before setting `LLM_DATA_PROCESSING_APPROVED=true`. Name/phone/ABHA redaction reduces exposure; it is not a guarantee of complete anonymisation.
