from datetime import UTC, datetime
from zoneinfo import ZoneInfo

HOSPITAL_TIMEZONE = ZoneInfo("Asia/Kolkata")


def utcnow():
    """Naive UTC for existing database compatibility; API serializers add the UTC suffix."""
    return datetime.now(UTC).replace(tzinfo=None)


def hospital_now():
    """Return the current hospital wall-clock time as a naive datetime.

    Appointment columns use naive local times for compatibility with the existing
    database, so keep this result naive while deriving it in the configured
    hospital timezone (Asia/Kolkata).
    """
    return datetime.now(HOSPITAL_TIMEZONE).replace(tzinfo=None)
