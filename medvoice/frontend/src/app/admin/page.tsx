"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Activity, Users, Calendar, Clock, TrendingUp, Zap,
  PhoneCall, Globe, BarChart2, ArrowLeft, RefreshCw,
  CheckCircle, XCircle, AlertCircle, Layers
} from "lucide-react";
import Link from "next/link";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Mock data for demo (real data from /api/v1/analytics/*)
const MOCK_LATENCY_HISTORY = Array.from({ length: 24 }, (_, i) => ({
  time: `${i}:00`,
  p50: 340 + Math.random() * 80,
  p95: 480 + Math.random() * 120,
  target: 450,
}));

const MOCK_APPOINTMENTS = [
  { time: "Mon", booked: 24, cancelled: 3, completed: 18 },
  { time: "Tue", booked: 31, cancelled: 5, completed: 22 },
  { time: "Wed", booked: 28, cancelled: 2, completed: 25 },
  { time: "Thu", booked: 35, cancelled: 4, completed: 30 },
  { time: "Fri", booked: 42, cancelled: 6, completed: 38 },
  { time: "Sat", booked: 19, cancelled: 1, completed: 17 },
];

const MOCK_LANGUAGE_DIST = [
  { name: "English", value: 52, color: "#7c3aed" },
  { name: "Hindi", value: 31, color: "#4ade80" },
  { name: "Tamil", value: 17, color: "#f97316" },
];

const MOCK_CAMPAIGNS = [
  { name: "Morning Reminder Batch", type: "reminder", status: "completed", patients: 142, responses: 118, date: "Today 8:00 AM" },
  { name: "Post-Op Follow-up", type: "followup", status: "in_progress", patients: 23, responses: 11, date: "Today 2:00 PM" },
  { name: "Annual Checkup Drive", type: "checkup", status: "pending", patients: 380, responses: 0, date: "Tomorrow 9:00 AM" },
];

const MOCK_RECENT_CALLS = [
  { patient: "Raj Kumar", intent: "Book Appointment", outcome: "success", lang: "hi", latency: 388, time: "2 min ago" },
  { patient: "Pritha Suresh", intent: "Reschedule", outcome: "success", lang: "ta", latency: 412, time: "8 min ago" },
  { patient: "Aditya Menon", intent: "Cancel", outcome: "success", lang: "en", latency: 342, time: "15 min ago" },
  { patient: "Unknown", intent: "Check availability", outcome: "success", lang: "en", latency: 521, time: "22 min ago" },
  { patient: "Kavya Reddy", intent: "Book Appointment", outcome: "conflict", lang: "te", latency: 395, time: "31 min ago" },
];

export default function AdminPage() {
  const [summary, setSummary] = useState<any>(null);
  const [latencyStats, setLatencyStats] = useState<any>(null);
  const [activeSessions, setActiveSessions] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchStats = async () => {
    setLoading(true);
    try {
      const [sumRes, latRes, sessRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/analytics/summary`).catch(() => null),
        fetch(`${API_URL}/api/v1/analytics/latency`).catch(() => null),
        fetch(`${API_URL}/api/v1/analytics/sessions`).catch(() => null),
      ]);
      if (sumRes?.ok) setSummary(await sumRes.json());
      if (latRes?.ok) setLatencyStats(await latRes.json());
      if (sessRes?.ok) {
        const s = await sessRes.json();
        setActiveSessions(s.active_sessions || 0);
      }
    } catch {}
    setLoading(false);
    setLastRefresh(new Date());
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const stats = [
    {
      label: "Total Appointments",
      value: summary?.appointments?.total ?? "—",
      sub: `${summary?.appointments?.scheduled ?? 0} scheduled`,
      icon: Calendar,
      color: "neon",
      glow: "glow-neon",
    },
    {
      label: "Patients",
      value: summary?.patients ?? "—",
      sub: "registered",
      icon: Users,
      color: "sky",
      glow: "",
    },
    {
      label: "Active Sessions",
      value: activeSessions,
      sub: "right now",
      icon: Activity,
      color: "acid",
      glow: "glow-acid",
    },
    {
      label: "P50 Latency",
      value: latencyStats?.p50_ms ? `${Math.round(latencyStats.p50_ms)}ms` : "—",
      sub: latencyStats?.under_target_pct ? `${Math.round(latencyStats.under_target_pct)}% under 450ms` : "target: 450ms",
      icon: Zap,
      color: latencyStats?.p50_ms < 450 ? "acid" : "flame",
      glow: "",
    },
  ];

  return (
    <div className="min-h-screen bg-ink bg-grid-pattern bg-grid">
      {/* Header */}
      <header className="border-b border-border/50 px-6 py-4 flex items-center justify-between glass sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-muted hover:text-slate-300 transition-colors text-sm">
            <ArrowLeft className="w-4 h-4" />
            back
          </Link>
          <div className="w-px h-4 bg-border" />
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-neon/20 border border-neon/40 flex items-center justify-center">
              <BarChart2 className="w-3.5 h-3.5 text-neonsoft" />
            </div>
            <span className="font-display font-bold text-lg">
              Admin <span className="gradient-text">Dashboard</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted font-mono">
            refreshed {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs border border-border px-3 py-1.5 rounded-lg text-muted hover:text-slate-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            refresh
          </button>
        </div>
      </header>

      <main className="p-6 space-y-6 max-w-[1400px] mx-auto">
        {/* Stat Cards */}
        <div className="grid grid-cols-4 gap-4">
          {stats.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.07 }}
              className={`glass rounded-2xl p-5 border border-border hover:border-${s.color}/40 transition-all group ${s.glow}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-xl bg-${s.color}/10 border border-${s.color}/30 flex items-center justify-center`}>
                  <s.icon className={`w-4.5 h-4.5 text-${s.color}`} />
                </div>
              </div>
              <p className="font-display font-bold text-3xl text-slate-100">{s.value}</p>
              <p className="text-xs text-muted mt-1">{s.label}</p>
              <p className="text-[11px] text-muted/60 mt-0.5 font-mono">{s.sub}</p>
            </motion.div>
          ))}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-3 gap-4">
          {/* Appointments chart */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="col-span-2 glass rounded-2xl p-5 border border-border"
          >
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-display font-semibold text-slate-200">Appointments This Week</h3>
                <p className="text-xs text-muted mt-0.5">Booked, completed, and cancelled</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={MOCK_APPOINTMENTS} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a38" />
                <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 11, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: "#18181f", border: "1px solid #2a2a38", borderRadius: "12px", fontFamily: "JetBrains Mono", fontSize: 11 }}
                  labelStyle={{ color: "#a78bfa" }}
                  itemStyle={{ color: "#e2e8f0" }}
                />
                <Bar dataKey="booked" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                <Bar dataKey="completed" fill="#4ade80" radius={[4, 4, 0, 0]} />
                <Bar dataKey="cancelled" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-3 justify-center">
              {[["Booked", "#7c3aed"], ["Completed", "#4ade80"], ["Cancelled", "#f97316"]].map(([l, c]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c as string }} />
                  <span className="text-[11px] text-muted font-mono">{l}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Language distribution */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="glass rounded-2xl p-5 border border-border"
          >
            <h3 className="font-display font-semibold text-slate-200 mb-1">Language Usage</h3>
            <p className="text-xs text-muted mb-5">Across all sessions</p>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={MOCK_LANGUAGE_DIST}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {MOCK_LANGUAGE_DIST.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#18181f", border: "1px solid #2a2a38", borderRadius: "12px", fontFamily: "JetBrains Mono", fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-2">
              {MOCK_LANGUAGE_DIST.map(d => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                    <span className="text-xs text-muted">{d.name}</span>
                  </div>
                  <span className="text-xs font-mono text-slate-300">{d.value}%</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Latency Chart */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass rounded-2xl p-5 border border-border"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-display font-semibold text-slate-200">End-to-End Latency (24h)</h3>
              <p className="text-xs text-muted mt-0.5">P50 and P95 vs 450ms target</p>
            </div>
            <div className="flex items-center gap-3">
              {[["P50", "#7c3aed"], ["P95", "#f97316"], ["Target", "#4ade80"]].map(([l, c]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-0.5" style={{ background: c as string }} />
                  <span className="text-[11px] text-muted font-mono">{l}</span>
                </div>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={MOCK_LATENCY_HISTORY}>
              <defs>
                <linearGradient id="p50Gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="p95Gradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f97316" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a38" />
              <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "JetBrains Mono" }} axisLine={false} tickLine={false} unit="ms" />
              <Tooltip
                contentStyle={{ background: "#18181f", border: "1px solid #2a2a38", borderRadius: "12px", fontFamily: "JetBrains Mono", fontSize: 11 }}
                labelStyle={{ color: "#a78bfa" }}
              />
              <Area type="monotone" dataKey="target" stroke="#4ade80" strokeDasharray="4 4" strokeWidth={1.5} fill="none" dot={false} />
              <Area type="monotone" dataKey="p95" stroke="#f97316" strokeWidth={1.5} fill="url(#p95Gradient)" dot={false} />
              <Area type="monotone" dataKey="p50" stroke="#7c3aed" strokeWidth={2} fill="url(#p50Gradient)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Bottom Row: Campaigns + Recent Calls */}
        <div className="grid grid-cols-2 gap-4">
          {/* Campaigns */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="glass rounded-2xl p-5 border border-border"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display font-semibold text-slate-200">Outbound Campaigns</h3>
                <p className="text-xs text-muted mt-0.5">Scheduled & active</p>
              </div>
              <button className="text-xs border border-neon/40 text-neonsoft px-3 py-1.5 rounded-lg hover:bg-neon/10 transition-colors">
                + New
              </button>
            </div>
            <div className="space-y-3">
              {MOCK_CAMPAIGNS.map((c, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-surface rounded-xl border border-border">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    c.status === "completed" ? "bg-acid" :
                    c.status === "in_progress" ? "bg-neonsoft animate-pulse" :
                    "bg-muted"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{c.name}</p>
                    <p className="text-xs text-muted font-mono mt-0.5">{c.date}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-mono text-slate-300">
                      {c.responses}/{c.patients}
                    </p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                      c.status === "completed" ? "text-acid border-acid/30" :
                      c.status === "in_progress" ? "text-neonsoft border-neon/30" :
                      "text-muted border-border"
                    }`}>
                      {c.status.replace("_", " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Recent Calls */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="glass rounded-2xl p-5 border border-border"
          >
            <div className="mb-4">
              <h3 className="font-display font-semibold text-slate-200">Recent Voice Sessions</h3>
              <p className="text-xs text-muted mt-0.5">Last 5 completed calls</p>
            </div>
            <div className="space-y-2.5">
              {MOCK_RECENT_CALLS.map((call, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-surface rounded-xl border border-border">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    call.outcome === "success" ? "bg-acid/10 border border-acid/30" :
                    "bg-flame/10 border border-flame/30"
                  }`}>
                    {call.outcome === "success"
                      ? <CheckCircle className="w-3.5 h-3.5 text-acid" />
                      : <AlertCircle className="w-3.5 h-3.5 text-flame" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-slate-200 truncate">{call.patient}</p>
                      <span className="text-[10px] border border-border px-1.5 py-0.5 rounded text-muted font-mono uppercase">
                        {call.lang}
                      </span>
                    </div>
                    <p className="text-xs text-muted truncate mt-0.5">{call.intent}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-xs font-mono ${call.latency < 450 ? "text-acid" : "text-flame"}`}>
                      {call.latency}ms
                    </p>
                    <p className="text-[10px] text-muted/60 mt-0.5">{call.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Architecture Info */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="glass rounded-2xl p-5 border border-border"
        >
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-4 h-4 text-neonsoft" />
            <h3 className="font-display font-semibold text-slate-200">System Architecture</h3>
          </div>
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: "Voice Input", sublabel: "WebRTC / Phone", icon: "🎙️", color: "border-sky/40 bg-sky/5" },
              { label: "STT", sublabel: "Deepgram Nova-2", icon: "👂", color: "border-neon/40 bg-neon/5" },
              { label: "Agent", sublabel: "Claude + Tools", icon: "🤖", color: "border-neonsoft/40 bg-neonsoft/5" },
              { label: "Memory", sublabel: "Redis + Postgres", icon: "🧠", color: "border-acid/40 bg-acid/5" },
              { label: "TTS", sublabel: "ElevenLabs", icon: "🔊", color: "border-flame/40 bg-flame/5" },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center gap-2">
                <div className={`flex-1 rounded-xl border p-3 text-center ${step.color}`}>
                  <div className="text-2xl mb-1">{step.icon}</div>
                  <p className="text-xs font-display font-semibold text-slate-200">{step.label}</p>
                  <p className="text-[10px] text-muted font-mono mt-0.5">{step.sublabel}</p>
                </div>
                {i < 4 && (
                  <div className="text-muted text-lg flex-shrink-0">→</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-4 text-center">
            {[
              ["Outbound Campaigns", "Celery + Redis Queue"],
              ["Horizontal Scaling", "Stateless FastAPI + Redis Sessions"],
              ["Memory System", "L1: Redis TTL | L2: PostgreSQL"],
            ].map(([title, desc]) => (
              <div key={title}>
                <p className="text-xs font-display font-semibold text-slate-300">{title}</p>
                <p className="text-[11px] text-muted font-mono mt-0.5">{desc}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  );
}
