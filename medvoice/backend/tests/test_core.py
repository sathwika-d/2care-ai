"""
Test suite for scheduling service and agent orchestration.
"""
import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


# ─── Scheduling Service Tests ─────────────────────────────────────────────────

def make_execute_result(scalar=None, all_rows=None):
    """Helper: build a mock execute result with sync scalar_one_or_none / all."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=scalar)
    result.all = MagicMock(return_value=all_rows or [])
    return result


class TestSchedulingConflicts:
    """Test double-booking prevention and conflict logic."""

    @pytest.mark.asyncio
    async def test_past_slot_rejected(self):
        """Cannot book appointments in the past."""
        from app.services.scheduling import SchedulingService
        mock_db = AsyncMock()

        past_slot = MagicMock()
        past_slot.is_booked = False
        past_slot.start_time = datetime.utcnow() - timedelta(hours=1)

        mock_db.execute = AsyncMock(return_value=make_execute_result(scalar=past_slot))

        svc = SchedulingService(mock_db)
        result = await svc.book_appointment(
            patient_id=str(uuid4()),
            doctor_id=str(uuid4()),
            slot_id=str(uuid4()),
        )
        assert result["success"] is False
        assert "past" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_already_booked_slot_returns_alternatives(self):
        """Booked slot returns alternatives instead of error."""
        from app.services.scheduling import SchedulingService
        mock_db = AsyncMock()

        booked_slot = MagicMock()
        booked_slot.is_booked = True
        booked_slot.start_time = datetime.utcnow() + timedelta(hours=2)

        mock_db.execute = AsyncMock(side_effect=[
            make_execute_result(scalar=booked_slot),   # slot fetch
            make_execute_result(all_rows=[]),           # find_alternative_slots inner query
        ])

        svc = SchedulingService(mock_db)
        result = await svc.book_appointment(
            patient_id=str(uuid4()),
            doctor_id=str(uuid4()),
            slot_id=str(uuid4()),
        )
        assert result["success"] is False
        assert result["error"] == "slot_already_booked"
        assert "alternatives" in result

    @pytest.mark.asyncio
    async def test_cancel_frees_slot(self):
        """Cancellation sets is_booked=False on the slot."""
        from app.services.scheduling import SchedulingService
        from app.models.db_models import AppointmentStatus
        mock_db = AsyncMock()

        slot = MagicMock()
        slot.is_booked = True
        slot.id = uuid4()

        appt = MagicMock()
        appt.status = AppointmentStatus.SCHEDULED
        appt.slot_id = slot.id
        appt.id = uuid4()

        mock_db.execute = AsyncMock(side_effect=[
            make_execute_result(scalar=appt),   # appointment fetch
            make_execute_result(scalar=slot),   # slot fetch
        ])
        mock_db.commit = AsyncMock()

        svc = SchedulingService(mock_db)
        result = await svc.cancel_appointment(str(appt.id), reason="Test")

        assert result["success"] is True
        assert slot.is_booked is False
        assert appt.status == AppointmentStatus.CANCELLED


# ─── Session Memory Tests ─────────────────────────────────────────────────────

class TestSessionMemory:
    """Test Redis session memory operations."""

    @pytest.mark.asyncio
    async def test_session_create_and_retrieve(self):
        """Session created can be retrieved."""
        import json
        mock_redis = AsyncMock()
        stored = {}

        async def mock_setex(key, ttl, value):
            stored[key] = value

        async def mock_get(key):
            return stored.get(key)

        async def mock_expire(key, ttl):
            pass

        mock_redis.setex = mock_setex
        mock_redis.get = mock_get
        mock_redis.expire = mock_expire

        from app.memory.session import SessionMemory
        mem = SessionMemory(mock_redis)

        session_id = await mem.create_session(patient_id="p1", language="hi")
        assert session_id is not None

        session = await mem.get_session(session_id)
        assert session is not None
        assert session["language"] == "hi"
        assert session["patient_id"] == "p1"

    @pytest.mark.asyncio
    async def test_conversation_history_capped_at_10(self):
        """History is capped at 10 turns to manage token budget."""
        import json
        stored = {}
        mock_redis = AsyncMock()

        async def mock_setex(key, ttl, value):
            stored[key] = value

        async def mock_get(key):
            return stored.get(key)

        async def mock_expire(key, ttl):
            pass

        mock_redis.setex = mock_setex
        mock_redis.get = mock_get
        mock_redis.expire = mock_expire

        from app.memory.session import SessionMemory
        mem = SessionMemory(mock_redis)
        session_id = await mem.create_session()

        # Add 15 turns
        for i in range(15):
            await mem.append_turn(session_id, "user", f"message {i}")

        session = await mem.get_session(session_id)
        assert len(session["conversation_history"]) <= 10

    @pytest.mark.asyncio
    async def test_pending_confirmation_lifecycle(self):
        """Pending confirmation can be set and cleared."""
        import json
        stored = {}
        mock_redis = AsyncMock()

        async def mock_setex(key, ttl, value):
            stored[key] = value

        async def mock_get(key):
            return stored.get(key)

        async def mock_expire(key, ttl):
            pass

        mock_redis.setex = mock_setex
        mock_redis.get = mock_get
        mock_redis.expire = mock_expire

        from app.memory.session import SessionMemory
        mem = SessionMemory(mock_redis)
        session_id = await mem.create_session()

        confirmation = {"type": "booking", "slot_id": "abc123", "doctor": "Dr. Sharma"}
        await mem.set_pending_confirmation(session_id, confirmation)

        session = await mem.get_session(session_id)
        assert session["pending_confirmation"] == confirmation

        await mem.clear_pending_confirmation(session_id)
        session = await mem.get_session(session_id)
        assert session["pending_confirmation"] is None


# ─── Language Detection Tests ─────────────────────────────────────────────────

class TestLanguageDetection:
    def test_hindi_detection(self):
        from app.agents.orchestrator import MedVoiceAgent
        agent = MedVoiceAgent(None, None, None)
        result = agent._detect_language("मुझे कार्डियोलॉजिस्ट से अपॉइंटमेंट चाहिए")
        assert result == "hi"

    def test_english_detection(self):
        from app.agents.orchestrator import MedVoiceAgent
        agent = MedVoiceAgent(None, None, None)
        result = agent._detect_language("I would like to book an appointment with a doctor")
        assert result == "en"

    def test_fallback_on_short_text(self):
        from app.agents.orchestrator import MedVoiceAgent
        agent = MedVoiceAgent(None, None, None)
        # Should not raise even on gibberish
        result = agent._detect_language("x")
        assert result in ["en", "hi", "ta"]


# ─── Latency Tests ────────────────────────────────────────────────────────────

class TestLatencyTracker:
    @pytest.mark.asyncio
    async def test_logs_under_target(self):
        mock_redis = AsyncMock()
        mock_redis.lpush = AsyncMock()
        mock_redis.expire = AsyncMock()
        mock_redis.ltrim = AsyncMock()

        from app.memory.session import LatencyTracker
        tracker = LatencyTracker(mock_redis)

        await tracker.log_latency(
            session_id="sess1",
            trace_id="trace1",
            breakdown={"stt_ms": 82, "llm_ms": 185, "tts_ms": 95, "tool_ms": 20}
        )

        # Should have called lpush twice (session + global)
        assert mock_redis.lpush.call_count == 2

    @pytest.mark.asyncio
    async def test_stats_calculation(self):
        import json
        mock_redis = AsyncMock()

        records = [
            json.dumps({"total_ms": 380, "breakdown": {}}),
            json.dumps({"total_ms": 420, "breakdown": {}}),
            json.dumps({"total_ms": 510, "breakdown": {}}),  # Over target
        ]
        mock_redis.lrange = AsyncMock(return_value=records)

        from app.memory.session import LatencyTracker
        tracker = LatencyTracker(mock_redis)
        stats = await tracker.get_latency_stats()

        assert stats["count"] == 3
        assert stats["p50_ms"] == 420
        assert round(stats["under_target_pct"]) == 67  # 2 out of 3
