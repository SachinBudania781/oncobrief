import os
from datetime import UTC, datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def utcnow():
    """Naive UTC for existing database compatibility; API serializers add the UTC suffix."""
    return datetime.now(UTC).replace(tzinfo=None)


def hospital_timezone():
    """Configured hospital timezone, with the same safe fallback as hospital_now()."""
    zone_name = os.getenv("HOSPITAL_TIME_ZONE", "Asia/Kolkata")
    try:
        return ZoneInfo(zone_name)
    except ZoneInfoNotFoundError:
        if zone_name in {"Asia/Kolkata", "Asia/Calcutta"}:
            return timezone(timedelta(hours=5, minutes=30))
        return UTC


def hospital_now():
    """Naive local hospital wall time for the legacy naive appointment columns."""
    return datetime.now(hospital_timezone()).replace(tzinfo=None)


def to_hospital_wall_time(value):
    """Normalize an aware API datetime to hospital wall time; preserve naive local inputs."""
    if value.tzinfo is None:
        return value
    return value.astimezone(hospital_timezone()).replace(tzinfo=None)


def hospital_wall_to_utc(value):
    """Convert a naive hospital wall time to naive UTC for UTC-based expiry columns."""
    if value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value.replace(tzinfo=hospital_timezone()).astimezone(UTC).replace(tzinfo=None)
