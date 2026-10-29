"""Configuration helpers for non-clinical activity review prompts."""
import os

DEFAULT_LOW_ACTIVITY_STEPS_THRESHOLD = 3000


def low_activity_steps_threshold():
    try:
        value = int(os.getenv("LOW_ACTIVITY_STEPS_THRESHOLD", str(DEFAULT_LOW_ACTIVITY_STEPS_THRESHOLD)))
    except (TypeError, ValueError):
        value = DEFAULT_LOW_ACTIVITY_STEPS_THRESHOLD
    return min(200000, max(0, value))
