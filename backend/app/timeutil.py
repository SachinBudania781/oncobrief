from datetime import UTC, datetime


def utcnow():
    """Naive UTC for existing database compatibility; API serializers add the UTC suffix."""
    return datetime.now(UTC).replace(tzinfo=None)
