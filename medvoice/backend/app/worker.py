"""
Celery worker for outbound campaign scheduling.
Background jobs pick up campaign tasks and initiate outbound voice calls.
"""
from celery import Celery
from celery.schedules import crontab
from datetime import datetime
import structlog

from app.core.config import settings

logger = structlog.get_logger()

celery_app = Celery(
    "medvoice",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.worker"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

# Beat schedule for recurring tasks
celery_app.conf.beat_schedule = {
    "process-pending-campaigns": {
        "task": "app.worker.process_pending_campaigns",
        "schedule": crontab(minute="*/5"),  # Every 5 minutes
    },
    "send-appointment-reminders": {
        "task": "app.worker.send_appointment_reminders",
        "schedule": crontab(hour="8", minute="0"),  # Daily at 8 AM IST
    },
    "cleanup-expired-sessions": {
        "task": "app.worker.cleanup_expired_sessions",
        "schedule": crontab(minute="*/30"),
    },
}


@celery_app.task(name="app.worker.process_pending_campaigns", bind=True, max_retries=3)
def process_pending_campaigns(self):
    """Process pending outbound campaigns."""
    import asyncio
    from sqlalchemy import select
    from app.models.db_models import Campaign, CampaignStatus
    from app.core.database import AsyncSessionLocal

    async def _run():
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Campaign).where(
                    Campaign.status == CampaignStatus.PENDING,
                    Campaign.scheduled_at <= datetime.utcnow()
                )
            )
            campaigns = result.scalars().all()

            for campaign in campaigns:
                logger.info("processing_campaign", campaign_id=str(campaign.id), name=campaign.name)
                # In production: initiate WebRTC/SIP calls to each patient
                # For demo: update status and log
                campaign.status = CampaignStatus.IN_PROGRESS
                await db.commit()

                # Queue individual call tasks
                for patient_id in (campaign.patient_ids or []):
                    initiate_outbound_call.delay(
                        campaign_id=str(campaign.id),
                        patient_id=patient_id,
                    )

    asyncio.get_event_loop().run_until_complete(_run())


@celery_app.task(name="app.worker.initiate_outbound_call", bind=True, max_retries=2)
def initiate_outbound_call(self, campaign_id: str, patient_id: str):
    """
    Initiate a single outbound call for a campaign.
    In production: Twilio/Vonage SIP, then connect to voice agent.
    """
    logger.info(
        "outbound_call_initiated",
        campaign_id=campaign_id,
        patient_id=patient_id
    )
    # Production flow:
    # 1. Fetch patient phone from DB
    # 2. Call Twilio API to initiate call
    # 3. On answer: connect WebSocket to voice agent
    # 4. Agent handles conversation with outbound script
    # 5. Log response to campaign_records
    return {"status": "initiated", "campaign_id": campaign_id, "patient_id": patient_id}


@celery_app.task(name="app.worker.send_appointment_reminders")
def send_appointment_reminders():
    """Send reminders for appointments in the next 24 hours."""
    import asyncio
    from sqlalchemy import select, and_
    from datetime import timedelta
    from app.models.db_models import Appointment, AppointmentStatus
    from app.core.database import AsyncSessionLocal

    async def _run():
        async with AsyncSessionLocal() as db:
            now = datetime.utcnow()
            tomorrow = now + timedelta(hours=24)

            result = await db.execute(
                select(Appointment).where(
                    and_(
                        Appointment.status == AppointmentStatus.SCHEDULED,
                        Appointment.scheduled_at.between(now, tomorrow)
                    )
                )
            )
            appointments = result.scalars().all()
            logger.info("reminder_batch", count=len(appointments))

            for appt in appointments:
                send_reminder.delay(str(appt.id))

    asyncio.get_event_loop().run_until_complete(_run())


@celery_app.task(name="app.worker.send_reminder")
def send_reminder(appointment_id: str):
    """Send individual appointment reminder (voice call)."""
    logger.info("reminder_sent", appointment_id=appointment_id)
    # Production: initiate outbound call with reminder script


@celery_app.task(name="app.worker.cleanup_expired_sessions")
def cleanup_expired_sessions():
    """Redis TTL handles this, but log metrics."""
    logger.info("session_cleanup_tick")
