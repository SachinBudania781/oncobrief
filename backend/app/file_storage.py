"""Encrypted file persistence in the same transaction as its owning record.

The filesystem is a cache on free hosts. Only authorized document routes call
these helpers; no public file or blob endpoint is exposed.
"""
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import LargeBinary, String, select
from sqlalchemy.orm import Mapped, mapped_column

from .config import DATA_DIR
from .db import Base, SessionLocal


class StoredFile(Base):
    __tablename__ = "stored_files"
    path: Mapped[str] = mapped_column(String, primary_key=True)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)


def storage_key(path):
    try:
        relative = Path(path).resolve().relative_to(DATA_DIR.resolve())
    except ValueError:
        raise HTTPException(404, "File not found")
    if not relative.parts or relative.parts[0] not in {"storage", "imports"}:
        raise HTTPException(404, "File not found")
    return relative.as_posix()


def persist_file(db, path):
    from .security import encrypt_file

    key = storage_key(path)
    encrypt_file(path)
    data = Path(path).read_bytes()
    if not data.startswith(b"OBENC1:"):
        raise RuntimeError("Only encrypted files may be persisted")
    db.merge(StoredFile(path=key, ciphertext=data))


def file_exists(path):
    key = storage_key(path)
    if Path(path).is_file():
        return True
    with SessionLocal() as db:
        return db.scalar(select(StoredFile.path).where(StoredFile.path == key)) is not None


def stored_bytes(path):
    key = storage_key(path)
    with SessionLocal() as db:
        blob = db.get(StoredFile, key)
        if blob is None:
            raise HTTPException(404, "File is no longer available")
        return blob.ciphertext


def backfill_files():
    """Preserve referenced pre-release uploads without changing their records."""
    from .models import Document
    from .round2_models import BulkImport
    from .memory_up import MemoryUp, MEMORY_DIR

    with SessionLocal() as db:
        paths = [DATA_DIR / value for value in db.scalars(select(Document.file_path))]
        paths += [DATA_DIR / value for value in db.scalars(
            select(BulkImport.file_path).where(BulkImport.status == "review"))]
        paths += [MEMORY_DIR / value for value in db.scalars(
            select(MemoryUp.attachment).where(MemoryUp.attachment != ""))]
        for path in paths:
            if path.is_file() and db.get(StoredFile, storage_key(path)) is None:
                persist_file(db, path)
                db.commit()
