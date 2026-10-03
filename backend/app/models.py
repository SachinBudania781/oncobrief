"""Database tables. The patient ID ties every row and every file to one patient folder."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Meta(Base):
    __tablename__ = "meta"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String)


class Patient(Base):
    __tablename__ = "patients"
    id: Mapped[str] = mapped_column(String, primary_key=True)            # OB-2026-0001
    abha_id: Mapped[str | None] = mapped_column(String, nullable=True)   # optional, no Aadhaar stored
    name: Mapped[str] = mapped_column(String)
    sex: Mapped[str] = mapped_column(String)
    age: Mapped[int] = mapped_column(Integer)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    preferred_language: Mapped[str] = mapped_column(String, default="en")
    cancer_type: Mapped[str | None] = mapped_column(String, nullable=True)
    stage: Mapped[str | None] = mapped_column(String, nullable=True)
    diagnosis_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    treating_oncologist: Mapped[str | None] = mapped_column(String, nullable=True)
    current_regimen: Mapped[str | None] = mapped_column(String, nullable=True)
    referred_from: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    documents = relationship("Document", back_populates="patient", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    category: Mapped[str] = mapped_column(String, index=True)
    subtype: Mapped[str] = mapped_column(String)
    department: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    record_date: Mapped[datetime] = mapped_column(DateTime, index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    uploaded_by: Mapped[str] = mapped_column(String)
    source: Mapped[str] = mapped_column(String, default="staff")       # patient | staff | scanner | external
    external_hospital: Mapped[str | None] = mapped_column(String, nullable=True)
    file_path: Mapped[str] = mapped_column(String)
    mime: Mapped[str] = mapped_column(String)
    ocr_text: Mapped[str] = mapped_column(Text, default="")
    ocr_method: Mapped[str] = mapped_column(String, default="")         # pdf-text | tesseract | none
    ocr_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)

    patient = relationship("Patient", back_populates="documents")


class LabValue(Base):
    __tablename__ = "lab_values"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    test: Mapped[str] = mapped_column(String, index=True)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String)
    ref_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    ref_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    flag: Mapped[str] = mapped_column(String, default="")               # L | H | ""
    measured_at: Mapped[datetime] = mapped_column(DateTime)


class Medication(Base):
    __tablename__ = "medications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    name: Mapped[str] = mapped_column(String)
    dose: Mapped[str] = mapped_column(String)
    frequency: Mapped[str] = mapped_column(String)
    times: Mapped[list] = mapped_column(JSON, default=list)            # ["08:00", "20:00"]
    instructions: Mapped[str | None] = mapped_column(String, nullable=True)
    start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class MedLog(Base):
    __tablename__ = "med_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    medication_id: Mapped[int] = mapped_column(ForeignKey("medications.id"))
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String)                         # taken | missed
    logged_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class SymptomReport(Base):
    __tablename__ = "symptom_reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    reported_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    language: Mapped[str] = mapped_column(String, default="en")
    symptoms: Mapped[list] = mapped_column(JSON, default=list)          # [{"name": "Nausea", "grade": 2}]
    missed_meds: Mapped[list] = mapped_column(JSON, default=list)       # ["Ondansetron 8 mg"]
    free_text: Mapped[str] = mapped_column(Text, default="")
    flagged: Mapped[bool] = mapped_column(Boolean, default=False)


class Appointment(Base):
    __tablename__ = "appointments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    department: Mapped[str] = mapped_column(String, index=True)
    clinician: Mapped[str] = mapped_column(String)
    room: Mapped[str] = mapped_column(String)
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    end: Mapped[datetime] = mapped_column(DateTime)
    visit_type: Mapped[str] = mapped_column(String)                      # follow_up | new | transfer | procedure
    status: Mapped[str] = mapped_column(String, default="booked")
    notes: Mapped[str | None] = mapped_column(String, nullable=True)


class Activity(Base):
    __tablename__ = "activity"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    date: Mapped[datetime] = mapped_column(DateTime)
    steps: Mapped[int] = mapped_column(Integer)
    sleep_hours: Mapped[float] = mapped_column(Float)
    resting_hr: Mapped[int] = mapped_column(Integer)


class Brief(Base):
    __tablename__ = "briefs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(ForeignKey("patients.id"), index=True)
    visit_type: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    model: Mapped[str] = mapped_column(String)
    latency_ms: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict] = mapped_column(JSON)
    sources: Mapped[list] = mapped_column(JSON, default=list)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    actor_role: Mapped[str] = mapped_column(String)
    actor_name: Mapped[str] = mapped_column(String)
    action: Mapped[str] = mapped_column(String)
    patient_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    detail: Mapped[str] = mapped_column(String, default="")
