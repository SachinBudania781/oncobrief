from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, delete, select
from sqlalchemy.orm import Session


@pytest.fixture
def vital_db():
    from app.db import Base
    from app.models import Patient
    from app.round2_models import AccessGrant, CareRecord, User

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        db.add(Patient(id="VITAL-TEST", name="Synthetic patient", age=40, sex="F"))
        user = User(username="vital-reviewer", name="Reviewer", role="caregiver")
        db.add(user)
        db.flush()
        db.add(AccessGrant(patient_id="VITAL-TEST", user_id=user.id, scopes=["activity"]))
        db.add(CareRecord(patient_id="VITAL-TEST", kind="vital_alert_protocol",
                          author_id=user.id, author_name="Doctor", author_role="doctor",
                          status="approved", data={"thresholds": {"heart_rate": 60}}))
        db.commit()
        yield db
    engine.dispose()


def save_samples(db, start, values):
    from app.models import WearableReading

    rows = [WearableReading(patient_id="VITAL-TEST", metric="heart_rate", value=value,
                            unit="bpm", source="android_ble",
                            observed_at=start + timedelta(seconds=index))
            for index, value in enumerate(values)]
    db.add_all(rows)
    db.commit()
    return rows


def test_continuous_sensor_can_alert_then_recover(vital_db, monkeypatch):
    from app.round2_models import CareRecord, Notification
    from app.services import vitals

    now = datetime(2040, 1, 2, 12)
    monkeypatch.setattr(vitals, "utcnow", lambda: now)
    low = save_samples(vital_db, now - timedelta(seconds=40), [50] * 21)
    vitals.evaluate_vital_readings(vital_db, "VITAL-TEST", low)
    alert = vital_db.scalar(select(CareRecord).where(CareRecord.kind == "vital_alert"))
    assert alert is not None and alert.status == "open"
    assert len(vital_db.scalars(select(Notification)).all()) == 1
    # Replayed batches must not send another alert while this one is open.
    vitals.evaluate_vital_readings(vital_db, "VITAL-TEST", low)
    assert len(vital_db.scalars(select(Notification)).all()) == 1
    recovered = save_samples(vital_db, now - timedelta(seconds=19), [70] * 20)
    vitals.evaluate_vital_readings(vital_db, "VITAL-TEST", recovered)
    assert alert.status == "resolved"
    vitals.evaluate_vital_readings(vital_db, "VITAL-TEST", low)
    assert alert.status == "resolved"
    assert len(vital_db.scalars(select(Notification)).all()) == 1


@pytest.mark.parametrize("future", [False, True])
def test_no_alert_for_interrupted_low_or_future_samples(vital_db, monkeypatch, future):
    from app.round2_models import CareRecord
    from app.services import vitals

    now = datetime(2040, 1, 2, 12)
    monkeypatch.setattr(vitals, "utcnow", lambda: now)
    values = [50] * 4 + [70] + [50] * 6
    rows = save_samples(vital_db, now + timedelta(seconds=20) if future
                        else now - timedelta(seconds=10), [50] * 11 if future else values)
    vitals.evaluate_vital_readings(vital_db, "VITAL-TEST", rows)
    assert vital_db.scalar(select(CareRecord).where(CareRecord.kind == "vital_alert")) is None
