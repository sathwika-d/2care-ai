"""
Claude agent orchestrator: handles multi-turn tool-calling with reasoning traces.
"""
import time
import json
from typing import Optional, AsyncGenerator
import anthropic
import structlog
from langdetect import detect as langdetect

from app.core.config import settings
from app.tools.definitions import APPOINTMENT_TOOLS, SYSTEM_PROMPTS
from app.memory.session import SessionMemory, LatencyTracker
from app.services.scheduling import SchedulingService

logger = structlog.get_logger()

client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


class MedVoiceAgent:
    """
    Agentic orchestrator with:
    - Tool-calling via Claude
    - Reasoning trace logging
    - Multilingual system prompt injection
    - Latency tracking per component
    """

    def __init__(
        self,
        session_memory: SessionMemory,
        latency_tracker: LatencyTracker,
        scheduling_service: SchedulingService,
    ):
        self.memory = session_memory
        self.latency = latency_tracker
        self.scheduler = scheduling_service

    def _detect_language(self, text: str) -> str:
        """Detect language from text with fallback."""
        try:
            lang = langdetect(text)
            if lang in ["hi", "mr"]:  # Marathi often detected as Hindi
                return "hi"
            elif lang in ["ta"]:
                return "ta"
            else:
                return "en"
        except Exception:
            return "en"

    def _build_system_prompt(
        self,
        language: str,
        patient_context: dict,
        session: dict
    ) -> str:
        """Build multilingual system prompt with injected context."""
        lang = language if language in SYSTEM_PROMPTS else "en"
        template = SYSTEM_PROMPTS[lang]

        patient_ctx_str = json.dumps(patient_context, indent=2) if patient_context else "New patient, no history."
        session_ctx_str = (
            f"Turn #{session.get('turn_count', 0)}, "
            f"Current intent: {session.get('current_intent', 'unknown')}, "
            f"Pending confirmation: {session.get('pending_confirmation')}"
        )

        return template.format(
            patient_context=patient_ctx_str,
            session_context=session_ctx_str
        )

    async def _execute_tool(self, tool_name: str, tool_input: dict) -> dict:
        """Execute a tool call and return results."""
        logger.info("tool_call", tool=tool_name, input=tool_input)

        try:
            if tool_name == "check_availability":
                return await self.scheduler.check_availability(**tool_input)
            elif tool_name == "book_appointment":
                return await self.scheduler.book_appointment(**tool_input)
            elif tool_name == "reschedule_appointment":
                return await self.scheduler.reschedule_appointment(**tool_input)
            elif tool_name == "cancel_appointment":
                return await self.scheduler.cancel_appointment(**tool_input)
            elif tool_name == "get_patient_history":
                return await self.scheduler.get_patient_history(**tool_input)
            elif tool_name == "get_upcoming_appointments":
                return await self.scheduler.get_upcoming_appointments(**tool_input)
            elif tool_name == "find_alternative_slots":
                return await self.scheduler.find_alternative_slots(**tool_input)
            elif tool_name == "detect_and_set_language":
                detected = self._detect_language(tool_input.get("text_sample", ""))
                return {"detected_language": detected}
            elif tool_name == "log_campaign_response":
                # Would update campaign record in DB
                return {"success": True, "logged": True}
            else:
                return {"error": f"Unknown tool: {tool_name}"}
        except Exception as e:
            logger.error("tool_error", tool=tool_name, error=str(e))
            return {"error": str(e)}

    async def process_turn(
        self,
        session_id: str,
        user_text: str,
        patient_context: dict,
        trace_id: str,
    ) -> dict:
        """
        Process one conversation turn:
        1. Detect language
        2. Build messages with history
        3. Call Claude with tools
        4. Execute tool calls
        5. Get final response
        6. Log everything
        """
        timings = {}

        # Get session
        session = await self.memory.get_session(session_id)
        if not session:
            return {"error": "Session not found", "response": "I'm sorry, your session expired. Please call back."}

        # Language detection
        t0 = time.time()
        detected_lang = self._detect_language(user_text)
        if detected_lang != session.get("language", "en"):
            logger.info("language_switch", from_lang=session["language"], to_lang=detected_lang)
            await self.memory.update_session(session_id, {"language": detected_lang})
            session["language"] = detected_lang

        language = session.get("language", "en")

        # Build conversation messages
        history = session.get("conversation_history", [])
        messages = []
        for turn in history[-8:]:  # Last 8 turns for context window management
            messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": user_text})

        system_prompt = self._build_system_prompt(language, patient_context, session)

        # Save user turn
        await self.memory.append_turn(session_id, "user", user_text)

        # LLM call with tools
        t1 = time.time()
        timings["context_prep_ms"] = round((t1 - t0) * 1000, 1)

        reasoning_trace = []
        final_text = ""
        tool_calls_made = []

        # Agentic loop: keep calling until no more tools needed
        current_messages = messages.copy()
        max_iterations = 5

        for iteration in range(max_iterations):
            llm_start = time.time()

            response = await client.messages.create(
                model=settings.claude_model,
                max_tokens=settings.max_tokens,
                system=system_prompt,
                tools=APPOINTMENT_TOOLS,
                messages=current_messages,
            )

            timings[f"llm_call_{iteration}_ms"] = round((time.time() - llm_start) * 1000, 1)

            # Check stop reason
            if response.stop_reason == "end_turn":
                # Extract text response
                for block in response.content:
                    if hasattr(block, "text"):
                        final_text = block.text
                break

            elif response.stop_reason == "tool_use":
                # Process tool calls
                tool_results = []
                assistant_content = response.content

                for block in response.content:
                    if block.type == "tool_use":
                        tool_name = block.name
                        tool_input = block.input

                        tool_start = time.time()
                        result = await self._execute_tool(tool_name, tool_input)
                        tool_time = round((time.time() - tool_start) * 1000, 1)

                        tool_calls_made.append({
                            "tool": tool_name,
                            "input": tool_input,
                            "result": result,
                            "duration_ms": tool_time
                        })

                        reasoning_trace.append({
                            "action": f"tool_call:{tool_name}",
                            "input": tool_input,
                            "output": result,
                            "latency_ms": tool_time
                        })

                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps(result)
                        })

                        # Update pending confirmation if booking
                        if tool_name == "check_availability" and result.get("slots"):
                            await self.memory.set_pending_confirmation(
                                session_id,
                                {"type": "availability_shown", "slots": result["slots"]}
                            )

                        elif tool_name == "book_appointment" and result.get("success"):
                            await self.memory.update_session(session_id, {
                                "current_intent": "BOOKING_CONFIRMED",
                                "pending_confirmation": None
                            })
                            await self.memory.clear_pending_confirmation(session_id)

                # Add assistant's tool-use response and tool results to messages
                current_messages.append({"role": "assistant", "content": assistant_content})
                current_messages.append({"role": "user", "content": tool_results})

            else:
                # Unexpected stop reason
                final_text = "I apologize, I encountered an issue. Please try again."
                break

        timings["llm_total_ms"] = sum(
            v for k, v in timings.items() if k.startswith("llm_call_")
        )
        timings["tool_total_ms"] = sum(
            t.get("duration_ms", 0) for t in tool_calls_made
        )

        # Save reasoning trace
        if reasoning_trace:
            await self.memory.append_reasoning(session_id, {
                "turn": session.get("turn_count", 0),
                "actions": reasoning_trace
            })

        # Save assistant response
        if final_text:
            await self.memory.append_turn(session_id, "assistant", final_text)

        # Update session intent
        if tool_calls_made:
            last_tool = tool_calls_made[-1]["tool"]
            intent_map = {
                "book_appointment": "BOOKING",
                "reschedule_appointment": "RESCHEDULE",
                "cancel_appointment": "CANCELLATION",
                "check_availability": "CHECKING_AVAILABILITY",
            }
            await self.memory.update_session(
                session_id,
                {"current_intent": intent_map.get(last_tool, "GENERAL")}
            )

        return {
            "response": final_text,
            "language": language,
            "tool_calls": tool_calls_made,
            "reasoning_trace": reasoning_trace,
            "timings": timings,
        }
