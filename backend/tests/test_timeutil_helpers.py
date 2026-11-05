from datetime import UTC, datetime

from app.timeutil import HOSPITAL_TIMEZONE, hospital_now, hospital_wall_to_utc, to_hospital_wall_time


def test_hospital_now_returns_naive_local_wall_time():
    value = hospital_now()
    assert value.tzinfo is None
    assert value == datetime.now(HOSPITAL_TIMEZONE).replace(tzinfo=None)


def test_to_hospital_wall_time_keeps_naive_hospital_value():
    value = datetime(2026, 6, 1, 10, 30)
    assert to_hospital_wall_time(value) is value


def test_to_hospital_wall_time_converts_aware_utc():
    value = datetime(2026, 6, 1, 4, 30, tzinfo=UTC)
    assert to_hospital_wall_time(value) == datetime(2026, 6, 1, 10, 0)


def test_hospital_wall_to_utc_converts_local_wall_time():
    value = datetime(2026, 6, 1, 10, 0)
    assert hospital_wall_to_utc(value) == datetime(2026, 6, 1, 4, 30)


def test_hospital_wall_to_utc_converts_aware_input_to_naive_utc():
    value = datetime(2026, 6, 1, 4, 30, tzinfo=UTC)
    assert hospital_wall_to_utc(value) == datetime(2026, 6, 1, 4, 30)
