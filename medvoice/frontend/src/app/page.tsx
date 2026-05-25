"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, PhoneCall, PhoneOff, Activity, Zap,
  Globe, Clock, ChevronRight, X, BarChart2, Cpu, Layers, AlertCircle
} from "lucide-react";
import { useVoiceWebSocket } from "@/lib/useVoiceWS";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  language?: string;
  latency?: { total_ms: number; breakdown: Record<string, number>; under_target: boolean };
  tool_calls?: any[];
  timestamp: Date;
};

type SessionState = "idle" | "connecting" | "active" | "processing" | "speaking";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  hi: "हिंदी",
  ta: "தமிழ்",
};

const DEMO_PATIENTS = [
  { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Raj Kumar", lang: "hi", conditions: ["Hypertension", "Diabetes"] },
  { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", name: "Pritha Suresh", lang: "ta", conditions: ["General Checkup"] },
  { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Aditya Menon", lang: "en", conditions: ["Asthma"] },
];

const QUICK_PROMPTS: Record<string, string[]> = {
  en: [
    "Book an appointment with a cardiologist",
    "Cancel my next appointment",
    "What appointments do I have?",
    "Reschedule to next week",
  ],
  hi: [
    "कार्डियोलॉजिस्ट से अपॉइंटमेंट बुक करें",
    "मेरी अगली अपॉइंटमेंट रद्द करें",
    "मेरी आने वाली अपॉइंटमेंट क्या हैं?",
  ],
  ta: [
    "இதய மருத்துவரிடம் சந்திப்பு பதிவு செய்யுங்கள்",
    "என் அடுத்த சந்திப்பை ரத்து செய்யுங்கள்",
    "என் வரவிருக்கும் சந்திப்புகள் என்ன?",
  ],
};

export default function HomePage() {
  const [sessionState, setSessionState] = useState<SessionState>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [selectedPatient, setSelectedPatient] = useState(DEMO_PATIENTS[0]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState("en");
  const [isRecording, setIsRecording] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [latencyStats, setLatencyStats] = useState<Record<string, number>>({});
  const [traceId, setTraceId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const addMessage = (msg: Omit<Message, "id" | "timestamp">) => {
    setMessages(prev => [...prev, { ...msg, id: crypto.randomUUID(), timestamp: new Date() }]);
  };

  const { connected, connect, disconnect, initSession, sendText, endSession } = useVoiceWebSocket({
    onMessage: (msg) => {
      if (msg.type === "session.created") {
        setSessionId(msg.session_id);
        setCurrentLanguage(msg.language);
        setSessionState("active");
        addMessage({
          role: "assistant",
          text: getWelcomeMessage(selectedPatient.lang),
          language: selectedPatient.lang,
        });
      } else if (msg.type === "processing.start") {
        setTraceId(msg.trace_id);
        setSessionState("processing");
      } else if (msg.type === "response.text") {
        setSessionState("speaking");
        addMessage({
          role: "assistant",
          text: msg.text,
          language: msg.language,
          latency: msg.latency,
          tool_calls: msg.tool_calls,
        });
        if (msg.latency) {
          setLatencyStats(msg.latency.breakdown);
        }
        setCurrentLanguage(msg.language);
        setTimeout(() => setSessionState("active"), 600);
      } else if (msg.type === "error") {
        setSessionState("active");
        addMessage({ role: "assistant", text: `⚠️ ${msg.message}` });
      } else if (msg.type === "session.ended") {
        setSessionState("idle");
        setSessionId(null);
      }
    },
    onOpen: () => setSessionState("connecting"),
    onClose: () => {
      setSessionState("idle");
      setSessionId(null);
    },
  });

  const getWelcomeMessage = (lang: string) => {
    const msgs: Record<string, string> = {
      en: `Hello ${selectedPatient.name}! I'm MedVoice, your AI health assistant. How can I help you today — would you like to book, reschedule, or check your appointments?`,
      hi: `नमस्ते ${selectedPatient.name}! मैं MedVoice हूं, आपका AI स्वास्थ्य सहायक। आज मैं आपकी कैसे मदद कर सकता हूं?`,
      ta: `வணக்கம் ${selectedPatient.name}! நான் MedVoice, உங்கள் AI சுகாதார உதவியாளர். இன்று உங்களுக்கு எப்படி உதவ முடியும்?`,
    };
    return msgs[lang] || msgs.en;
  };

  const startCall = () => {
    setMessages([]);
    setSessionState("connecting");
    connect();
    setTimeout(() => {
      initSession(selectedPatient.id, selectedPatient.lang);
    }, 300);
  };

  const endCall = () => {
    endSession();
    setTimeout(() => disconnect(), 500);
    setSessionState("idle");
    setSessionId(null);
  };

  const handleSend = () => {
    if (!inputText.trim() || sessionState !== "active") return;
    const text = inputText.trim();
    setInputText("");
    addMessage({ role: "user", text });
    setSessionState("processing");
    sendText(text, {
      patient_id: selectedPatient.id,
      patient_name: selectedPatient.name,
      conditions: selectedPatient.conditions,
    });
  };

  const handleQuickPrompt = (prompt: string) => {
    if (sessionState !== "active") return;
    addMessage({ role: "user", text: prompt });
    setSessionState("processing");
    sendText(prompt, {
      patient_id: selectedPatient.id,
      patient_name: selectedPatient.name,
    });
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const isCallActive = sessionState !== "idle";

  return (
    <div className="min-h-screen bg-ink bg-grid-pattern bg-grid flex flex-col">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center justify-between glass sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-neon/20 border border-neon/40 flex items-center justify-center">
            <Activity className="w-4 h-4 text-neonsoft" />
          </div>
          <span className="font-display font-bold text-xl tracking-tight">
            Med<span className="gradient-text">Voice</span>
          </span>
          <span className="text-xs text-muted border border-border px-2 py-0.5 rounded-full font-mono">
            v1.0
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-full border ${
            connected ? "border-acid/40 text-acid bg-acid/10" : "border-border text-muted"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-acid animate-pulse" : "bg-muted"}`} />
            {connected ? "connected" : "disconnected"}
          </div>

          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`text-xs font-mono px-3 py-1.5 rounded-full border transition-colors ${
              showDebug ? "border-neon/60 text-neonsoft bg-neon/10" : "border-border text-muted hover:border-border/80"
            }`}
          >
            <Cpu className="w-3.5 h-3.5 inline mr-1.5" />
            debug
          </button>

          <a href="/admin" className="text-xs font-mono text-muted hover:text-neonsoft transition-colors">
            admin →
          </a>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Patient & Language */}
        <aside className="w-72 border-r border-border/50 flex flex-col gap-0 overflow-y-auto">
          {/* Patient Selector */}
          <div className="p-5 border-b border-border/50">
            <p className="text-xs text-muted font-mono mb-3 uppercase tracking-widest">Patient</p>
            <div className="space-y-2">
              {DEMO_PATIENTS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => !isCallActive && setSelectedPatient(p)}
                  disabled={isCallActive}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedPatient.id === p.id
                      ? "border-neon/60 bg-neon/10 glow-neon"
                      : "border-border hover:border-border/80 bg-card/50"
                  } ${isCallActive ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-neon/30 to-acid/20 flex items-center justify-center text-sm font-display font-bold text-neonsoft">
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">{p.name}</p>
                      <p className="text-xs text-muted">{LANGUAGE_LABELS[p.lang]}</p>
                    </div>
                  </div>
                  {p.conditions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.conditions.map(c => (
                        <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-muted">
                          {c}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Language */}
          <div className="p-5 border-b border-border/50">
            <p className="text-xs text-muted font-mono mb-3 uppercase tracking-widest">Language</p>
            <div className="flex gap-2">
              {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
                <div
                  key={code}
                  className={`flex-1 text-center py-2 rounded-lg border text-xs font-medium transition-all ${
                    currentLanguage === code
                      ? "border-acid/50 text-acid bg-acid/10"
                      : "border-border text-muted"
                  }`}
                >
                  {label}
                </div>
              ))}
            </div>
            {isCallActive && (
              <p className="text-[11px] text-muted mt-2 text-center">
                Auto-detected from conversation
              </p>
            )}
          </div>

          {/* Quick Prompts */}
          {isCallActive && sessionState === "active" && (
            <div className="p-5">
              <p className="text-xs text-muted font-mono mb-3 uppercase tracking-widest">Quick Actions</p>
              <div className="space-y-2">
                {(QUICK_PROMPTS[currentLanguage] || QUICK_PROMPTS.en).map((p, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => handleQuickPrompt(p)}
                    className="w-full text-left text-xs p-2.5 rounded-lg border border-border hover:border-neon/50 hover:bg-neon/5 text-slate-300 hover:text-neonsoft transition-all flex items-center gap-2 group"
                  >
                    <ChevronRight className="w-3 h-3 text-muted group-hover:text-neonsoft flex-shrink-0" />
                    {p}
                  </motion.button>
                ))}
              </div>
            </div>
          )}

          {/* Latency Stats when debug active */}
          {showDebug && Object.keys(latencyStats).length > 0 && (
            <div className="p-5 mt-auto border-t border-border/50">
              <p className="text-xs text-muted font-mono mb-3 uppercase tracking-widest flex items-center gap-2">
                <BarChart2 className="w-3 h-3" /> Latency
              </p>
              <div className="space-y-1.5">
                {Object.entries(latencyStats).map(([key, val]) => (
                  <div key={key} className="flex justify-between items-center">
                    <span className="text-xs text-muted font-mono">{key.replace("_ms", "")}</span>
                    <span className={`text-xs font-mono font-medium ${
                      (val as number) > 200 ? "text-flame" : "text-acid"
                    }`}>{val}ms</span>
                  </div>
                ))}
                <div className="pt-1.5 mt-1.5 border-t border-border flex justify-between">
                  <span className="text-xs text-muted font-mono font-medium">total</span>
                  <span className={`text-xs font-mono font-bold ${
                    Object.values(latencyStats).reduce((a, b) => a + (b as number), 0) < 450
                      ? "text-acid" : "text-flame"
                  }`}>
                    {Object.values(latencyStats).reduce((a, b) => a + (b as number), 0)}ms
                  </span>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Voice Status Bar */}
          <div className="px-6 py-3 border-b border-border/50 flex items-center justify-between bg-surface/50">
            <div className="flex items-center gap-3">
              <StateIndicator state={sessionState} />
              <span className="text-xs text-muted font-mono">
                {sessionId ? `session: ${sessionId.slice(0, 8)}...` : "no active session"}
              </span>
            </div>
            {isCallActive && (
              <div className="flex items-center gap-2 text-xs text-muted font-mono">
                <Globe className="w-3.5 h-3.5" />
                {LANGUAGE_LABELS[currentLanguage]}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {messages.length === 0 && !isCallActive && (
              <div className="flex flex-col items-center justify-center h-full gap-6 text-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="relative"
                >
                  <div className="w-24 h-24 rounded-full bg-neon/10 border border-neon/30 flex items-center justify-center animate-float glow-neon">
                    <PhoneCall className="w-10 h-10 text-neonsoft" />
                  </div>
                  <div className="absolute -inset-4 rounded-full border border-neon/20 ripple" />
                  <div className="absolute -inset-8 rounded-full border border-neon/10 ripple" style={{ animationDelay: "0.5s" }} />
                </motion.div>
                <div>
                  <h2 className="font-display text-3xl font-bold text-slate-100 mb-2">
                    Ready to <span className="gradient-text">book?</span>
                  </h2>
                  <p className="text-muted text-sm max-w-sm">
                    Start a call to book, reschedule, or manage clinical appointments in English, Hindi, or Tamil.
                  </p>
                </div>
                <div className="flex gap-3 text-xs text-muted">
                  {["🎙️ Voice-first", "🌐 3 languages", "⚡ <450ms latency"].map(f => (
                    <span key={f} className="px-3 py-1.5 rounded-full border border-border bg-card/50">{f}</span>
                  ))}
                </div>
              </div>
            )}

            <AnimatePresence>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-lg bg-neon/20 border border-neon/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Activity className="w-4 h-4 text-neonsoft" />
                    </div>
                  )}
                  <div className={`max-w-[68%] space-y-1.5`}>
                    <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-neon/20 border border-neon/30 text-slate-100 rounded-br-sm"
                        : "bg-card border border-border text-slate-200 rounded-bl-sm"
                    }`}>
                      {msg.text}
                    </div>

                    {/* Metadata */}
                    <div className={`flex items-center gap-2 px-1 ${msg.role === "user" ? "justify-end" : ""}`}>
                      {msg.language && (
                        <span className="text-[10px] text-muted font-mono">
                          {LANGUAGE_LABELS[msg.language] || msg.language}
                        </span>
                      )}
                      {msg.latency && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                          msg.latency.under_target
                            ? "text-acid border-acid/30 bg-acid/10"
                            : "text-flame border-flame/30 bg-flame/10"
                        }`}>
                          <Zap className="w-2.5 h-2.5 inline mr-0.5" />
                          {msg.latency.total_ms}ms
                        </span>
                      )}
                      {msg.tool_calls && msg.tool_calls.length > 0 && showDebug && (
                        <span className="text-[10px] text-muted font-mono border border-border px-1.5 py-0.5 rounded">
                          {msg.tool_calls.length} tool{msg.tool_calls.length > 1 ? "s" : ""}
                        </span>
                      )}
                      <span className="text-[10px] text-muted/50">
                        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    {/* Tool calls debug */}
                    {showDebug && msg.tool_calls && msg.tool_calls.length > 0 && (
                      <div className="bg-surface border border-border rounded-xl p-3 space-y-1">
                        <p className="text-[10px] font-mono text-muted uppercase tracking-wider mb-2 flex items-center gap-1">
                          <Layers className="w-3 h-3" /> Tool Calls
                        </p>
                        {msg.tool_calls.map((tc, i) => (
                          <div key={i} className="text-[11px] font-mono">
                            <span className="text-neonsoft">{tc.tool}</span>
                            <span className="text-muted"> → </span>
                            <span className={tc.result?.success === false ? "text-flame" : "text-acid"}>
                              {tc.result?.success === false ? "failed" : tc.result?.error || "ok"}
                            </span>
                            <span className="text-muted ml-2">{tc.duration_ms}ms</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-lg bg-neon/10 border border-neon/30 flex items-center justify-center flex-shrink-0 mt-0.5 font-display font-bold text-sm text-neonsoft">
                      {selectedPatient.name.charAt(0)}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Processing indicator */}
            {sessionState === "processing" && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex gap-3 justify-start"
              >
                <div className="w-8 h-8 rounded-lg bg-neon/20 border border-neon/40 flex items-center justify-center flex-shrink-0">
                  <Activity className="w-4 h-4 text-neonsoft" />
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1">
                  <AudioBars />
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input + Controls */}
          <div className="border-t border-border/50 p-4 bg-surface/30">
            {!isCallActive ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={startCall}
                className="w-full py-4 rounded-2xl font-display font-bold text-lg bg-neon hover:bg-neon/90 text-white transition-all glow-neon flex items-center justify-center gap-3"
              >
                <PhoneCall className="w-5 h-5" />
                Start Voice Call
              </motion.button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSend()}
                    disabled={sessionState !== "active"}
                    placeholder={
                      sessionState === "processing" ? "Processing..." :
                      sessionState === "speaking" ? "Agent speaking..." :
                      currentLanguage === "hi" ? "यहां टाइप करें..." :
                      currentLanguage === "ta" ? "இங்கே தட்டச்சு செய்யுங்கள்..." :
                      "Type your message..."
                    }
                    className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-muted outline-none focus:border-neon/50 transition-colors disabled:opacity-50 font-body"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!inputText.trim() || sessionState !== "active"}
                    className="px-5 py-3 rounded-xl bg-neon hover:bg-neon/90 text-white text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => setIsRecording(!isRecording)}
                    className={`px-4 py-3 rounded-xl border transition-all ${
                      isRecording
                        ? "bg-flame/20 border-flame/50 text-flame glow-flame"
                        : "border-border text-muted hover:border-border/80"
                    }`}
                    title="Voice input (demo)"
                  >
                    {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={endCall}
                  className="w-full py-2.5 rounded-xl border border-flame/30 text-flame hover:bg-flame/10 text-sm font-medium transition-all flex items-center justify-center gap-2"
                >
                  <PhoneOff className="w-4 h-4" /> End Call
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right - Debug Panel */}
        <AnimatePresence>
          {showDebug && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 280, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-l border-border/50 overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-border/50 flex items-center justify-between">
                <span className="text-xs font-mono text-muted uppercase tracking-widest">Debug Panel</span>
                <button onClick={() => setShowDebug(false)}>
                  <X className="w-4 h-4 text-muted" />
                </button>
              </div>
              <div className="p-4 space-y-4 overflow-y-auto flex-1">
                <DebugSection title="Session">
                  <DebugRow label="ID" value={sessionId?.slice(0, 12) + "..." || "—"} />
                  <DebugRow label="State" value={sessionState} highlight />
                  <DebugRow label="Language" value={LANGUAGE_LABELS[currentLanguage]} />
                  <DebugRow label="Messages" value={String(messages.length)} />
                </DebugSection>

                <DebugSection title="Latency Target">
                  <div className="text-xs font-mono">
                    <div className="flex justify-between mb-1">
                      <span className="text-muted">target</span>
                      <span className="text-sky">450ms</span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-neon rounded-full transition-all"
                        style={{ width: `${Math.min(100, (Object.values(latencyStats).reduce((a: any, b: any) => a + b, 0) / 450) * 100)}%` }}
                      />
                    </div>
                  </div>
                </DebugSection>

                <DebugSection title="Architecture">
                  <div className="space-y-1.5 text-[11px] font-mono text-muted">
                    {[
                      ["STT", "Deepgram Nova-2"],
                      ["LLM", "Claude claude-sonnet-4-20250514"],
                      ["TTS", "ElevenLabs Stream"],
                      ["Memory", "Redis + Postgres"],
                      ["Queue", "Celery + Redis"],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-muted/70">{k}</span>
                        <span className="text-slate-400">{v}</span>
                      </div>
                    ))}
                  </div>
                </DebugSection>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function StateIndicator({ state }: { state: SessionState }) {
  const configs = {
    idle: { color: "bg-muted", label: "idle", pulse: false },
    connecting: { color: "bg-sky", label: "connecting...", pulse: true },
    active: { color: "bg-acid", label: "active", pulse: false },
    processing: { color: "bg-neonsoft", label: "processing", pulse: true },
    speaking: { color: "bg-flame", label: "speaking", pulse: true },
  };
  const { color, label, pulse } = configs[state];
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`} />
      <span className="text-xs font-mono text-muted">{label}</span>
    </div>
  );
}

function AudioBars() {
  return (
    <div className="flex items-center gap-0.5 h-5">
      {Array.from({ length: 8 }).map((_, i) => (
        <span key={i} className="audio-bar h-3" style={{ animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function DebugSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-mono text-muted uppercase tracking-widest mb-2">{title}</p>
      <div className="bg-surface rounded-xl border border-border p-3 space-y-1.5">
        {children}
      </div>
    </div>
  );
}

function DebugRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] font-mono text-muted/70">{label}</span>
      <span className={`text-[11px] font-mono ${highlight ? "text-neonsoft" : "text-slate-400"}`}>{value}</span>
    </div>
  );
}
