# Round 2 feature map

This maps the supplied Parts A, B and C to the implementation. Part A's repeated requests are covered by the corresponding workflows below. “Service setup” means the gateway contract and review path exist, but the external service has not been configured or exercised with real credentials. “Hospital input” means a real clinician, hospital operator or trained volunteer must supply/approve the content or data. See `INTEGRATIONS.md` for exact placeholders.

## Patient and family

| Planned feature | Where it works | Setup / limits |
| --- | --- | --- |
| Personal AI linked to doctor view | Ask my records / Ask the chart, shared patient journal | Optional cited AI answers from authorized reports and signed notes; extractive fallback and fixed safety routing |
| Read, interpret and store records as text | OCR upload pipeline, living summary endpoint | Live images need Tesseract; low-confidence results stay visible as uncertain |
| English, Hindi and Marathi voice | Daily check-in, companion, diary, scribe, audio playback | Browser support; Bhashini gateway for dedicated speech |
| Emotional listening and mood checks | Companion, daily distress score, private caregiver wellbeing | Supportive responses, crisis rules and human alerts; no therapist claim |
| Daily five-symptom check-in | Daily check-in with temperature and distress | Reported-by identity preserved; caregiver reports allowed only by consent |
| Fever / severe-symptom alerts | Red-flag rules, nurse triage, command centre, clinician brief | In-app updates; provider setup for ordinary phone delivery |
| Explain my report | Reports → open source → Explain report | Plain-language lab terms, original excerpts and doctor questions; translation gateway for missing languages |
| Medicine strip scanner / scan before swallowing | Medicines & requests | Exact generic/strength/expiry checks, risk screening and pharmacist-review state; no automatic dose-taken claim |
| Treatment roadmap / cycle position | Journey & response, signed roadmap workflow | Treating oncologist authors and signs regimen-specific calendars |
| Visit preparation and takeaways | Visit prep; Plans & journal → Visit takeaways | Patient/family/nurse can draft; doctor signs and creates next-step reminders |
| Medicine request tracker | Medicines & requests / Doctor approvals | Sent → reviewing → approved; approved medicines create reminder times |
| Safe Indian meal plan | Food, energy & play; preferences and nutrition journal | Curated vegetarian/Jain/non-vegetarian examples; doctor and dietitian approval in production; not an autonomous diet prescription |
| Energy-based activity, hobbies and games | Wellness guidance, manual activity and consented Bluetooth wearable trends, memory game | Recorded fatigue/count flags constrain suggestions; signed guidance library |
| Scheme and money navigator | Money & schemes + finance workflow | Official PM-JAY verification link and entered quote/confirmed-cover calculation; no eligibility or reimbursement guarantee |
| One-trip planner, ride coordination and nearby stays | Day pass, appointment-linked transport requests and staff coordination queue | Pickup, access and fare-support requests go to the assigned team; this does not book a third-party vehicle. Nearby search needs hospital address |
| Trial matching and information | Connected services → trials; clinical trial review workflow | CTRI gateway or verified manual registry entry; doctor sees and signs first |
| Who opened my records | Privacy & devices | Patient-specific audit chain with actor/time; independent anchor available through gateway |
| WhatsApp / SMS mode | Communication-consent workflow, reminder scheduler, adapters | Requires opted-in channel, sender setup and gateway; ordinary phone callbacks are patient-bound |
| Survivorship | Signed survivorship workflow with follow-up reminders | Treating clinician supplies follow-up and late-effect plan |
| Care circle with revocable consent | Caregiver consent | Separate caregiver login, granular scopes, immediate server-side revocation |
| Caregiver dashboard | Caregiver sign-in | Shared medicines, appointments, alerts and requests depend on consent scopes |
| Family shift handover | Caregiver shift handover workflow | Author/time and next-carer tasks stored |
| Alert sharing | In-app notifications for consented care team and caregivers | External delivery through opted-in gateways; receipt is not assumed |
| Caregiver reporting | Check-ins and takeaways | Explicit caregiver provenance |
| Group care chat and thread recap | Care circle chat; Smart inbox | Patient, family and assigned staff; fixed urgency rules; extractive three-line recap |
| Caregiver wellbeing | Private wellbeing workflow | Navigator can be asked to contact the caregiver without exposing the private score |

## Clinician and nurse

| Planned feature | Where it works | Setup / limits |
| --- | --- | --- |
| Between-visit command centre | Home / who needs a call | Transparent ranking from alerts, recent lab flags, missed doses/visits, distress and step changes |
| Prescription co-pilot and approval gate | Doctor approvals; clinical profile and drug-protocol workflows | BSA calculation, eGFR, allergy/duplicate/selected-risk checks; signed mg/m² protocols; full formulary gateway remains an input |
| Consultation scribe | Plans & journal → Consultation scribe | Consent, voice transcript, editable assessment/plan, draft, signature |
| Live consultation interpreter | Scribe captions → configured translation service | Original captions remain available; clinician can correct translations |
| Chemo-day readiness | Journey & response → readiness; signed local protocol and confirmation workflows | Result age, missing labs and clinician-set thresholds; cardiac/current-condition review remains clinical work |
| Cumulative dose tracking | Cumulative dose entry and clinical chart | Totals are grouped by drug and unit; warns near clinician-entered limits; reconcile missing lifetime exposure |
| Tumour response and marker graphs | Journey & response | Confirmed measurement entries, sourced lab/marker trends, raw extraction candidates for review |
| Evidence for suggestions | Clinical evidence card, drug protocol source, trial/price review source | Fabricated patients are excluded; consented local cohorts require ≥10 matches; cross-hospital evidence gateway |
| Ask the chart / personal AI visible to doctor | Ask my records, companion journal | Same-patient sources and history |
| Smart inbox and drafted reply | Home → Smart inbox | Urgent patient/family messages sorted first; human edits and sends |
| Shared decision aid | Shared decision workflow | Benefit, risks, visits, cost and patient's priorities; treating doctor signs |
| Tumour board pack | Home / case-pack PDF | Readable summary, source citations, key source pages and open questions |
| Tumour board live room | Shared board-decision journal and journey replay | Polling shares updates among assigned clinicians; lead/treating oncologist signs and updates roadmap |
| Click a number on the scan | Document viewer → tap lab value / find on original | Word coordinates, protected page rendering and exact-match highlight; no invented box when OCR has none |
| Body map and time slider | Journey & response; pain/body-site workflow | Confirmed tumour/node/port/surgery/radiation observations and dated pain entries |
| What changed | Clinical chart → report diffs | Consecutive reports compared by subtype |
| Personal baseline alerts | Clinical chart, command centre, check-in deviation alert | Individual preceding readings/history; no population prediction claim |
| Audio brief and voice commands | Doctor home | Abbreviated spoken summary; “build brief”, “last three CBCs” and grounded chart questions |
| Journey replay | Clinical chart | Twenty-second body-map/source replay driven by dated records |
| Nurse triage | Nurse triage console | Call script, escalation ladder, arrival clock and recorded outcome |
| Nurse shift handover | Nurse shift acknowledgement workflow | Generated open alerts/approvals/tasks; incoming nurse records acknowledgement; staff-only visibility |

## Hospital operations and Part C patient moments

| Planned feature | Where it works | Setup / limits |
| --- | --- | --- |
| Individual staff logins and restricted roles | Auth and patient grants | Staff password + TOTP in production; lab uploads restricted to own author; front desk schedule scope |
| Wrong-patient guard | Upload and bulk confirmation | Printed ID/name mismatch blocks filing; unreadable identity requires an auditable manual verification |
| Queue / wait-time messages | Day pass and arrival/status updates | Estimate based on queue and 20-minute slots, not a guaranteed time |
| Patient transport coordination | Transport tab for patients/caregivers; Uber, Rapido, hospital-arranged, caregiver-arranged; assigned staff queue; optional consented live trip location | Ride-app launch only; booking/payment are outside OncoBrief. External hospital/caregiver messages need verified contacts and an SMS/email adapter. Location sharing is opt-in, starts on a patient action, and can be stopped/revoked. |
| Clash fix | Schedule desk | Preview nearest free slot; rechecks patient and room overlap on approval |
| Day-care chair / preparation board | Chair workflow and hospital overview | Requires signed approved order; rejects recorded chair overlaps |
| Approved multilingual leaflets | Wellness → Patient leaflets | English/Hindi/Marathi where approved; missing translations explicitly fall back to the original |
| AI ordinary-phone check-in | Consent workflow and minute scheduler | Telephony gateway required; browser demonstration is labelled |
| Fever golden-hour mode | Red emergency panel and triage console | Maps, nurse alert, selected-summary ER gateway; 60-minute target clock begins only on recorded ER arrival |
| Emergency medical QR | Emergency QR & sharing | Selected fields, expiring bearer link, watermark/audit and team notification on opening |
| Hospital boarding/day pass | Hospital day pass | Room, next stops, queue, arrival and print; indoor routes need hospital information |
| Personal forecast vs reality | Journey & response | Prior patient cycle-day observations with actual check-ins; missing history stays blank |
| Photo symptom history | Uploaded images + photo symptom workflow | Nurse-confirmed grades; vision estimates remain drafts |
| Meal photos / weight watch | Nutrition workflow + optional vision | Verified/manual macro entries; recorded rapid weight change creates dietitian-review alert |
| Loved one's voice reminder | Family voice reminder workflow | Browser recording, encrypted audio and signed access; open audio through the reminder's document link |
| Generic price finder | Price gateway and signed price/substitution workflow | Real price/store data required; switching stays a doctor decision |
| Blood donor coordination card | Blood card workflow, signed by doctor | Hospital blood-bank confirmation entered before sharing/printing the card |
| Festival, weather and AQI tips | Approved seasonal content + environment gateway | Live feed required for current conditions |
| Week Wrapped | Wellness | Recorded doses, steps, mood and best day, printable |
| Teach-back | Wellness → three questions | Scores are stored; unclear answers request nurse explanation |
| Explain to my family | Approved family leaflet and voice playback | Clinician-reviewed age-appropriate content/translation |
| Voice diary | Diary workflow | Concern-sharing consent; emergency rules override ordinary chat |
| Second-opinion pack | Consented second-opinion links and PDF | Up to seven-day expiry; per-share fields and immediate revocation |
| Survivor buddy | Buddy request and verified directory matcher | Same cancer/language, trained/consented/moderated entries only; navigator introduction and patient chat invitation |
| Pain body map | Pain workflow | Click a body site and record dated score; high pain triggers triage review |
| Streak garden | Wellness | Grows from distinct check-in days; gentle restart and memory game |
| Whole-file intake | Reports & uploads → Whole-file intake | Up to 100 pages, page OCR, date/type suggestions, grouping and staff confirmation before filing |
| Drop-out rescue | Command centre + navigator tasks / finance | Explicit missed-visit, travel and cost signals, then a human call/task |
| Hospital command centre | Home overview, triage and schedule | Assigned-patient queue, chair prep, open alerts and emergency-card events |
| Diagnosis-to-treatment | Hospital overview | First treatment record, interval and missing-pathology/no-treatment blocker |
| QR gate check-in | Day-pass QR / arrival button | Login and explicit arrival action updates booked departments |
| Smart slot packing | Schedule desk | Room/patient constraints, nearest-free proposals and staff approval; local operating constraints must be reviewed |

## Security and measured limits

Sessions are server-side and cookie-protected; browser role headers are ignored. Patient relationships/scopes are checked on read and mutation endpoints. Caregiver revocation is checked on subsequent requests. Break-glass access expires in 15 minutes, records a reason and alerts the privacy officer. Treating-doctor checks protect clinical signatures, with atomic state changes to prevent duplicate approvals.

Documents use encrypted storage, short-lived viewer-bound links, watermarks and restricted download actions. Phone/ABHA fields are separately encrypted. The wider database and backups require hosting-layer encryption. Audit records are chained by SHA-256; a configured independent daily anchor protects against whole-chain replacement. HTTPS, database retention, India residency and operational availability require deployment setup.

The API has origin checks, bounded uploads, content validation, rate limits, security headers and access logs. CI runs API tests, a production frontend build and dependency advisories. None of these substitute for a hospital security assessment or clinical validation. The 100-question suite is an engineering regression set; clinician review is explicitly pending.

## Wearable activity review

The wearable history graph is available to patients and authorized caregivers and care staff with the activity scope. Care staff and caregivers see a configurable daily-step review line (default 3,000 steps; set LOW_ACTIVITY_STEPS_THRESHOLD). The background job checks the latest recorded step total for the previous completed day and sends an in-app notice only to active, assigned caregiver/staff accounts with activity access. It does not send low-activity notices to patient accounts, does not infer zero activity when no data arrived, and presents the threshold as a coordination prompt rather than a clinical guideline. Daily steps require a phone-health or device-vendor feed, or a daily entry; generic browser Bluetooth capture does not currently read step counts.
