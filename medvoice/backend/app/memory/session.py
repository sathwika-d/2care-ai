"""
Two-level memory system:
- L1: Redis (session context, TTL 30min)
- L2: PostgreSQL (long-term patient history)
"""
import json
import uuid
from datetime import datetime
from typing import Any, Optional
import redis.asyncio as redis
from app.core.config import settings
import structlog

logger = structlog.get_logger()


class SessionMemory:
    """Redis-backed session memory with TTL."""

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client
        self.ttl = settings.session_ttl_seconds

    def _key(self, session_id: str) -> str:
        return f"session:{session_id}"

    async def create_session(self, patient_id: Optional[str] = None, language: str = "en") -> str:
        session_id = str(uuid.uuid4())
        session_data = {
            "session_id": session_id,
            "patient_id": patient_id,
            "language": language,
            "current_intent": None,
            "pending_confirmation": None,
            "conversation_history": [],
            "reasoning_trace": [],
            "created_at": datetime.utcnow().isoformat(),
            "turn_count": 0,
        }
        await self.redis.setex(
            self._key(session_id),
            self.ttl,
            json.dumps(session_data)
        )
        logger.info("session_created", session_id=session_id, patient_id=patient_id)
        return session_id

    async def get_session(self, session_id: str) -> Optional[dict]:
        raw = await self.redis.get(self._key(session_id))
        if not raw:
            return None
        # Refresh TTL on access
        await self.redis.expire(self._key(session_id), self.ttl)
        return json.loads(raw)

    async def update_session(self, session_id: str, updates: dict) -> bool:
        session = await self.get_session(session_id)
        if not session:
            return False
        session.update(updates)
        session["updated_at"] = datetime.utcnow().isoformat()
        await self.redis.setex(
            self._key(session_id),
            self.ttl,
            json.dumps(session)
        )
        return True

    async def append_turn(self, session_id: str, role: str, content: str) -> bool:
        session = await self.get_session(session_id)
        if not session:
            return False
        history = session.get("conversation_history", [])
        history.append({
            "role": role,
            "content": content,
            "timestamp": datetime.utcnow().isoformat()
        })
        # Keep only last 10 turns to manage token budget
        if len(history) > 10:
            history = history[-10:]
        session["conversation_history"] = history
        session["turn_count"] = session.get("turn_count", 0) + 1
        await self.redis.setex(
            self._key(session_id),
            self.ttl,
            json.dumps(session)
        )
        return True

    async def append_reasoning(self, session_id: str, trace: dict) -> bool:
        session = await self.get_session(session_id)
        if not session:
            return False
        traces = session.get("reasoning_trace", [])
        traces.append({**trace, "timestamp": datetime.utcnow().isoformat()})
        session["reasoning_trace"] = traces[-20:]  # Keep last 20 traces
        await self.redis.setex(
            self._key(session_id),
            self.ttl,
            json.dumps(session)
        )
        return True

    async def set_pending_confirmation(self, session_id: str, confirmation: dict) -> bool:
        return await self.update_session(session_id, {"pending_confirmation": confirmation})

    async def clear_pending_confirmation(self, session_id: str) -> bool:
        return await self.update_session(session_id, {"pending_confirmation": None})

    async def delete_session(self, session_id: str) -> bool:
        await self.redis.delete(self._key(session_id))
        return True

    async def get_active_sessions_count(self) -> int:
        keys = await self.redis.keys("session:*")
        return len(keys)


class LatencyTracker:
    """Track and log per-request latency in Redis with rollup to PostgreSQL."""

    def __init__(self, redis_client: redis.Redis):
        self.redis = redis_client

    async def log_latency(self, session_id: str, trace_id: str, breakdown: dict) -> None:
        total = sum(v for v in breakdown.values() if isinstance(v, (int, float)))
        record = {
            "session_id": session_id,
            "trace_id": trace_id,
            "breakdown": breakdown,
            "total_ms": total,
            "under_target": total < settings.target_latency_ms,
            "timestamp": datetime.utcnow().isoformat()
        }
        # Store in Redis list for quick retrieval
        await self.redis.lpush(f"latency:{session_id}", json.dumps(record))
        await self.redis.expire(f"latency:{session_id}", 3600)

        # Also store in global stats
        await self.redis.lpush("latency:global", json.dumps(record))
        await self.redis.ltrim("latency:global", 0, 999)  # Keep last 1000

        if not record["under_target"]:
            logger.warning(
                "latency_over_target",
                total_ms=total,
                target_ms=settings.target_latency_ms,
                breakdown=breakdown
            )

    async def get_latency_stats(self) -> dict:
        raw_records = await self.redis.lrange("latency:global", 0, 99)
        records = [json.loads(r) for r in raw_records]
        if not records:
            return {"count": 0}

        totals = [r["total_ms"] for r in records]
        totals.sort()
        n = len(totals)
        return {
            "count": n,
            "p50_ms": totals[n // 2],
            "p95_ms": totals[int(n * 0.95)],
            "p99_ms": totals[int(n * 0.99)],
            "avg_ms": sum(totals) / n,
            "under_target_pct": len([t for t in totals if t < settings.target_latency_ms]) / n * 100,
        }


# Singleton instances
_redis_client: Optional[redis.Redis] = None


async def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


async def get_session_memory() -> SessionMemory:
    r = await get_redis()
    return SessionMemory(r)


async def get_latency_tracker() -> LatencyTracker:
    r = await get_redis()
    return LatencyTracker(r)
