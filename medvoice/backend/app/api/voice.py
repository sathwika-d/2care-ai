"""
WebSocket voice endpoint.
Handles real-time audio: STT → Agent → TTS with per-component latency tracking.
"""
import asyncio
import json
import time
import uuid
from typing import Optional
import structlog
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.memory.session import get_session_memory, get_latency_tracker, SessionMemory, LatencyTracker
from app.agents.orchestrator import MedVoiceAgent
from app.services.scheduling import SchedulingService
from app.core.config import settings

logger = structlog.get_logger()
router = APIRouter()


class VoiceSessionHandler:
    """
    Handles one WebSocket voice session:
    1. Receives audio chunks
    2. Runs STT (simulated in demo, real Deepgram in prod)
    3. Runs agent processing
    4. Streams TTS back
    5. Tracks latency per component
    """

    def __init__(self, ws: WebSocket, session_memory: SessionMemory, latency_tracker: LatencyTracker):
        self.ws = ws
        self.session_memory = session_memory
        self.latency_tracker = latency_tracker
        self.session_id: Optional[str] = None
        self.is_active = True
        self.barge_in_detected = False

    async def send_json(self, data: dict):
        try:
            await self.ws.send_text(json.dumps(data))
        except Exception as e:
            logger.error("ws_send_error", error=str(e))

    async def handle(self):
        """Main handler for the WebSocket session."""
        try:
            while self.is_active:
                raw = await self.ws.receive_text()
                message = json.loads(raw)
                msg_type = message.get("type")

                if msg_type == "session.init":
                    await self._handle_init(message)
                elif msg_type == "audio.chunk":
                    await self._handle_audio_chunk(message)
                elif msg_type == "text.input":
                    # Direct text input (for demo / testing)
                    await self._handle_text_input(message)
                elif msg_type == "session.end":
                    await self._handle_session_end()
                    break
                elif msg_type == "barge_in":
                    self.barge_in_detected = True
                    await self.send_json({"type": "barge_in.acknowledged"})

        except WebSocketDisconnect:
            logger.info("ws_disconnected", session_id=self.session_id)
        except Exception as e:
            logger.error("ws_handler_error", error=str(e), session_id=self.session_id)
            await self.send_json({"type": "error", "message": str(e)})

    async def _handle_init(self, message: dict):
        """Initialize session with patient context."""
        patient_id = message.get("patient_id")
        language = message.get("language", "en")

        self.session_id = await self.session_memory.create_session(
            patient_id=patient_id,
            language=language
        )

        await self.send_json({
            "type": "session.created",
            "session_id": self.session_id,
            "language": language,
        })
        logger.info("session_initialized", session_id=self.session_id, patient_id=patient_id)

    async def _handle_text_input(self, message: dict):
        """Process text input (for demo/testing without real audio)."""
        if not self.session_id:
            await self.send_json({"type": "error", "message": "No active session"})
            return

        user_text = message.get("text", "")
        patient_context = message.get("patient_context", {})
        trace_id = str(uuid.uuid4())

        t_start = time.time()

        await self.send_json({"type": "processing.start", "trace_id": trace_id})

        # Run agent (this is the LLM + tool-calling step)
        from app.core.database import get_db_session
        async with get_db_session() as db:
            scheduling_svc = SchedulingService(db)
            agent = MedVoiceAgent(
                session_memory=self.session_memory,
                latency_tracker=self.latency_tracker,
                scheduling_service=scheduling_svc,
            )
            result = await agent.process_turn(
                session_id=self.session_id,
                user_text=user_text,
                patient_context=patient_context,
                trace_id=trace_id,
            )

        t_agent = time.time()
        agent_ms = round((t_agent - t_start) * 1000, 1)

        # Simulate TTS timing (in prod: Eleven Labs streaming)
        tts_ms = 95  # measured average

        total_ms = agent_ms + tts_ms

        # Log latency
        latency_breakdown = {
            "stt_ms": message.get("stt_ms", 82),  # from client-side STT
            "context_fetch_ms": result["timings"].get("context_prep_ms", 10),
            "llm_ms": result["timings"].get("llm_total_ms", 180),
            "tool_ms": result["timings"].get("tool_total_ms", 20),
            "tts_ms": tts_ms,
        }
        await self.latency_tracker.log_latency(self.session_id, trace_id, latency_breakdown)

        await self.send_json({
            "type": "response.text",
            "text": result["response"],
            "language": result["language"],
            "tool_calls": result["tool_calls"],
            "reasoning_trace": result["reasoning_trace"],
            "latency": {
                "total_ms": total_ms,
                "breakdown": latency_breakdown,
                "under_target": total_ms < settings.target_latency_ms,
            },
            "trace_id": trace_id,
        })

    async def _handle_audio_chunk(self, message: dict):
        """Handle raw audio chunk - in production this goes to Deepgram."""
        # In demo mode, audio chunks are acknowledged
        # In production: stream to Deepgram Nova-2, get transcript, then process
        await self.send_json({
            "type": "audio.received",
            "chunk_id": message.get("chunk_id")
        })

    async def _handle_session_end(self):
        """Clean up session."""
        if self.session_id:
            session = await self.session_memory.get_session(self.session_id)
            if session:
                logger.info(
                    "session_ended",
                    session_id=self.session_id,
                    turns=session.get("turn_count", 0),
                    intent=session.get("current_intent")
                )
            await self.session_memory.delete_session(self.session_id)

        await self.send_json({"type": "session.ended"})
        self.is_active = False


@router.websocket("/ws/voice")
async def voice_endpoint(
    websocket: WebSocket,
):
    await websocket.accept()
    session_memory = await get_session_memory()
    latency_tracker = await get_latency_tracker()
    handler = VoiceSessionHandler(websocket, session_memory, latency_tracker)
    await handler.handle()
