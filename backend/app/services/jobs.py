from ..timeutil import utcnow
"""Idempotent in-app reminders and opt-in outbound jobs, using the hospital timezone."""
import re
from datetime import datetime, timedelta
from sqlalchemy import select
from ..db import SessionLocal
from ..models import Appointment, Medication, Patient
from ..round2_models import AccessGrant, CareRecord, JobReceipt, Notification, User
from .companion import records


def tick(now=None):
    now = now or datetime.now()
    with SessionLocal() as db:
        import os
        if os.getenv("AUDIT_ANCHOR_ADAPTER_URL") and os.getenv("AUDIT_ANCHOR_ADAPTER_KEY"):
            from ..security import verify_chain
            key=f"audit-anchor:{now.date()}"
            if not db.get(JobReceipt,key):
                from .integrations import deliver
                checked=verify_chain(db)
                if checked["valid"]:
                    try:
                        result=deliver("audit_anchor",{"head":checked["head"],"at":utcnow().isoformat(),"idempotency_key":key})
                        db.add(JobReceipt(key=key,status="anchored",detail=str(result.get("id",""))[:300]))
                        db.commit()
                    except Exception:
                        # Leave the job unreceipted so the next tick can retry anchoring.
                        pass
        for p in db.scalars(select(Patient)):
            events = []
            for m in db.scalars(select(Medication).where(Medication.patient_id == p.id, Medication.active.is_(True))):
                for t in m.times:
                    if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", t):
                        due = now.replace(hour=int(t[:2]), minute=int(t[3:]), second=0, microsecond=0)
                        if due <= now < due + timedelta(minutes=5):
                            events.append((f"med:{m.id}:{due.isoformat()}", "Medicine reminder", f"A signed medicine reminder is due at {t}. Open your care space.", "medicines"))
            for a in db.scalars(select(Appointment).where(Appointment.patient_id == p.id, Appointment.status == "booked")):
                if a.start - timedelta(hours=2) <= now < a.start - timedelta(hours=2) + timedelta(minutes=5):
                    events.append((f"appt:{a.id}:{a.start.isoformat()}", "Appointment reminder", f"Your appointment starts at {a.start:%H:%M}. Check your day pass.", "appointments"))
            for r in records(db, p.id, "reminder"):
                at = r.data.get("due_at", "")
                try:
                    due = datetime.fromisoformat(at)
                except ValueError:
                    continue
                if due <= now < due + timedelta(minutes=5) and r.status != "completed":
                    events.append((f"record:{r.id}", r.data.get("title", "Care reminder"), r.data.get("text", "A signed care reminder is due."), "notes"))
            comms = records(db, p.id, "communication")
            comm = comms[0].data if comms else {}
            t = comm.get("time", "09:00")
            if re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", t):
                due = now.replace(hour=int(t[:2]), minute=int(t[3:]), second=0, microsecond=0)
                if due <= now < due + timedelta(minutes=5):
                    events.append((f"checkin:{p.id}:{due.date()}", "Your daily check-in", "How are you feeling? Open your daily check-in or answer the configured call.", "checkin"))
            for key, title, body, scope in events:
                if db.get(JobReceipt, key):
                    continue
                receipt = JobReceipt(key=key, status="in_app")
                db.add(receipt)
                for g in db.scalars(select(AccessGrant).where(AccessGrant.patient_id == p.id, AccessGrant.active.is_(True))):
                    if (not g.expires_at or g.expires_at > utcnow()) and ("all" in g.scopes or scope in g.scopes):
                        db.add(Notification(user_id=g.user_id, patient_id=p.id, title=title, body=body))
                db.commit()
                channel = comm.get("channel")
                if comm.get("consent") and channel in {"sms", "whatsapp", "phone"} and (channel != "phone" or key.startswith("checkin:")):
                    from .integrations import deliver
                    try:
                        payload = {"to": p.phone, "body": body, "language": p.preferred_language, "idempotency_key": key}
                        if channel == "phone":
                            from .telephony import call_payload
                            payload.update(call_payload(db, p.id, comms[0].author_id))
                        result = deliver(channel, payload)
                        receipt.status = "provider_accepted"
                        receipt.detail = str(result.get("id", ""))[:300]
                    except Exception as exc:
                        receipt.status = "external_failed"
                        receipt.detail = str(getattr(exc, "detail", "Provider unavailable"))[:300]
                    db.commit()


if __name__ == "__main__":
    tick()
