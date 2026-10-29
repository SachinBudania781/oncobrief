"""Optional Google Calendar integration for private, per-appointment Meet links."""
import json
import os
import re
import secrets
from urllib.parse import quote, urlparse

import httpx

from ..round2_models import AccessGrant, Notification, User, VirtualAppointment
from ..timeutil import utcnow

TOKEN_URL = "https://oauth2.googleapis.com/token"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"


class GoogleMeetError(Exception):
    pass


def configured():
    return all(os.getenv(key) for key in (
        "GOOGLE_CALENDAR_CLIENT_ID",
        "GOOGLE_CALENDAR_CLIENT_SECRET",
        "GOOGLE_CALENDAR_REFRESH_TOKEN",
    ))


def _access_token():
    if not configured():
        raise GoogleMeetError("Google Calendar integration is not configured")
    try:
        response = httpx.post(TOKEN_URL, data={
            "client_id": os.environ["GOOGLE_CALENDAR_CLIENT_ID"],
            "client_secret": os.environ["GOOGLE_CALENDAR_CLIENT_SECRET"],
            "refresh_token": os.environ["GOOGLE_CALENDAR_REFRESH_TOKEN"],
            "grant_type": "refresh_token",
        }, timeout=15)
        response.raise_for_status()
        token = response.json().get("access_token")
        if not token:
            raise ValueError("Missing access token")
        return token
    except (httpx.HTTPError, ValueError, KeyError):
        raise GoogleMeetError("Google Calendar authorization failed") from None


def _calendar_url(event_id=""):
    calendar_id = quote(os.getenv("GOOGLE_CALENDAR_ID", "primary"), safe="@")
    url = f"{CALENDAR_API}/calendars/{calendar_id}/events"
    return f"{url}/{quote(event_id, safe='')}" if event_id else url


def _request(method, url, *, params=None, body=None):
    try:
        response = httpx.request(method, url, headers={
            "Authorization": f"Bearer {_access_token()}",
            "Content-Type": "application/json",
        }, params=params, json=body, timeout=20)
        response.raise_for_status()
        return response.json() if response.content else {}
    except (httpx.HTTPError, ValueError):
        # Do not surface the provider response: it can contain invitee addresses.
        raise GoogleMeetError("Google Calendar could not complete the request") from None


def _event_times(appointment, start=None, end=None):
    timezone_name = os.getenv("GOOGLE_CALENDAR_TIME_ZONE", os.getenv("HOSPITAL_TIME_ZONE", "Asia/Kolkata"))
    return {
        "start": {"dateTime": (start or appointment.start).isoformat(), "timeZone": timezone_name},
        "end": {"dateTime": (end or appointment.end).isoformat(), "timeZone": timezone_name},
    }


def _meeting_url(event):
    url = event.get("hangoutLink", "")
    if not url:
        url = next((p.get("uri", "") for p in (event.get("conferenceData", {}).get("entryPoints") or [])
                    if p.get("entryPointType") == "video"), "")
    parsed = urlparse(url)
    return url if parsed.scheme == "https" and parsed.hostname == "meet.google.com" else ""


def create_event(appointment, invitees):
    attendees = [{"email": email} for email in dict.fromkeys(invitees)]
    event = {
        "summary": "Private OncoBrief video consultation",
        "description": "A private care appointment. Open OncoBrief for care details.",
        **_event_times(appointment),
        "attendees": attendees,
        "conferenceData": {"createRequest": {
            "requestId": secrets.token_urlsafe(18),
            "conferenceSolutionKey": {"type": "hangoutsMeet"},
        }},
    }
    result = _request("POST", _calendar_url(), params={"conferenceDataVersion": 1, "sendUpdates": "all"}, body=event)
    event_id = result.get("id", "")
    if not event_id:
        raise GoogleMeetError("Google Calendar did not return an event")
    return event_id, _meeting_url(result)


def refresh_event(event_id):
    event = _request("GET", _calendar_url(event_id))
    return _meeting_url(event)


def reschedule_event(event_id, appointment, start=None, end=None):
    _request("PATCH", _calendar_url(event_id), params={"sendUpdates": "all"}, body=_event_times(appointment, start, end))


def cancel_event(event_id):
    _request("DELETE", _calendar_url(event_id), params={"sendUpdates": "all"})


def invitee_list(visit):
    try:
        value = json.loads(visit.invitees or "[]")
    except (TypeError, ValueError):
        return []
    return [email for email in value if isinstance(email, str)]


def set_meeting_result(visit, event_id, meeting_url):
    visit.google_event_id = event_id
    visit.meeting_url = meeting_url
    visit.source = "google_calendar"
    visit.status = "scheduled" if meeting_url else "creating"
    visit.updated_at = utcnow()


def save_manual_link(visit, meeting_url):
    parsed = urlparse(meeting_url.strip())
    valid_path = re.fullmatch(r"/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup/[A-Za-z0-9_-]+)", parsed.path)
    if (parsed.scheme != "https" or parsed.hostname != "meet.google.com" or parsed.username or parsed.password
            or parsed.port not in (None, 443) or not valid_path):
        raise ValueError("Enter a secure Google Meet link from meet.google.com")
    visit.meeting_url = meeting_url.strip()
    visit.google_event_id = ""
    visit.source = "staff_manual"
    visit.status = "scheduled"
    visit.updated_at = utcnow()


def public_visit(visit):
    if not visit:
        return None
    return {
        "provider": "Google Meet",
        "clinician_type": visit.clinician_type,
        "status": visit.status,
        "meeting_url": visit.meeting_url if visit.status == "scheduled" else "",
        "caregiver_included": visit.caregiver_included,
        "source": visit.source,
    }


def notify_appointment_participants(db, patient_id, title, body):
    from sqlalchemy import select

    from ..security import utcnow as security_utcnow

    now = security_utcnow()
    grants = db.scalars(select(AccessGrant).where(
        AccessGrant.patient_id == patient_id,
        AccessGrant.active.is_(True),
    )).all()
    for grant in grants:
        user = db.get(User, grant.user_id)
        if (user and user.active and (not grant.expires_at or grant.expires_at > now)
                and ("all" in (grant.scopes or []) or "appointments" in (grant.scopes or []))):
            db.add(Notification(
                user_id=user.id,
                patient_id=patient_id,
                channel="appointment",
                title=title,
                body=body,
            ))
    db.commit()
