# API setup

Put secrets only in the backend service's Render Environment page:
https://dashboard.render.com/web/srv-dbbmvj0473hc73ct7k3g/env

## Gemini: already configured

Keep the existing `LLM_PROVIDER`, `LLM_API_KEY`, and `LLM_MODEL`. All three apps use the shared backend. No frontend API key is needed. Record-based fallbacks keep reports accessible when generation fails.

## Automatic Google Meet links and invitations

Enable the Google Calendar API in a Google Cloud project. Configure an OAuth consent screen and client, then authorize the calendar account for `https://www.googleapis.com/auth/calendar.events` with offline access. Store:

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID=primary`
- `GOOGLE_CALENDAR_TIME_ZONE=Asia/Kolkata`

Save and deploy the backend. Test with a fabricated appointment and controlled participant email addresses. Check the actual invitation and Meet link. Without these credentials, staff can attach an existing hospital Meet link; ordinary appointments still work.

Official references: [Calendar setup](https://developers.google.com/workspace/calendar/api/quickstart/python), [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), and [event creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).

## SMS, WhatsApp, calls and hosted speech

These are optional provider integrations. A vendor API key alone will not activate the existing adapter contracts. `docs/INTEGRATIONS.md` describes the HTTPS request/response format and environment variables. No real outbound delivery is claimed until a provider-specific adapter and test recipient have been verified.

For the hackathon, ID/password sign-in, in-app messages, check-ins, appointment booking, uploaded records and consent work without these providers. Browser speech support depends on the device/browser. The Android BLE companion source is included under `android`; a physical sensor and native build still need device testing. An installed web app cannot promise background sensing or alarms after the browser is closed.
