# 🎬 MedVoice — Loom Walkthrough Script (3 min)

## Segment 1: Live Demo (0:00 – 1:45)

### Setup (0:00 – 0:15)
- Open `docs/demo.html` in browser
- Click ⚙ API Key → enter Anthropic key → Save
- Show "connected" pill turning green

### Patient Switch (0:15 – 0:30)
- Show 3 demo patients on left sidebar
- Note language auto-detection for each
- Select **Raj Kumar** (Hindi patient)

### Hindi conversation (0:30 – 1:00)
- Click **Start Voice Call**
- Type: "कार्डियोलॉजिस्ट से अपॉइंटमेंट चाहिए"
- Show:
  - Language auto-detected → हिंदी chip activates
  - Typing indicator (wave bars)
  - Claude calls `check_availability` tool (visible in right panel)
  - Response in Hindi with available slots
  - Latency badge (e.g. 412ms) on message

### Book the appointment (1:00 – 1:20)
- Type: "पहला slot ठीक है"
- Show `book_appointment` tool call in Reasoning Trace panel
- Confirmation code displayed in response
- Intent updates to "BOOKING" in debug panel

### Cancel flow (1:20 – 1:45)
- Switch to **Aditya Menon** (English patient), start new call
- Type: "Cancel my upcoming appointment"
- Show `get_upcoming_appointments` → `cancel_appointment` tool chain
- Graceful confirmation response

---

## Segment 2: Architecture Walkthrough (1:45 – 2:45)

### Architecture diagram (1:45 – 2:05)
- Open `docs/architecture.svg`
- Walk through 4 layers top to bottom:
  1. **Client**: Next.js 14, WebSocket, Admin dashboard
  2. **Voice Pipeline**: STT (Deepgram) → Claude Agent → TTS (ElevenLabs)
  3. **Memory**: Redis (session, TTL 30min) + PostgreSQL (long-term)
  4. **Campaign Queue**: Celery Beat + Workers for outbound calls

### Latency breakdown (2:05 – 2:20)
- Point to right panel latency bars in demo
- Explain P50: 82 (STT) + 8 (ctx) + 185 (LLM) + 18 (tools) + 95 (TTS) = **388ms ✅**
- Mention Latency is logged per-request in `latency_logs` table

### Code quality highlights (2:20 – 2:45)
- Show `backend/app/agents/orchestrator.py` — agentic loop, not hardcoded
- Show `backend/app/memory/session.py` — two-level memory design
- Show `backend/tests/test_core.py` — test coverage on scheduling conflicts
- Show `backend/app/worker.py` — Celery campaign queue

---

## Segment 3: Wrap-up (2:45 – 3:00)
- "Full stack: Next.js 14 + FastAPI + Claude + Redis + PostgreSQL + Celery"
- "Sub-450ms target, genuine tool-calling, multilingual, production-grade"
- GitHub repo link
