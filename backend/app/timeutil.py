from datetime import UTC, datetime
from zoneinfo import ZoneInfo

HOSPITAL_TIMEZONE = ZoneInfo("Asia/Kolkata")


def utcnow():
    """Naive UTC for existing database compatibility; API serializers add the UTC suffix."""
    return datetime.now(UTC).replace(tzinfo=None)


def hospital_now():
    """Return the current hospital wall-clock time as a naive datetime."""
    return datetime.now(HOSPITAL_TIMEZONE).replace(tzinfo=None)


def to_hospital_wall_time(value: datetime) -> datetime:
    """Normalize an input datetime to naive hospital-local wall time.

    Naive values are already hospital-local, as used by existing appointment rows.
    Aware values are converted from their stated timezone before removing tzinfo.
    """
    if value.tzinfo is None:
        return value
    return value.astimezone(HOSPITAL_TIMEZONE).replace(tzinfo=None)


def hospital_wall_to_utc(value: datetime) -> datetime:
    """Convert a hospital wall-clock datetime to naive UTC for legacy DB columns."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=HOSPITAL_TIMEZONE)
    return value.astimezone(UTC).replace(tzinfo=None)
