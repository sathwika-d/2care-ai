"""
Scheduling service: core appointment logic with conflict prevention.
"""
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID
import structlog
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from app.models.db_models import (
    Appointment, AvailabilitySlot, Doctor, Patient,
    AppointmentStatus, InteractionLog, CampaignRecord
)

logger = structlog.get_logger()


class SchedulingService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_availability(
        self,
        doctor_name: Optional[str] = None,
        specialty: Optional[str] = None,
        preferred_date: Optional[str] = None,
        preferred_time: Optional[str] = None,
    ) -> dict:
        """Check available slots with conflict prevention."""
        query = select(AvailabilitySlot, Doctor).join(
            Doctor, AvailabilitySlot.doctor_id == Doctor.id
        ).where(
            AvailabilitySlot.is_booked == False,
            AvailabilitySlot.start_time > datetime.utcnow()
        )

        if doctor_name:
            query = query.where(Doctor.name.ilike(f"%{doctor_name}%"))
        if specialty:
            query = query.where(Doctor.specialty.ilike(f"%{specialty}%"))
        if preferred_date:
            try:
                target_date = datetime.strptime(preferred_date, "%Y-%m-%d")
                query = query.where(
                    and_(
                        AvailabilitySlot.start_time >= target_date,
                        AvailabilitySlot.start_time < target_date + timedelta(days=1)
                    )
                )
            except ValueError:
                pass

        query = query.order_by(AvailabilitySlot.start_time).limit(5)
        result = await self.db.execute(query)
        rows = result.all()

        slots = []
        for slot, doctor in rows:
            slots.append({
                "slot_id": str(slot.id),
                "doctor_id": str(doctor.id),
                "doctor_name": doctor.name,
                "specialty": doctor.specialty,
                "start_time": slot.start_time.isoformat(),
                "end_time": slot.end_time.isoformat(),
                "formatted": slot.start_time.strftime("%A, %B %d at %I:%M %p"),
            })

        return {
            "available": len(slots) > 0,
            "slots": slots,
            "count": len(slots)
        }

    async def book_appointment(
        self,
        patient_id: str,
        doctor_id: str,
        slot_id: str,
        notes: Optional[str] = None,
    ) -> dict:
        """Book an appointment with double-booking prevention."""
        # Fetch and lock the slot
        slot_result = await self.db.execute(
            select(AvailabilitySlot).where(
                AvailabilitySlot.id == UUID(slot_id)
            )
        )
        slot = slot_result.scalar_one_or_none()

        if not slot:
            return {"success": False, "error": "Slot not found"}

        if slot.is_booked:
            # Find alternatives
            alternatives = await self.find_alternative_slots(doctor_id=doctor_id)
            return {
                "success": False,
                "error": "slot_already_booked",
                "alternatives": alternatives.get("slots", [])
            }

        if slot.start_time <= datetime.utcnow():
            return {"success": False, "error": "Cannot book appointments in the past"}

        # Check patient doesn't already have appointment at this time
        conflict_check = await self.db.execute(
            select(Appointment).join(
                AvailabilitySlot, Appointment.slot_id == AvailabilitySlot.id
            ).where(
                Appointment.patient_id == UUID(patient_id),
                Appointment.status == AppointmentStatus.SCHEDULED,
                AvailabilitySlot.start_time == slot.start_time
            )
        )
        if conflict_check.scalar_one_or_none():
            return {"success": False, "error": "Patient already has an appointment at this time"}

        # Create appointment
        appointment = Appointment(
            patient_id=UUID(patient_id),
            doctor_id=UUID(doctor_id),
            slot_id=UUID(slot_id),
            scheduled_at=slot.start_time,
            notes=notes,
            booked_via="voice"
        )
        slot.is_booked = True

        self.db.add(appointment)
        await self.db.commit()
        await self.db.refresh(appointment)

        logger.info(
            "appointment_booked",
            appointment_id=str(appointment.id),
            patient_id=patient_id,
            scheduled_at=slot.start_time.isoformat()
        )

        return {
            "success": True,
            "appointment_id": str(appointment.id),
            "scheduled_at": slot.start_time.isoformat(),
            "formatted": slot.start_time.strftime("%A, %B %d at %I:%M %p"),
            "confirmation_code": str(appointment.id)[:8].upper()
        }

    async def reschedule_appointment(
        self,
        appointment_id: str,
        new_slot_id: str,
        reason: Optional[str] = None,
    ) -> dict:
        """Reschedule an existing appointment."""
        # Fetch existing appointment
        appt_result = await self.db.execute(
            select(Appointment).where(Appointment.id == UUID(appointment_id))
        )
        appointment = appt_result.scalar_one_or_none()

        if not appointment:
            return {"success": False, "error": "Appointment not found"}

        if appointment.status == AppointmentStatus.CANCELLED:
            return {"success": False, "error": "Cannot reschedule a cancelled appointment"}

        # Fetch and validate new slot
        slot_result = await self.db.execute(
            select(AvailabilitySlot).where(AvailabilitySlot.id == UUID(new_slot_id))
        )
        new_slot = slot_result.scalar_one_or_none()

        if not new_slot or new_slot.is_booked:
            return {"success": False, "error": "New slot unavailable"}

        if new_slot.start_time <= datetime.utcnow():
            return {"success": False, "error": "Cannot reschedule to past time"}

        # Release old slot
        if appointment.slot_id:
            old_slot_result = await self.db.execute(
                select(AvailabilitySlot).where(AvailabilitySlot.id == appointment.slot_id)
            )
            old_slot = old_slot_result.scalar_one_or_none()
            if old_slot:
                old_slot.is_booked = False

        # Update appointment
        appointment.slot_id = UUID(new_slot_id)
        appointment.scheduled_at = new_slot.start_time
        appointment.status = AppointmentStatus.RESCHEDULED
        appointment.notes = f"Rescheduled. Reason: {reason}" if reason else appointment.notes
        new_slot.is_booked = True

        await self.db.commit()

        return {
            "success": True,
            "appointment_id": appointment_id,
            "new_time": new_slot.start_time.isoformat(),
            "formatted": new_slot.start_time.strftime("%A, %B %d at %I:%M %p"),
        }

    async def cancel_appointment(
        self,
        appointment_id: str,
        reason: Optional[str] = None
    ) -> dict:
        """Cancel an appointment and free the slot."""
        appt_result = await self.db.execute(
            select(Appointment).where(Appointment.id == UUID(appointment_id))
        )
        appointment = appt_result.scalar_one_or_none()

        if not appointment:
            return {"success": False, "error": "Appointment not found"}

        if appointment.status == AppointmentStatus.CANCELLED:
            return {"success": False, "error": "Appointment already cancelled"}

        # Release slot
        if appointment.slot_id:
            slot_result = await self.db.execute(
                select(AvailabilitySlot).where(AvailabilitySlot.id == appointment.slot_id)
            )
            slot = slot_result.scalar_one_or_none()
            if slot:
                slot.is_booked = False

        appointment.status = AppointmentStatus.CANCELLED
        appointment.cancellation_reason = reason
        await self.db.commit()

        return {"success": True, "appointment_id": appointment_id}

    async def get_patient_history(self, patient_id: str, limit: int = 3) -> dict:
        """Get patient's past appointments and interactions."""
        appt_result = await self.db.execute(
            select(Appointment, Doctor).join(
                Doctor, Appointment.doctor_id == Doctor.id
            ).where(
                Appointment.patient_id == UUID(patient_id)
            ).order_by(Appointment.scheduled_at.desc()).limit(limit)
        )
        appointments = appt_result.all()

        history = []
        for appt, doctor in appointments:
            history.append({
                "appointment_id": str(appt.id),
                "doctor": doctor.name,
                "specialty": doctor.specialty,
                "date": appt.scheduled_at.strftime("%B %d, %Y"),
                "status": appt.status.value,
                "notes": appt.notes,
            })

        return {"appointments": history, "count": len(history)}

    async def get_upcoming_appointments(self, patient_id: str) -> dict:
        """Get patient's upcoming appointments."""
        result = await self.db.execute(
            select(Appointment, Doctor).join(
                Doctor, Appointment.doctor_id == Doctor.id
            ).where(
                Appointment.patient_id == UUID(patient_id),
                Appointment.status == AppointmentStatus.SCHEDULED,
                Appointment.scheduled_at > datetime.utcnow()
            ).order_by(Appointment.scheduled_at)
        )
        rows = result.all()

        upcoming = []
        for appt, doctor in rows:
            upcoming.append({
                "appointment_id": str(appt.id),
                "doctor": doctor.name,
                "specialty": doctor.specialty,
                "datetime": appt.scheduled_at.isoformat(),
                "formatted": appt.scheduled_at.strftime("%A, %B %d at %I:%M %p"),
            })

        return {"appointments": upcoming, "count": len(upcoming)}

    async def find_alternative_slots(
        self,
        doctor_id: Optional[str] = None,
        specialty: Optional[str] = None,
        date_range_start: Optional[str] = None,
        date_range_end: Optional[str] = None,
    ) -> dict:
        """Find alternative slots when the requested one is unavailable."""
        query = select(AvailabilitySlot, Doctor).join(
            Doctor, AvailabilitySlot.doctor_id == Doctor.id
        ).where(
            AvailabilitySlot.is_booked == False,
            AvailabilitySlot.start_time > datetime.utcnow()
        )

        if doctor_id:
            query = query.where(AvailabilitySlot.doctor_id == UUID(doctor_id))
        elif specialty:
            query = query.where(Doctor.specialty.ilike(f"%{specialty}%"))

        if date_range_start:
            try:
                start = datetime.strptime(date_range_start, "%Y-%m-%d")
                query = query.where(AvailabilitySlot.start_time >= start)
            except ValueError:
                pass

        if date_range_end:
            try:
                end = datetime.strptime(date_range_end, "%Y-%m-%d")
                query = query.where(AvailabilitySlot.start_time <= end)
            except ValueError:
                pass

        query = query.order_by(AvailabilitySlot.start_time).limit(3)
        result = await self.db.execute(query)
        rows = result.all()

        slots = []
        for slot, doctor in rows:
            slots.append({
                "slot_id": str(slot.id),
                "doctor_id": str(doctor.id),
                "doctor_name": doctor.name,
                "specialty": doctor.specialty,
                "formatted": slot.start_time.strftime("%A, %B %d at %I:%M %p"),
                "start_time": slot.start_time.isoformat(),
            })

        return {"slots": slots, "count": len(slots)}
