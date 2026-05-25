from sqlalchemy import (
    Column, String, Integer, DateTime, Boolean, Text,
    ForeignKey, Float, Enum, JSON
)
from sqlalchemy.orm import relationship, DeclarativeBase
from sqlalchemy.dialects.postgresql import UUID
from datetime import datetime
import uuid
import enum


class Base(DeclarativeBase):
    pass


class LanguageEnum(str, enum.Enum):
    EN = "en"
    HI = "hi"
    TA = "ta"


class AppointmentStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    RESCHEDULED = "rescheduled"
    NO_SHOW = "no_show"


class CampaignStatus(str, enum.Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class Patient(Base):
    __tablename__ = "patients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    phone = Column(String(20), unique=True, nullable=False)
    email = Column(String(255), nullable=True)
    preferred_language = Column(Enum(LanguageEnum), default=LanguageEnum.EN)
    date_of_birth = Column(DateTime, nullable=True)
    medical_conditions = Column(JSON, default=list)
    preferences = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    appointments = relationship("Appointment", back_populates="patient")
    interactions = relationship("InteractionLog", back_populates="patient")


class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    specialty = Column(String(255), nullable=False)
    languages = Column(JSON, default=list)  # ["en", "hi", "ta"]
    available_days = Column(JSON, default=list)  # ["monday", "tuesday", ...]
    slot_duration_minutes = Column(Integer, default=30)
    created_at = Column(DateTime, default=datetime.utcnow)

    appointments = relationship("Appointment", back_populates="doctor")
    availability_slots = relationship("AvailabilitySlot", back_populates="doctor")


class AvailabilitySlot(Base):
    __tablename__ = "availability_slots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    doctor_id = Column(UUID(as_uuid=True), ForeignKey("doctors.id"), nullable=False)
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=False)
    is_booked = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    doctor = relationship("Doctor", back_populates="availability_slots")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    doctor_id = Column(UUID(as_uuid=True), ForeignKey("doctors.id"), nullable=False)
    slot_id = Column(UUID(as_uuid=True), ForeignKey("availability_slots.id"), nullable=True)
    scheduled_at = Column(DateTime, nullable=False)
    status = Column(Enum(AppointmentStatus), default=AppointmentStatus.SCHEDULED)
    notes = Column(Text, nullable=True)
    cancellation_reason = Column(Text, nullable=True)
    booked_via = Column(String(50), default="voice")  # voice | web | outbound
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    patient = relationship("Patient", back_populates="appointments")
    doctor = relationship("Doctor", back_populates="appointments")


class InteractionLog(Base):
    __tablename__ = "interaction_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=True)
    session_id = Column(String(255), nullable=False)
    language_used = Column(Enum(LanguageEnum), default=LanguageEnum.EN)
    intent_detected = Column(String(100), nullable=True)
    outcome = Column(String(100), nullable=True)
    summary = Column(Text, nullable=True)
    reasoning_trace = Column(JSON, default=list)
    total_latency_ms = Column(Integer, nullable=True)
    latency_breakdown = Column(JSON, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    patient = relationship("Patient", back_populates="interactions")


class Campaign(Base):
    __tablename__ = "campaigns"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    campaign_type = Column(String(100), nullable=False)  # reminder | followup | checkup
    scheduled_at = Column(DateTime, nullable=False)
    status = Column(Enum(CampaignStatus), default=CampaignStatus.PENDING)
    patient_ids = Column(JSON, default=list)
    script_template = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    records = relationship("CampaignRecord", back_populates="campaign")


class CampaignRecord(Base):
    __tablename__ = "campaign_records"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id = Column(UUID(as_uuid=True), ForeignKey("campaigns.id"), nullable=False)
    patient_id = Column(UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False)
    status = Column(Enum(CampaignStatus), default=CampaignStatus.PENDING)
    response = Column(String(100), nullable=True)  # confirmed | rescheduled | declined | no_answer
    notes = Column(Text, nullable=True)
    attempted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    campaign = relationship("Campaign", back_populates="records")


class LatencyLog(Base):
    __tablename__ = "latency_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(String(255), nullable=False)
    trace_id = Column(String(255), nullable=False)
    stt_ms = Column(Float, nullable=True)
    context_fetch_ms = Column(Float, nullable=True)
    llm_ms = Column(Float, nullable=True)
    tool_ms = Column(Float, nullable=True)
    tts_ms = Column(Float, nullable=True)
    total_ms = Column(Float, nullable=True)
    under_target = Column(Boolean, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
