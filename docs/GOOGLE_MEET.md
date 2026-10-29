# Google Meet appointments

OncoBrief can schedule a private Google Meet event from the patient day planner. Patients choose an oncologist or psychiatrist, select whether their caregiver will join, and enter the participant email addresses. With Google Calendar configured, the backend creates a unique Meet conference and Calendar event, then sends invitations to those participants. The event title and description are generic; clinical notes and diagnoses are not sent to Google Calendar.

## Configure the hospital calendar

1. Use a hospital-owned Google Workspace account and enable the Google Calendar API in its Cloud project.
2. Create an OAuth client for a backend web application and authorize the Calendar events scope `https://www.googleapis.com/auth/calendar.events`. Generate a refresh token for the hospital calendar account.
3. Set these values as backend-only environment secrets in the deployment dashboard. Never add them to frontend build variables or commit them:

   - `GOOGLE_CALENDAR_CLIENT_ID`
   - `GOOGLE_CALENDAR_CLIENT_SECRET`
   - `GOOGLE_CALENDAR_REFRESH_TOKEN`
   - Optional: `GOOGLE_CALENDAR_ID` (defaults to `primary`)
   - Optional: `HOSPITAL_TIME_ZONE` and `GOOGLE_CALENDAR_TIME_ZONE` (both default to `Asia/Kolkata`; keep them aligned)

4. Confirm that **Connected services** lists Google Meet as configured. Make a fabricated demo appointment first and check that the Google Calendar event, Meet link and email invitations are correct.

Google Meet conferences are created through the Calendar API's `conferenceData.createRequest`; their link may arrive asynchronously. OncoBrief creates the event in its background reminder worker and checks for a pending link there. If Google Calendar is not configured, a doctor, nurse or front-desk user can attach a link created by the hospital. That manual fallback makes the link available in OncoBrief but does not email Calendar invitations.

Patients must consent before invitations are sent. Calendar invitees can see one another's email addresses. OncoBrief encrypts the saved invitee list at rest and does not include patient name, diagnosis or treatment notes in the event.

When OncoBrief owns the Google Calendar event, rescheduling updates the event and emails participants; cancelling the appointment cancels that event and its invitations. For a manually attached link, staff must also update or cancel the source event in the hospital's Google Calendar. The staff schedule screen shows the link and its setup state.

This integration creates and shares a scheduled meeting link. It does not embed or record the call, provide emergency monitoring, or replace the clinician's clinical workflow. Confirm actual host credentials, permissions, calendar settings and hospital consent procedures before using real patient information.
