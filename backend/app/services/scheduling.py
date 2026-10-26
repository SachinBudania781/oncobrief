from functools import wraps
from threading import RLock

_lock=RLock()


def serial_schedule(fn):
    """Serialize schedule changes in the documented single-worker deployment."""
    @wraps(fn)
    def wrapped(*args,**kwargs):
        with _lock:
            return fn(*args,**kwargs)
    return wrapped
