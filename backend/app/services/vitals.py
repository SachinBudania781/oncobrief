"""Clinician-configured, human-review alerts from recent wearable vitals."""
from datetime import timedelta
from sqlalchemy import select
from ..timeutil import utcnow
from ..models import WearableReading
from ..round2_models import AccessGrant, CareRecord, Notification, User

LIVE_SOURCES = {"bluetooth", "android_ble", "health_connect", "healthkit", "vendor"}
ALERT_ROLES = {"caregiver", "doctor", "nurse", "navigator", "frontdesk", "admin"}
VITAL_LABELS = {
    "heart_rate": ("heart rate", "bpm"),
    "spo2": ("oxygen saturation (SpO2)", "%"),
    "systolic": ("systolic blood pressure", "mmHg"),
    "diastolic": ("diastolic blood pressure", "mmHg"),
    "temperature_c": ("body temperature", "°C"),
}


def current_vital_alert_protocol(db, patient_id):
    return db.scalar(
        select(CareRecord)
        .where(
            CareRecord.patient_id == patient_id,
            CareRecord.kind == "vital_alert_protocol",
            CareRecord.status == "approved",
        )
        .order_by(CareRecord.created_at.desc(), CareRecord.id.desc())
        .limit(1)
    )


def _assigned_recipients(db, patient_id):
    now = utcnow()
    recipients = []
    grants = db.scalars(select(AccessGrant).where(
        AccessGrant.patient_id == patient_id,
        AccessGrant.active.is_(True),
    )).all()
    for grant in grants:
        if grant.expires_at and grant.expires_at <= now:
            continue
        if not ({"all", "activity"} & set(grant.scopes or [])):
            continue
        user = db.get(User, grant.user_id)
        if user and user.active and user.role in ALERT_ROLES:
            recipients.append(user)
    return recipients


def evaluate_vital_readings(db, patient_id, saved_readings):
    """Alert after two distinct recent sensor samples cross a signed patient limit."""
    protocol = current_vital_alert_protocol(db, patient_id)
    thresholds = (protocol.data or {}).get("thresholds", {}) if protocol else {}
    if not thresholds:
        return

    active_alerts = {
        row.data.get("metric"): row
        for row in db.scalars(select(CareRecord).where(
            CareRecord.patient_id == patient_id,
            CareRecord.kind == "vital_alert",
            CareRecord.status == "open",
        )).all()
    }
    changed = False
    now = utcnow()
    ordered = sorted(
        (row for row in saved_readings if row.metric in thresholds and row.source in LIVE_SOURCES),
        key=lambda row: (row.observed_at, row.id or 0),
    )
    # Evaluate the final state of each metric once per upload. Delayed/replayed
    # historical batches must not reopen an alert after a newer recovery.
    candidates = {row.metric: row for row in ordered}
    for candidate in candidates.values():
        label_unit = VITAL_LABELS.get(candidate.metric)
        if not label_unit:
            continue
        label, unit = label_unit
        threshold = float(thresholds[candidate.metric])
        later = db.scalar(select(WearableReading.id).where(
            WearableReading.patient_id == patient_id,
            WearableReading.metric == candidate.metric,
            WearableReading.source.in_(LIVE_SOURCES),
            WearableReading.observed_at > candidate.observed_at,
            WearableReading.observed_at <= now,
        ).limit(1))
        if later is not None:
            continue
        recent = db.scalars(select(WearableReading).where(
            WearableReading.patient_id == patient_id,
            WearableReading.metric == candidate.metric,
            WearableReading.source.in_(LIVE_SOURCES),
            WearableReading.observed_at <= candidate.observed_at,
            WearableReading.observed_at >= candidate.observed_at - timedelta(minutes=5),
        ).order_by(WearableReading.observed_at.desc(), WearableReading.id.desc())).all()
        if len(recent) < 2:
            continue
        newest = recent[0]
        previous = next((row for row in recent[1:]
                         if newest.observed_at - row.observed_at >= timedelta(seconds=10)), None)
        if previous is None:
            continue
        if not timedelta(0) <= now - newest.observed_at <= timedelta(minutes=5):
            continue

        # Continuous sensors can emit every second. Compare samples spanning at
        # least ten seconds, and require all intervening samples to agree. Using
        # only adjacent samples prevented both alerts and recovery at high rates.
        interval = [row for row in recent if row.observed_at >= previous.observed_at]
        below = all(row.value < threshold for row in interval)
        recovered = all(row.value >= threshold for row in interval)

        active = active_alerts.get(candidate.metric)
        if below and not active:
            recipients = _assigned_recipients(db, patient_id)
            if not recipients:
                continue
            data = {
                "metric": candidate.metric,
                "label": label,
                "value": newest.value,
                "unit": unit,
                "threshold": threshold,
                "source": newest.source,
                "observed_at": newest.observed_at.isoformat() + "Z",
                "protocol_id": protocol.id,
            }
            alert_row = CareRecord(
                patient_id=patient_id,
                kind="vital_alert",
                author_id=0,
                author_name="OncoBrief monitoring",
                author_role="system",
                status="open",
                data=data,
            )
            db.add(alert_row)
            title_label = "oxygen saturation" if candidate.metric == "spo2" else label
            body = (
                f"Two recent {label} readings are below this patient's clinician-signed review threshold. "
                f"Latest: {newest.value:g} {unit}; configured threshold: {threshold:g} {unit}. "
                "Check sensor quality and the patient's condition, then follow the care team's escalation plan. "
                "This notice is not a diagnosis or a substitute for prescribed monitoring."
            )
            for recipient in recipients:
                db.add(Notification(
                    user_id=recipient.id,
                    patient_id=patient_id,
                    channel="vitals",
                    title=f"Low {title_label} reading",
                    body=body,
                ))
            active_alerts[candidate.metric] = alert_row
            changed = True
        elif recovered and active:
            active.status = "resolved"
            active.updated_at = newest.observed_at
            active.data = dict(active.data or {}) | {
                "resolved_at": newest.observed_at.isoformat() + "Z",
                "latest_value": newest.value,
            }
            active_alerts.pop(candidate.metric, None)
            changed = True
    if changed:
        db.commit()
