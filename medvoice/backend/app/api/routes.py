"""
REST API routes for appointments, patients, campaigns, and analytics.
"""
from datetime import datetime
from typing import Optional, List
from uuid import UUID
import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.models.db_models import (
    Patient, Doctor, Appointment, Campaign, CampaignRecord,
    AppointmentStatus, LanguageEnum
)
from app.memory.session import get_session_memory, get_latency_tracker
from app.core.database import get_db

logger = structlog.get_logger()
router = APIRouter()


# ─── Pydantic Schemas ───────────────────────────────────────────────────────

class PatientCreate(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    preferred_language: str = "en"

class AppointmentCreate(BaseModel):
    patient_id: str
    doctor_id: str
    slot_id: str
    notes: Optional[str] = None

class CampaignCreate(BaseModel):
    name: str
    campaign_type: str
    scheduled_at: datetime
    patient_ids: List[str]
    script_template: Optional[str] = None


# ─── Patients ────────────────────────────────────────────────────────────────

@router.get("/patients")
async def list_patients(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(20, le=100),
    offset: int = Query(0),
):
    result = await db.execute(
        select(Patient).order_by(Patient.created_at.desc()).limit(limit).offset(offset)
    )
    patients = result.scalars().all()
    return {
        "patients": [
            {
                "id": str(p.id),
                "name": p.name,
                "phone": p.phone,
                "email": p.email,
                "preferred_language": p.preferred_language,
                "created_at": p.created_at.isoformat(),
            }
            for p in patients
        ]
    }


@router.post("/patients")
async def create_patient(data: PatientCreate, db: AsyncSession = Depends(get_db)):
    patient = Patient(
        name=data.name,
        phone=data.phone,
        email=data.email,
        preferred_language=data.preferred_language,
    )
    db.add(patient)
    await db.commit()
    await db.refresh(patient)
    return {"id": str(patient.id), "name": patient.name}


@router.get("/patients/{patient_id}")
async def get_patient(patient_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Patient).where(Patient.id == UUID(patient_id)))
    patient = result.scalar_one_or_none()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")
    return {
        "id": str(patient.id),
        "name": patient.name,
        "phone": patient.phone,
        "email": patient.email,
        "preferred_language": patient.preferred_language,
        "medical_conditions": patient.medical_conditions,
        "preferences": patient.preferences,
    }


# ─── Doctors ─────────────────────────────────────────────────────────────────

@router.get("/doctors")
async def list_doctors(
    db: AsyncSession = Depends(get_db),
    specialty: Optional[str] = None,
):
    query = select(Doctor)
    if specialty:
        query = query.where(Doctor.specialty.ilike(f"%{specialty}%"))
    result = await db.execute(query)
    doctors = result.scalars().all()
    return {
        "doctors": [
            {
                "id": str(d.id),
                "name": d.name,
                "specialty": d.specialty,
                "languages": d.languages,
                "available_days": d.available_days,
            }
            for d in doctors
        ]
    }


# ─── Appointments ─────────────────────────────────────────────────────────────

@router.get("/appointments")
async def list_appointments(
    db: AsyncSession = Depends(get_db),
    patient_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(20, le=100),
):
    query = select(Appointment, Doctor, Patient).join(
        Doctor, Appointment.doctor_id == Doctor.id
    ).join(Patient, Appointment.patient_id == Patient.id)

    if patient_id:
        query = query.where(Appointment.patient_id == UUID(patient_id))
    if status:
        query = query.where(Appointment.status == status)

    query = query.order_by(Appointment.scheduled_at.desc()).limit(limit)
    result = await db.execute(query)
    rows = result.all()

    return {
        "appointments": [
            {
                "id": str(a.id),
                "patient": {"id": str(p.id), "name": p.name},
                "doctor": {"id": str(d.id), "name": d.name, "specialty": d.specialty},
                "scheduled_at": a.scheduled_at.isoformat(),
                "status": a.status.value,
                "notes": a.notes,
                "booked_via": a.booked_via,
                "created_at": a.created_at.isoformat(),
            }
            for a, d, p in rows
        ]
    }


# ─── Campaigns ────────────────────────────────────────────────────────────────

@router.get("/campaigns")
async def list_campaigns(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Campaign).order_by(Campaign.created_at.desc()))
    campaigns = result.scalars().all()
    return {
        "campaigns": [
            {
                "id": str(c.id),
                "name": c.name,
                "type": c.campaign_type,
                "status": c.status.value,
                "scheduled_at": c.scheduled_at.isoformat(),
                "patient_count": len(c.patient_ids or []),
                "created_at": c.created_at.isoformat(),
            }
            for c in campaigns
        ]
    }


@router.post("/campaigns")
async def create_campaign(data: CampaignCreate, db: AsyncSession = Depends(get_db)):
    campaign = Campaign(
        name=data.name,
        campaign_type=data.campaign_type,
        scheduled_at=data.scheduled_at,
        patient_ids=data.patient_ids,
        script_template=data.script_template,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)

    # Create individual campaign records
    for patient_id in data.patient_ids:
        record = CampaignRecord(
            campaign_id=campaign.id,
            patient_id=UUID(patient_id),
        )
        db.add(record)
    await db.commit()

    return {"id": str(campaign.id), "name": campaign.name, "patient_count": len(data.patient_ids)}


# ─── Analytics ────────────────────────────────────────────────────────────────

@router.get("/analytics/summary")
async def analytics_summary(db: AsyncSession = Depends(get_db)):
    total_appts = await db.execute(select(func.count(Appointment.id)))
    scheduled = await db.execute(
        select(func.count(Appointment.id)).where(Appointment.status == AppointmentStatus.SCHEDULED)
    )
    completed = await db.execute(
        select(func.count(Appointment.id)).where(Appointment.status == AppointmentStatus.COMPLETED)
    )
    cancelled = await db.execute(
        select(func.count(Appointment.id)).where(Appointment.status == AppointmentStatus.CANCELLED)
    )
    total_patients = await db.execute(select(func.count(Patient.id)))
    total_doctors = await db.execute(select(func.count(Doctor.id)))

    return {
        "appointments": {
            "total": total_appts.scalar(),
            "scheduled": scheduled.scalar(),
            "completed": completed.scalar(),
            "cancelled": cancelled.scalar(),
        },
        "patients": total_patients.scalar(),
        "doctors": total_doctors.scalar(),
    }


@router.get("/analytics/latency")
async def latency_stats():
    tracker = await get_latency_tracker()
    return await tracker.get_latency_stats()


@router.get("/analytics/sessions")
async def session_stats():
    memory = await get_session_memory()
    count = await memory.get_active_sessions_count()
    return {"active_sessions": count}
