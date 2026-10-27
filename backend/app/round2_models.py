from .timeutil import utcnow
"""Additive Round 2 tables. Existing prototype tables and patient folders are preserved."""
from datetime import datetime
from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base
from .encrypted_types import EncryptedText


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True)
    name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String)
    password_hash: Mapped[str] = mapped_column(String, default="")
    phone: Mapped[str] = mapped_column(EncryptedText, default="")
    totp_secret: Mapped[str] = mapped_column(EncryptedText, default="")
    department: Mapped[str] = mapped_column(String, default="")
    ward: Mapped[str] = mapped_column(String, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class AccessGrant(Base):
    __tablename__ = "access_grants"
    __table_args__ = (UniqueConstraint("user_id", "patient_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    consent_by: Mapped[str] = mapped_column(String, default="")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class LoginSession(Base):
    __tablename__ = "login_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    device: Mapped[str] = mapped_column(String)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class WearableDeviceCredential(Base):
    __tablename__ = "wearable_device_credentials"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, index=True)
    device_name: Mapped[str] = mapped_column(String, default="Android wearable companion")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Challenge(Base):
    __tablename__ = "auth_challenges"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    code_hash: Mapped[str] = mapped_column(String)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class CareRecord(Base):
    __tablename__ = "care_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    kind: Mapped[str] = mapped_column(String, index=True)
    author_id: Mapped[int] = mapped_column(Integer)
    author_name: Mapped[str] = mapped_column(String)
    author_role: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String, default="recorded")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    approved_by: Mapped[str | None] = mapped_column(String, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Alert(Base):
    __tablename__ = "care_alerts"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    severity: Mapped[str] = mapped_column(String)
    reason: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="open")
    assigned_to: Mapped[str] = mapped_column(String, default="Duty nurse")
    outcome: Mapped[str] = mapped_column(Text, default="")
    arrival_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Approval(Base):
    __tablename__ = "clinical_approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    kind: Mapped[str] = mapped_column(String)
    request: Mapped[str] = mapped_column(Text)
    draft: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String, default="sent")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    requested_by: Mapped[str] = mapped_column(String)
    reviewed_by: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    medication_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    patient_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    channel: Mapped[str] = mapped_column(String, default="in_app")
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="unread")
    external_id: Mapped[str] = mapped_column(String, default="")


class AuditChain(Base):
    __tablename__ = "audit_chain"
    id: Mapped[int] = mapped_column(primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    actor_id: Mapped[int] = mapped_column(Integer)
    actor_role: Mapped[str] = mapped_column(String)
    actor_name: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    patient_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    previous_hash: Mapped[str] = mapped_column(String)
    digest: Mapped[str] = mapped_column(String)


class ShareLink(Base):
    __tablename__ = "share_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"))
    token_hash: Mapped[str] = mapped_column(String, unique=True)
    kind: Mapped[str] = mapped_column(String)
    fields: Mapped[list] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(Integer)
    recipient: Mapped[str] = mapped_column(String, default="")


class LibraryItem(Base):
    __tablename__ = "approved_library"
    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String, unique=True)
    category: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    content: Mapped[dict] = mapped_column(JSON)
    source_url: Mapped[str] = mapped_column(String)
    approved_by: Mapped[str | None] = mapped_column(String, nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class DocumentGeometry(Base):
    __tablename__ = "document_geometry"
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), unique=True)
    pages: Mapped[list] = mapped_column(JSON, default=list)


class BulkImport(Base):
    __tablename__ = "bulk_imports"
    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[str] = mapped_column(String)
    author_id: Mapped[int] = mapped_column(Integer)
    file_path: Mapped[str] = mapped_column(String)
    pages: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, default="review")


class JobReceipt(Base):
    __tablename__ = "job_receipts"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String)
    detail: Mapped[str] = mapped_column(Text, default="")


class DocumentOwner(Base):
    __tablename__ = "document_owners"
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"),primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"),index=True)


class TreatingClinician(Base):
    __tablename__ = "treating_clinicians"
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"),primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"),index=True)
