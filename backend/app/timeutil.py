import os
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def utcnow():
    """Naive UTC for existing database compatibility; API serializers add the UTC suffix."""
    return datetime.now(UTC).replace(tzinfo=None)


def hospital_now():
    """Naive local hospital wall time for the legacy naive appointment columns."""
    zone_name = os.getenv("HOSPITAL_TIME_ZONE", "Asia/Kolkata")
    try:
        return datetime.now(ZoneInfo(zone_name)).replace(tzinfo=None)
    except ZoneInfoNotFoundError:
        if zone_name in {"Asia/Kolkata", "Asia/Calcutta"}:
            return (datetime.now(UTC) + timedelta(hours=5, minutes=30)).replace(tzinfo=None)
        return datetime.now(UTC).replace(tzinfo=None)
