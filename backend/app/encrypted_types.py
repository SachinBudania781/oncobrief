"""Transparent field encryption. Supports reading pre-migration plaintext values."""
from sqlalchemy.types import TypeDecorator, Text


class EncryptedText(TypeDecorator):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        from .security import cipher
        return "OBFIELD1:" + cipher().encrypt(str(value).encode()).decode()

    def process_result_value(self, value, dialect):
        if value is None or not value.startswith("OBFIELD1:"):
            return value
        from .security import cipher
        return cipher().decrypt(value[9:].encode()).decode()
