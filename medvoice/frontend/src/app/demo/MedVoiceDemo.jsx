import { useState, useRef, useEffect, useCallback } from "react";

// ─── Mock Data ────────────────────────────────────────────────────────────────
const PATIENTS = [
  { id: "p1", name: "Raj Kumar", lang: "hi", avatar: "R", conditions: ["Hypertension", "Diabetes"] },
  { id: "p2", name: "Pritha Suresh", lang: "ta", avatar: "P", conditions: ["General Checkup"] },
  { id: "p3", name: "Aditya Menon", lang: "en", avatar: "A", conditions: ["Asthma"] },
];

const LANG_LABELS = { en: "English", hi: "हिंदी", ta: "தமிழ்" };
const LANG_FLAGS = { en: "🇬🇧", hi: "🇮🇳", ta: "🇮🇳" };

const DEMO_FLOWS = {
  p1: [
    {
      user: "डॉक्टर से मिलना है कल सुबह",
      thinking: ["Detecting language: Hindi ✓", "Intent: BOOK_APPOINTMENT", "Tool: check_availability(specialty=general, date=tomorrow, time=morning)"],
      tools: [{ name: "check_availability", ms: 18, result: "3 slots found" }],
      bot: "नमस्ते Raj जी! कल सुबह के लिए मुझे 3 स्लॉट मिले हैं:\n• Dr. Priya Sharma — 9:00 AM\n• Dr. Priya Sharma — 9:30 AM\n• Dr. Arjun Patel — 10:00 AM\nकौन सा समय आपके लिए ठीक रहेगा?",
      lang: "hi", latency: 388,
    },
    {
      user: "9 बजे वाला ठीक है",
      thinking: ["Intent: CONFIRM_SLOT", "Slot: Dr. Priya Sharma 9:00 AM", "Tool: book_appointment(patient=Raj Kumar, slot=9AM)"],
      tools: [{ name: "book_appointment", ms: 22, result: "Booked ✓ #A7F2B1" }],
      bot: "✅ अपॉइंटमेंट बुक हो गई!\n\nDr. Priya Sharma\nकल सुबह 9:00 AM\nConfirmation: #A7F2B1\n\nआपको एक रिमाइंडर भेजा जाएगा। कोई और मदद चाहिए?",
      lang: "hi", latency: 342,
    },
  ],
  p2: [
    {
      user: "I need to see a cardiologist next week",
      thinking: ["Language: English ✓", "Intent: BOOK_APPOINTMENT", "Tool: check_availability(specialty=cardiologist, range=next_week)"],
      tools: [{ name: "check_availability", ms: 16, result: "2 slots found" }],
      bot: "I found 2 slots with Dr. Rajan Nair (Cardiologist) next week:\n• Monday, June 2 at 10:00 AM\n• Wednesday, June 4 at 3:00 PM\n\nWhich works better for you?",
      lang: "en", latency: 371,
    },
    {
      user: "Wednesday please, and can I cancel my current appointment?",
      thinking: ["Multi-intent detected!", "Intent 1: BOOK_APPOINTMENT (Wed)", "Intent 2: CANCEL_EXISTING", "Tool: get_upcoming_appointments()", "Tool: book_appointment()", "Tool: cancel_appointment()"],
      tools: [
        { name: "get_upcoming_appointments", ms: 12, result: "1 upcoming found" },
        { name: "cancel_appointment", ms: 19, result: "Cancelled ✓" },
        { name: "book_appointment", ms: 24, result: "Booked ✓ #C9D3F4" },
      ],
      bot: "Done both! ✅\n\n❌ Cancelled: Dr. Sharma, Jun 1 (10:00 AM)\n✅ Booked: Dr. Rajan Nair, Wed Jun 4 at 3:00 PM\nConfirmation: #C9D3F4",
      lang: "en", latency: 419,
    },
  ],
  p3: [
    {
      user: "எனக்கு தோல் மருத்துவர் வேண்டும்",
      thinking: ["Language detected: Tamil ✓", "Intent: BOOK_APPOINTMENT", "Specialty: Dermatologist", "Tool: check_availability(specialty=dermatologist)"],
      tools: [{ name: "check_availability", ms: 21, result: "2 slots found" }],
      bot: "வணக்கம் Pritha! Dr. Meera Iyer (தோல் நிபுணர்) கிடைக்கிறார்:\n• வியாழன் Jun 5 — 11:00 AM\n• சனி Jun 7 — 10:30 AM\n\nஎந்த நேரம் வசதியாக இருக்கும்?",
      lang: "ta", latency: 401,
    },
  ],
};

const LATENCY_BREAKDOWN = { stt: 82, context: 8, llm: 185, tool: 20, tts: 95 };
const LATENCY_COLORS = { stt: "#38bdf8", context: "#a78bfa", llm: "#7c3aed", tool: "#4ade80", tts: "#f97316" };

// ─── Components ───────────────────────────────────────────────────────────────
function AudioWave({ active }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 20 }}>
      {[0.4, 0.8, 1.2, 1.0, 0.6, 1.4, 0.9, 0.5].map((h, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: active ? `${h * 14}px` : "4px",
            background: active ? "#7c3aed" : "#374151",
            borderRadius: 3,
            transition: `height ${0.2 + i * 0.05}s ease-in-out`,
            animation: active ? `wave ${0.8 + i * 0.1}s ease-in-out infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

function LatencyBar({ label, ms, maxMs = 200, color }) {
  const pct = Math.min(100, (ms / maxMs) * 100);
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace" }}>{label}</span>
        <span style={{ fontSize: 10, color, fontFamily: "monospace", fontWeight: 600 }}>{ms}ms</span>
      </div>
      <div style={{ height: 4, background: "#1f2937", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

function ThinkingPanel({ steps, visible }) {
  if (!visible || !steps?.length) return null;
  return (
    <div style={{
      background: "rgba(124,58,237,0.08)",
      border: "1px solid rgba(124,58,237,0.25)",
      borderRadius: 12,
      padding: "10px 14px",
      marginBottom: 8,
      maxWidth: 480,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a78bfa", animation: "pulse 1s infinite" }} />
        <span style={{ fontSize: 11, color: "#a78bfa", fontFamily: "monospace", fontWeight: 600 }}>reasoning trace</span>
      </div>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace", lineHeight: 1.6 }}>→</span>
          <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", lineHeight: 1.6 }}>{s}</span>
        </div>
      ))}
    </div>
  );
}

function ToolCallBadge({ tool }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.3)",
      borderRadius: 8, padding: "3px 8px", margin: "2px 2px 2px 0",
    }}>
      <span style={{ fontSize: 10, color: "#4ade80", fontFamily: "monospace" }}>⚙ {tool.name}</span>
      <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace" }}>{tool.ms}ms</span>
      <span style={{ fontSize: 10, color: "#4ade80", fontFamily: "monospace" }}>{tool.result}</span>
    </div>
  );
}

function MessageBubble({ msg, showTools }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start", marginBottom: 12 }}>
      {/* Tools used */}
      {!isUser && showTools && msg.tools?.length > 0 && (
        <div style={{ marginBottom: 6, maxWidth: 500 }}>
          {msg.tools.map((t, i) => <ToolCallBadge key={i} tool={t} />)}
        </div>
      )}
      <div style={{
        maxWidth: 480,
        background: isUser ? "rgba(124,58,237,0.2)" : "#18181f",
        border: isUser ? "1px solid rgba(124,58,237,0.4)" : "1px solid #2a2a38",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        padding: "10px 14px",
        fontSize: 13,
        color: "#e2e8f0",
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        fontFamily: "'DM Sans', sans-serif",
      }}>
        {msg.text}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        {msg.lang && !isUser && (
          <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "monospace" }}>
            {LANG_FLAGS[msg.lang]} {LANG_LABELS[msg.lang]}
          </span>
        )}
        {msg.latency && !isUser && (
          <span style={{
            fontSize: 10, fontFamily: "monospace", fontWeight: 600,
            color: msg.latency < 450 ? "#4ade80" : "#f97316",
            background: msg.latency < 450 ? "rgba(74,222,128,0.1)" : "rgba(249,115,22,0.1)",
            border: `1px solid ${msg.latency < 450 ? "rgba(74,222,128,0.3)" : "rgba(249,115,22,0.3)"}`,
            borderRadius: 6, padding: "1px 6px",
          }}>
            ⚡ {msg.latency}ms
          </span>
        )}
        <span style={{ fontSize: 10, color: "#374151", fontFamily: "monospace" }}>
          {msg.time}
        </span>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function MedVoiceDemo() {
  const [patient, setPatient] = useState(PATIENTS[0]);
  const [callState, setCallState] = useState("idle"); // idle | active | processing | speaking
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [thinkingSteps, setThinkingSteps] = useState([]);
  const [showThinking, setShowThinking] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [flowIdx, setFlowIdx] = useState(0);
  const [latency, setLatency] = useState({});
  const [totalLatency, setTotalLatency] = useState(0);
  const [tab, setTab] = useState("voice"); // voice | admin | arch
  const [adminView, setAdminView] = useState("overview");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const flow = DEMO_FLOWS[patient.id] || [];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startCall = () => {
    setMessages([]);
    setFlowIdx(0);
    setCallState("active");
    setLatency({});
    setTotalLatency(0);
    const welcome = {
      id: Date.now(),
      role: "assistant",
      text: patient.lang === "hi"
        ? `नमस्ते ${patient.name}! मैं MedVoice हूं। आज मैं आपकी कैसे मदद कर सकता हूं?`
        : patient.lang === "ta"
        ? `வணக்கம் ${patient.name}! நான் MedVoice. இன்று உங்களுக்கு எப்படி உதவ முடியும்?`
        : `Hello ${patient.name}! I'm MedVoice. How can I help you today?`,
      lang: patient.lang,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    setMessages([welcome]);
  };

  const endCall = () => {
    setCallState("idle");
    setShowThinking(false);
  };

  const simulateResponse = useCallback(async (flowItem) => {
    if (!flowItem) return;

    // Show thinking
    setCallState("processing");
    setShowThinking(true);
    setThinkingSteps([]);

    for (let i = 0; i < flowItem.thinking.length; i++) {
      await new Promise(r => setTimeout(r, 280));
      setThinkingSteps(prev => [...prev, flowItem.thinking[i]]);
    }

    await new Promise(r => setTimeout(r, 400));
    setShowThinking(false);
    setCallState("speaking");

    // Animate latency bars
    const ld = {
      stt: 82, context: 8,
      llm: flowItem.latency - 82 - 8 - (flowItem.tools?.reduce((a, t) => a + t.ms, 0) || 0) - 95,
      tool: flowItem.tools?.reduce((a, t) => a + t.ms, 0) || 0,
      tts: 95,
    };
    setLatency(ld);
    setTotalLatency(flowItem.latency);

    setMessages(prev => [...prev, {
      id: Date.now(),
      role: "assistant",
      text: flowItem.bot,
      lang: flowItem.lang,
      latency: flowItem.latency,
      tools: flowItem.tools,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);

    await new Promise(r => setTimeout(r, 300));
    setCallState("active");
    setFlowIdx(prev => prev + 1);
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || callState !== "active") return;
    setInput("");

    // Add user message
    setMessages(prev => [...prev, {
      id: Date.now(),
      role: "user",
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    }]);

    // Use demo flow if available, else generic response
    const nextFlow = flow[flowIdx];
    if (nextFlow && text.toLowerCase().includes(nextFlow.user.slice(0, 6).toLowerCase())) {
      await simulateResponse(nextFlow);
    } else if (nextFlow) {
      await simulateResponse(nextFlow);
    } else {
      setCallState("processing");
      await new Promise(r => setTimeout(r, 1200));
      setCallState("active");
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: "assistant",
        text: "I understand. Is there anything else I can help you with regarding appointments?",
        lang: "en",
        latency: 358,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }]);
    }
  };

  const useDemoPrompt = () => {
    const next = flow[flowIdx];
    if (next) setInput(next.user);
  };

  const totalMs = Object.values(latency).reduce((a, b) => a + b, 0);

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "#0A0A0F",
      color: "#f1f5f9",
      fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes wave { 0% { transform: scaleY(0.4); } 100% { transform: scaleY(1.4); } }
        @keyframes slideUp { from { opacity:0; transform: translateY(12px); } to { opacity:1; transform: translateY(0); } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes ripple { 0% { transform: scale(1); opacity: 0.5; } 100% { transform: scale(2.5); opacity: 0; } }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #2a2a38; border-radius: 2px; }
        input:focus { outline: none; }
        button { cursor: pointer; border: none; }
      `}</style>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: "1px solid #1f2937",
        background: "rgba(17,17,24,0.95)",
        backdropFilter: "blur(16px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontSize: 14 }}>🎙️</span>
          </div>
          <span style={{ fontFamily: "Syne, sans-serif", fontWeight: 800, fontSize: 18, letterSpacing: "-0.5px" }}>
            Med<span style={{ background: "linear-gradient(135deg,#a78bfa,#4ade80)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Voice</span>
          </span>
          <span style={{ fontSize: 10, border: "1px solid #2a2a38", color: "#6b7280", padding: "2px 8px", borderRadius: 20, fontFamily: "JetBrains Mono, monospace" }}>
            2care.ai · v1.0
          </span>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", gap: 4, background: "#111118", border: "1px solid #2a2a38", borderRadius: 12, padding: 3 }}>
          {[["voice", "🎙️ Voice Agent"], ["admin", "📊 Analytics"], ["arch", "🏗️ Architecture"]].map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: "5px 12px", borderRadius: 9, fontSize: 12, fontWeight: 500,
              background: tab === t ? "#7c3aed" : "transparent",
              color: tab === t ? "#fff" : "#6b7280",
              transition: "all 0.2s",
              fontFamily: "'DM Sans', sans-serif",
            }}>{l}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontFamily: "JetBrains Mono", color: "#4ade80" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", animation: "pulse 2s infinite" }} />
            system online
          </div>
        </div>
      </div>

      {/* ── Voice Agent Tab ── */}
      {tab === "voice" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: "calc(100vh - 57px)" }}>
          {/* Left sidebar */}
          <div style={{ width: 260, borderRight: "1px solid #1f2937", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Patient selector */}
            <div style={{ padding: "16px 14px", borderBottom: "1px solid #1f2937" }}>
              <p style={{ fontSize: 10, color: "#6b7280", fontFamily: "JetBrains Mono", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Select Patient</p>
              {PATIENTS.map(p => (
                <button key={p.id} onClick={() => !callState.includes("active") && !callState.includes("processing") && (setPatient(p), setMessages([]), setFlowIdx(0))}
                  style={{
                    width: "100%", textAlign: "left", padding: "10px 10px", borderRadius: 12,
                    border: `1px solid ${patient.id === p.id ? "rgba(124,58,237,0.5)" : "#1f2937"}`,
                    background: patient.id === p.id ? "rgba(124,58,237,0.1)" : "transparent",
                    marginBottom: 6, transition: "all 0.2s",
                    cursor: (callState === "idle" || callState === "idle") ? "pointer" : "not-allowed",
                    opacity: callState !== "idle" && patient.id !== p.id ? 0.4 : 1,
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: 9,
                      background: "linear-gradient(135deg,rgba(124,58,237,0.3),rgba(74,222,128,0.2))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "Syne, sans-serif", fontWeight: 700, color: "#a78bfa", fontSize: 14,
                    }}>{p.avatar}</div>
                    <div>
                      <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 500 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>{LANG_FLAGS[p.lang]} {LANG_LABELS[p.lang]}</div>
                    </div>
                  </div>
                  {p.conditions.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                      {p.conditions.map(c => (
                        <span key={c} style={{ fontSize: 9, color: "#6b7280", border: "1px solid #2a2a38", borderRadius: 5, padding: "1px 5px", fontFamily: "JetBrains Mono" }}>{c}</span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Debug toggles */}
            <div style={{ padding: "12px 14px", borderBottom: "1px solid #1f2937" }}>
              <p style={{ fontSize: 10, color: "#6b7280", fontFamily: "JetBrains Mono", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>Debug Options</p>
              {[["showThinkingToggle", "Show Reasoning Trace", showThinking, () => setShowThinking(v => !v)],
                ["showToolsToggle", "Show Tool Calls", showTools, () => setShowTools(v => !v)]].map(([key, label, val, fn]) => (
                <div key={key as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{label as string}</span>
                  <button onClick={fn as any} style={{
                    width: 36, height: 20, borderRadius: 10, padding: "2px 3px",
                    background: val ? "#7c3aed" : "#2a2a38", transition: "all 0.2s",
                    display: "flex", alignItems: "center", justifyContent: val ? "flex-end" : "flex-start",
                  }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff" }} />
                  </button>
                </div>
              ))}
            </div>

            {/* Latency breakdown */}
            {totalMs > 0 && (
              <div style={{ padding: "12px 14px", flex: 1, overflow: "auto" }}>
                <p style={{ fontSize: 10, color: "#6b7280", fontFamily: "JetBrains Mono", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>⚡ Latency</p>
                {Object.entries(latency).map(([k, v]) => (
                  <LatencyBar key={k} label={k} ms={v as number} maxMs={200} color={LATENCY_COLORS[k] || "#6b7280"} />
                ))}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1f2937", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "JetBrains Mono" }}>Total</span>
                  <span style={{
                    fontSize: 12, fontFamily: "JetBrains Mono", fontWeight: 700,
                    color: totalMs < 450 ? "#4ade80" : "#f97316",
                  }}>{totalMs}ms {totalMs < 450 ? "✓" : "⚠"}</span>
                </div>
                <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}>
                  <span style={{ fontSize: 9, color: "#6b7280", fontFamily: "JetBrains Mono" }}>target: 450ms</span>
                </div>
              </div>
            )}
          </div>

          {/* Main conversation */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Status bar */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 16px", borderBottom: "1px solid #1f2937",
              background: "#111118",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: callState === "idle" ? "#374151" : callState === "processing" ? "#a78bfa" : callState === "speaking" ? "#f97316" : "#4ade80",
                  animation: callState !== "idle" ? "pulse 1.5s infinite" : "none",
                }} />
                <span style={{ fontSize: 11, color: "#6b7280", fontFamily: "JetBrains Mono" }}>
                  {callState === "idle" ? "no session" : callState === "processing" ? "agent thinking..." : callState === "speaking" ? "responding..." : "session active"}
                </span>
              </div>
              {callState !== "idle" && (
                <div style={{ fontSize: 11, color: "#6b7280", fontFamily: "JetBrains Mono" }}>
                  {LANG_FLAGS[patient.lang]} {LANG_LABELS[patient.lang]}
                </div>
              )}
            </div>

            {/* Messages area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px", display: "flex", flexDirection: "column" }}>
              {messages.length === 0 && callState === "idle" ? (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, textAlign: "center" }}>
                  <div style={{ position: "relative" }}>
                    <div style={{
                      width: 80, height: 80, borderRadius: "50%",
                      background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.3)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 32, animation: "float 4s ease-in-out infinite",
                    }}>🎙️</div>
                    <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "1px solid rgba(124,58,237,0.2)", animation: "ripple 2s ease-out infinite" }} />
                    <div style={{ position: "absolute", inset: -20, borderRadius: "50%", border: "1px solid rgba(124,58,237,0.1)", animation: "ripple 2s ease-out infinite 0.5s" }} />
                  </div>
                  <div>
                    <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 26, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.5px" }}>
                      Ready to <span style={{ background: "linear-gradient(135deg,#a78bfa,#4ade80)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>book?</span>
                    </h2>
                    <p style={{ fontSize: 13, color: "#6b7280", maxWidth: 340, lineHeight: 1.6 }}>
                      Real-time multilingual voice AI for clinical appointments. Select a patient and start a call.
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["⚡ <450ms latency", "🌐 EN/HI/TA", "🤖 Claude tools"].map(f => (
                      <span key={f} style={{ fontSize: 11, color: "#6b7280", border: "1px solid #2a2a38", borderRadius: 20, padding: "4px 10px" }}>{f}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <div key={msg.id} style={{ animation: "slideUp 0.25s ease-out" }}>
                      <MessageBubble msg={msg} showTools={showTools} />
                    </div>
                  ))}
                  {callState === "processing" && (
                    <div style={{ marginBottom: 12 }}>
                      {showThinking && <ThinkingPanel steps={thinkingSteps} visible={true} />}
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 8,
                        background: "#18181f", border: "1px solid #2a2a38", borderRadius: "16px 16px 16px 4px",
                        padding: "10px 14px",
                      }}>
                        <AudioWave active={true} />
                      </div>
                    </div>
                  )}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input area */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid #1f2937", background: "#0f0f16" }}>
              {callState === "idle" ? (
                <button onClick={startCall} style={{
                  width: "100%", padding: "14px", borderRadius: 14,
                  background: "#7c3aed", color: "#fff",
                  fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15,
                  transition: "all 0.2s", letterSpacing: "-0.3px",
                  boxShadow: "0 0 20px rgba(124,58,237,0.3)",
                }}>
                  📞 Start Voice Call with {patient.name}
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* Demo prompt hint */}
                  {flow[flowIdx] && callState === "active" && (
                    <button onClick={useDemoPrompt} style={{
                      textAlign: "left", padding: "8px 12px", borderRadius: 10,
                      background: "rgba(74,222,128,0.05)", border: "1px solid rgba(74,222,128,0.2)",
                      color: "#4ade80", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                      <span style={{ fontSize: 10, color: "#6b7280" }}>💡 demo:</span>
                      {flow[flowIdx].user}
                    </button>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleSend()}
                      disabled={callState !== "active"}
                      placeholder={
                        callState === "processing" ? "Agent processing..." :
                        callState === "speaking" ? "Agent responding..." :
                        patient.lang === "hi" ? "यहां टाइप करें..." :
                        patient.lang === "ta" ? "இங்கே தட்டச்சு செய்யுங்கள்..." :
                        "Type or speak your message..."
                      }
                      style={{
                        flex: 1, padding: "10px 14px", borderRadius: 12, fontSize: 13,
                        background: "#18181f", border: "1px solid #2a2a38", color: "#e2e8f0",
                        fontFamily: "'DM Sans', sans-serif",
                        opacity: callState !== "active" ? 0.5 : 1,
                        transition: "border-color 0.2s",
                      }}
                      onFocus={e => e.target.style.borderColor = "rgba(124,58,237,0.5)"}
                      onBlur={e => e.target.style.borderColor = "#2a2a38"}
                    />
                    <button onClick={handleSend} disabled={!input.trim() || callState !== "active"}
                      style={{
                        padding: "10px 18px", borderRadius: 12, background: "#7c3aed",
                        color: "#fff", fontSize: 13, fontWeight: 500,
                        opacity: (!input.trim() || callState !== "active") ? 0.4 : 1,
                        transition: "all 0.2s",
                        fontFamily: "'DM Sans', sans-serif",
                      }}>Send</button>
                  </div>
                  <button onClick={endCall} style={{
                    padding: "8px", borderRadius: 10, border: "1px solid rgba(249,115,22,0.3)",
                    background: "transparent", color: "#f97316", fontSize: 12,
                    fontFamily: "'DM Sans', sans-serif",
                  }}>
                    📵 End Call
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Admin / Analytics Tab ── */}
      {tab === "admin" && (
        <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto", width: "100%" }}>
          <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 800, marginBottom: 20, letterSpacing: "-0.5px" }}>
            Admin <span style={{ background: "linear-gradient(135deg,#a78bfa,#4ade80)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Dashboard</span>
          </h2>

          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
            {[
              { label: "Total Appointments", value: "247", sub: "this month", icon: "📅", color: "#7c3aed" },
              { label: "Patients", value: "89", sub: "registered", icon: "👥", color: "#38bdf8" },
              { label: "Active Sessions", value: "3", sub: "right now", icon: "🔴", color: "#4ade80" },
              { label: "P50 Latency", value: "388ms", sub: "target: 450ms ✓", icon: "⚡", color: "#4ade80" },
            ].map((s, i) => (
              <div key={i} style={{
                background: "#111118", border: "1px solid #2a2a38", borderRadius: 16, padding: "16px 18px",
                transition: "border-color 0.2s",
              }}>
                <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontFamily: "Syne, sans-serif", fontSize: 28, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-1px" }}>{s.value}</div>
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>{s.label}</div>
                <div style={{ fontSize: 10, color: s.color, marginTop: 4, fontFamily: "JetBrains Mono" }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Latency pipeline visual */}
          <div style={{ background: "#111118", border: "1px solid #2a2a38", borderRadius: 16, padding: 20, marginBottom: 20 }}>
            <p style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 16 }}>End-to-End Latency Pipeline</p>
            <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 16 }}>
              {[
                { label: "STT", ms: 82, color: "#38bdf8", icon: "👂" },
                { label: "Context", ms: 8, color: "#a78bfa", icon: "🧠" },
                { label: "LLM", ms: 185, color: "#7c3aed", icon: "🤖" },
                { label: "Tools", ms: 20, color: "#4ade80", icon: "⚙️" },
                { label: "TTS", ms: 95, color: "#f97316", icon: "🔊" },
              ].map((step, i) => (
                <div key={step.label} style={{ display: "flex", alignItems: "center", flex: step.ms / 390 }}>
                  <div style={{
                    flex: 1, padding: "10px 8px", borderRadius: 8, textAlign: "center",
                    background: `${step.color}15`, border: `1px solid ${step.color}40`,
                    margin: "0 3px",
                  }}>
                    <div style={{ fontSize: 14 }}>{step.icon}</div>
                    <div style={{ fontSize: 10, color: step.color, fontFamily: "JetBrains Mono", fontWeight: 600 }}>{step.ms}ms</div>
                    <div style={{ fontSize: 9, color: "#6b7280", marginTop: 2 }}>{step.label}</div>
                  </div>
                  {i < 4 && <span style={{ color: "#374151", fontSize: 12 }}>→</span>}
                </div>
              ))}
            </div>
            <div style={{ height: 8, background: "#1f2937", borderRadius: 4, overflow: "hidden" }}>
              {[
                { color: "#38bdf8", pct: 21 },
                { color: "#a78bfa", pct: 2 },
                { color: "#7c3aed", pct: 47 },
                { color: "#4ade80", pct: 5 },
                { color: "#f97316", pct: 25 },
              ].map((s, i) => (
                <div key={i} style={{ display: "inline-block", width: `${s.pct}%`, height: "100%", background: s.color }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "JetBrains Mono" }}>0ms</span>
              <span style={{ fontSize: 11, color: "#4ade80", fontFamily: "JetBrains Mono", fontWeight: 700 }}>P50: 390ms ✓ (target: 450ms)</span>
              <span style={{ fontSize: 10, color: "#6b7280", fontFamily: "JetBrains Mono" }}>450ms</span>
            </div>
          </div>

          {/* Language + Campaign row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ background: "#111118", border: "1px solid #2a2a38", borderRadius: 16, padding: 18 }}>
              <p style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Language Distribution</p>
              {[["English", 52, "#7c3aed"], ["Hindi", 31, "#4ade80"], ["Tamil", 17, "#f97316"]].map(([lang, pct, color]) => (
                <div key={lang as string} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>{lang}</span>
                    <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: color as string, fontWeight: 600 }}>{pct}%</span>
                  </div>
                  <div style={{ height: 6, background: "#1f2937", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color as string, borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "#111118", border: "1px solid #2a2a38", borderRadius: 16, padding: 18 }}>
              <p style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Outbound Campaigns</p>
              {[
                { name: "Morning Reminders", status: "completed", resp: "118/142", color: "#4ade80" },
                { name: "Post-Op Follow-up", status: "running", resp: "11/23", color: "#a78bfa" },
                { name: "Annual Checkup", status: "scheduled", resp: "0/380", color: "#6b7280" },
              ].map(c => (
                <div key={c.name} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 10px", marginBottom: 6, borderRadius: 10,
                  background: "#0f0f16", border: "1px solid #1f2937",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, flexShrink: 0, animation: c.status === "running" ? "pulse 1.5s infinite" : "none" }} />
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>{c.name}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: c.color }}>{c.resp}</div>
                    <div style={{ fontSize: 9, color: "#6b7280" }}>{c.status}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Architecture Tab ── */}
      {tab === "arch" && (
        <div style={{ padding: 24, maxWidth: 900, margin: "0 auto", width: "100%" }}>
          <h2 style={{ fontFamily: "Syne, sans-serif", fontSize: 22, fontWeight: 800, marginBottom: 6, letterSpacing: "-0.5px" }}>
            System <span style={{ background: "linear-gradient(135deg,#a78bfa,#4ade80)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Architecture</span>
          </h2>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>Full-stack design for sub-450ms real-time multilingual voice AI</p>

          {[
            {
              title: "Voice Pipeline",
              color: "#38bdf8",
              items: [
                ["WebSocket", "Bidirectional real-time audio transport", "FastAPI WebSocket endpoint"],
                ["STT", "Deepgram Nova-2 streaming (≈82ms P50)", "Confidence threshold → Google fallback for Tamil"],
                ["VAD", "Voice Activity Detection for barge-in", "Interrupt mid-response without cutting off"],
                ["TTS", "ElevenLabs streaming (Indian voices)", "First audio chunk in ≈95ms"],
              ],
            },
            {
              title: "AI Agent",
              color: "#7c3aed",
              items: [
                ["LLM", "Claude claude-sonnet-4-20250514 with tool-calling", "9 tools: book, reschedule, cancel, check, alternatives..."],
                ["Prompting", "Multilingual system prompts (EN/HI/TA)", "Dynamic injection of patient context"],
                ["Reasoning", "Visible traces logged per turn", "Multi-intent detection in single utterance"],
                ["Conflict Check", "Double-booking + past-time prevention", "Automatic alternative slot suggestion"],
              ],
            },
            {
              title: "Memory System",
              color: "#4ade80",
              items: [
                ["L1 Session", "Redis Hash, TTL 30 min", "Active context: intent, history (last 10), pending confirmation"],
                ["L2 Long-term", "PostgreSQL", "Patient profile, appointment history, language preference"],
                ["Retrieval", "Last 3 summaries + upcoming injected into prompt", "Keeps tokens manageable, context relevant"],
                ["Latency", "Redis fetch ≈8ms", "Async SQLAlchemy for non-blocking DB access"],
              ],
            },
            {
              title: "Outbound Campaigns",
              color: "#f97316",
              items: [
                ["Queue", "Celery + Redis broker", "Background workers for campaign scheduling"],
                ["Beat", "Celery Beat for cron-style scheduling", "Daily reminders at 8 AM IST, 5-min polling"],
                ["Flow", "Campaign → CampaignRecord per patient", "Track response: confirmed/rescheduled/declined"],
                ["Scale", "Stateless workers, horizontal scaling ready", "Redis sessions enable any worker to handle any call"],
              ],
            },
          ].map(section => (
            <div key={section.title} style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 3, height: 18, borderRadius: 2, background: section.color }} />
                <h3 style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: section.color }}>{section.title}</h3>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {section.items.map(([label, desc, detail]) => (
                  <div key={label as string} style={{
                    background: "#111118", border: `1px solid ${section.color}20`,
                    borderLeft: `2px solid ${section.color}60`,
                    borderRadius: 10, padding: "10px 14px",
                  }}>
                    <div style={{ fontSize: 12, color: section.color, fontFamily: "JetBrains Mono", fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#e2e8f0", marginBottom: 4 }}>{desc}</div>
                    <div style={{ fontSize: 11, color: "#6b7280" }}>{detail}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Tech stack badges */}
          <div style={{ background: "#111118", border: "1px solid #2a2a38", borderRadius: 16, padding: 18 }}>
            <p style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>Tech Stack</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {[
                ["FastAPI", "#7c3aed"], ["Next.js 14", "#38bdf8"], ["TypeScript", "#38bdf8"],
                ["PostgreSQL", "#4ade80"], ["Redis", "#f97316"], ["Celery", "#f97316"],
                ["Claude claude-sonnet-4-20250514", "#a78bfa"], ["Deepgram Nova-2", "#38bdf8"],
                ["ElevenLabs", "#f97316"], ["SQLAlchemy Async", "#4ade80"],
                ["WebSockets", "#7c3aed"], ["Docker Compose", "#94a3b8"],
              ].map(([tech, color]) => (
                <span key={tech as string} style={{
                  fontSize: 11, fontFamily: "JetBrains Mono",
                  color: color as string, border: `1px solid ${color as string}40`,
                  borderRadius: 8, padding: "4px 10px", background: `${color as string}10`,
                }}>{tech}</span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
ENDOFFILE