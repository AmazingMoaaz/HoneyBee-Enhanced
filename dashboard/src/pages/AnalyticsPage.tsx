import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "../api/client";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Legend,
} from "recharts";

/* ─── Palette ──────────────────────────────────────────── */
const PALETTE = [
  "#F59E0B", "#3B82F6", "#10B981", "#EF4444",
  "#8B5CF6", "#EC4899", "#14B8A6", "#F97316",
  "#06B6D4", "#84CC16",
];

const THREAT_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#3B82F6",
  "#10B981", "#8B5CF6", "#EC4899", "#14B8A6",
];

/* ─── Helpers ───────────────────────────────────────────── */
function fmtHour(bucket: string) {
  try { return new Date(bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return bucket; }
}

function threatLevel(rank: number): { label: string; bg: string; fg: string } {
  if (rank === 0) return { label: "CRITICAL", bg: "#FEF2F2", fg: "#DC2626" };
  if (rank <= 2)  return { label: "HIGH",     bg: "#FFF7ED", fg: "#EA580C" };
  if (rank <= 5)  return { label: "MEDIUM",   bg: "#FEFCE8", fg: "#CA8A04" };
  return             { label: "LOW",      bg: "#F0FDF4", fg: "#16A34A" };
}

/* ─── Custom Tooltip ────────────────────────────────────── */
function ChartTooltip({ active, payload, label, unit = "events" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(255,255,255,0.97)", backdropFilter: "blur(12px)",
      border: "1px solid rgba(15,23,42,0.09)", borderRadius: 12,
      padding: "10px 14px", boxShadow: "0 8px 24px rgba(15,23,42,0.12)",
      fontSize: 12,
    }}>
      {label && <p style={{ color: "#64748B", marginBottom: 6, fontWeight: 600, fontSize: 11 }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color || p.fill, flexShrink: 0 }} />
          <span style={{ color: "#0F172A", fontWeight: 600 }}>{p.value?.toLocaleString()}</span>
          <span style={{ color: "#94A3B8" }}>{p.name || unit}</span>
        </div>
      ))}
    </div>
  );
}

/* ─── Pie Custom Label ──────────────────────────────────── */
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, name }: any) {
  if ((percent ?? 0) < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central"
      style={{ fontSize: 10, fontWeight: 700, pointerEvents: "none" }}>
      {((percent ?? 0) * 100).toFixed(0)}%
    </text>
  );
}

/* ─── Stat Card ─────────────────────────────────────────── */
interface StatCardProps { label: string; value: any; sub?: string; icon: string; accent: string; accentBg: string; }
function StatCard({ label, value, sub, icon, accent, accentBg }: StatCardProps) {
  return (
    <div className="card card-hover" style={{ padding: "18px 20px", position: "relative", overflow: "hidden" }}>
      {/* Accent glow */}
      <div style={{
        position: "absolute", top: -20, right: -20, width: 80, height: 80,
        borderRadius: "50%", background: accentBg, filter: "blur(20px)", opacity: 0.6,
      }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94A3B8" }}>{label}</p>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: accentBg,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>
            {icon}
          </div>
        </div>
        <p style={{ fontSize: 28, fontWeight: 800, color: accent, lineHeight: 1, letterSpacing: "-0.02em" }}>
          {value?.toLocaleString() ?? "—"}
        </p>
        {sub && <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>{sub}</p>}
      </div>
    </div>
  );
}

/* ─── Section Header ────────────────────────────────────── */
function SectionHeader({ title, sub, accent = "#F59E0B" }: { title: string; sub?: string; accent?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 3, height: 16, borderRadius: 2, background: accent }} />
        <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "#475569" }}>{title}</p>
      </div>
      {sub && <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 3, marginLeft: 11 }}>{sub}</p>}
    </div>
  );
}

/* ─── Heatmap Grid ──────────────────────────────────────── */
function HeatmapGrid({ data }: { data: { hour: number; count: number }[] }) {
  const max = Math.max(...data.map(d => d.count), 1);
  const all = Array.from({ length: 24 }, (_, i) => {
    const found = data.find(d => d.hour === i);
    return { hour: i, count: found?.count ?? 0 };
  });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 3 }}>
        {all.map(({ hour, count }) => {
          const intensity = count / max;
          const alpha = 0.1 + intensity * 0.85;
          return (
            <div
              key={hour}
              title={`${hour}:00 — ${count.toLocaleString()} events`}
              style={{
                height: 36, borderRadius: 6,
                background: `rgba(139,92,246,${alpha})`,
                border: `1px solid rgba(139,92,246,${Math.min(alpha + 0.1, 1)})`,
                display: "flex", alignItems: "flex-end", justifyContent: "center",
                paddingBottom: 3, cursor: "default",
                transition: "transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = "scale(1.15)";
                (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px rgba(139,92,246,0.4)`;
                (e.currentTarget as HTMLElement).style.zIndex = "10";
                (e.currentTarget as HTMLElement).style.position = "relative";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.transform = "";
                (e.currentTarget as HTMLElement).style.boxShadow = "";
                (e.currentTarget as HTMLElement).style.zIndex = "";
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        {[0, 6, 12, 18, 23].map(h => (
          <span key={h} style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>{h}:00</span>
        ))}
      </div>
    </div>
  );
}

/* ─── Loading Skeleton ──────────────────────────────────── */
function Skeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div style={{ width: 120, height: 10, borderRadius: 6, background: "rgba(15,23,42,0.07)", marginBottom: 8 }} />
        <div style={{ width: 220, height: 22, borderRadius: 8, background: "rgba(15,23,42,0.09)", marginBottom: 6 }} />
        <div style={{ width: 180, height: 9, borderRadius: 5, background: "rgba(15,23,42,0.05)" }} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card" style={{ padding: "18px 20px", height: 96 }}>
            <div style={{ width: "60%", height: 9, borderRadius: 5, background: "rgba(15,23,42,0.07)", marginBottom: 12 }} />
            <div style={{ width: "40%", height: 22, borderRadius: 7, background: "rgba(15,23,42,0.09)" }} />
          </div>
        ))}
      </div>
      <div className="card" style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
export default function AnalyticsPage() {
  const [hours, setHours] = useState(24);

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["analytics", hours],
    queryFn: async () => (await api.get(`/analytics/overview?hours=${hours}`)).data,
    refetchInterval: 30000,
  });

  if (isLoading) return <Skeleton />;

  const timeline  = data?.timeline        ?? [];
  const byType    = data?.by_type         ?? [];
  const byIP      = data?.by_ip           ?? [];
  const byPort    = data?.by_port         ?? [];
  const byPot     = data?.by_pot          ?? [];
  const heatmap   = data?.hourly_heatmap  ?? [];
  const total     = data?.total_events    ?? 0;
  const maxPortCount = Math.max(...byPort.map((p: any) => p.count), 1);

  /* Radar data from byType */
  const radarData = byType.slice(0, 6).map((t: any) => ({
    subject: t.type,
    value: t.count,
    fullMark: Math.max(...byType.map((x: any) => x.count), 1),
  }));

  /* Last updated */
  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div className="space-y-7 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="page-label">Intelligence</p>
          <h1 className="page-title">Attack Analytics</h1>
          <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
            <span style={{ color: "#F59E0B", fontWeight: 700 }}>{total.toLocaleString()}</span> total events &nbsp;·&nbsp;
            <span style={{ color: "#EF4444", fontWeight: 700 }}>{data?.unique_ips ?? 0}</span> unique attackers &nbsp;·&nbsp;
            updated {lastUpdated}
          </p>
        </div>
        {/* Timeframe selector */}
        <div style={{ display: "flex", gap: 4, padding: "4px", background: "rgba(15,23,42,0.05)", borderRadius: 10 }}>
          {[
            { label: "6h",  value: 6 },
            { label: "24h", value: 24 },
            { label: "48h", value: 48 },
            { label: "7d",  value: 168 },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setHours(opt.value)}
              style={{
                padding: "5px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 700,
                background: hours === opt.value ? "#fff" : "transparent",
                color: hours === opt.value ? "#0F172A" : "#94A3B8",
                boxShadow: hours === opt.value ? "0 1px 4px rgba(15,23,42,0.10)" : "none",
                transition: "all 0.15s",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Total Events"   value={total}
          sub={`Last ${hours}h`}
          icon="⚡" accent="#F59E0B" accentBg="rgba(245,158,11,0.12)"
        />
        <StatCard
          label="Unique Attackers" value={data?.unique_ips}
          sub="Distinct source IPs"
          icon="🎯" accent="#EF4444" accentBg="rgba(239,68,68,0.10)"
        />
        <StatCard
          label="Attack Types"   value={byType.length}
          sub="Distinct event types"
          icon="🔬" accent="#3B82F6" accentBg="rgba(59,130,246,0.10)"
        />
        <StatCard
          label="Targeted Ports" value={byPort.length}
          sub="Exposed services"
          icon="🔌" accent="#10B981" accentBg="rgba(16,185,129,0.10)"
        />
      </div>

      {/* ── Timeline ────────────────────────────────────────── */}
      <div className="card" style={{ padding: "22px 24px" }}>
        <SectionHeader
          title={`Attack Timeline — Last ${hours}h`}
          sub="Events per time bucket"
        />
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="gradTimeline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#F59E0B" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradTimelineStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#FCD34D" />
                  <stop offset="100%" stopColor="#F97316" />
                </linearGradient>
                <filter id="glowTimeline">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.05)" vertical={false} />
              <XAxis
                dataKey="bucket" tickFormatter={fmtHour}
                tick={{ fontSize: 10, fill: "#94A3B8", fontWeight: 600 }} axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#94A3B8", fontWeight: 600 }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone" dataKey="count" name="Events"
                stroke="url(#gradTimelineStroke)"
                strokeWidth={2.5}
                fill="url(#gradTimeline)"
                dot={false}
                activeDot={{ r: 5, fill: "#F59E0B", stroke: "#fff", strokeWidth: 2 }}
                filter="url(#glowTimeline)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Donut + Radar ────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-5">

        {/* Donut — Event Types */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <SectionHeader title="Event Types Distribution" sub="Breakdown of captured attack patterns" accent="#3B82F6" />
          <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
            <div style={{ flex: "0 0 200px", height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <defs>
                    {byType.map((_: any, i: number) => (
                      <radialGradient key={i} id={`pieGrad${i}`} cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.6} />
                      </radialGradient>
                    ))}
                  </defs>
                  <Pie
                    data={byType} cx="50%" cy="50%"
                    innerRadius={55} outerRadius={88}
                    dataKey="count" nameKey="type"
                    stroke="none"
                    paddingAngle={2}
                    labelLine={false}
                    label={PieLabel}
                  >
                    {byType.map((_: any, i: number) => (
                      <Cell key={i} fill={`url(#pieGrad${i})`} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div style={{ flex: 1, paddingLeft: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {byType.map((t: any, i: number) => (
                <div key={t.type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: PALETTE[i % PALETTE.length], flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 11, color: "#475569", fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.type}
                  </span>
                  <span style={{ fontSize: 11, color: "#0F172A", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {t.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Radar — Attack Pattern */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <SectionHeader title="Attack Pattern Radar" sub="Relative intensity by event type" accent="#8B5CF6" />
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              {radarData.length >= 3 ? (
                <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                  <defs>
                    <radialGradient id="radarGrad" cx="50%" cy="50%" r="50%">
                      <stop offset="0%"   stopColor="#8B5CF6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.05} />
                    </radialGradient>
                  </defs>
                  <PolarGrid stroke="rgba(15,23,42,0.08)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#64748B", fontWeight: 600 }} />
                  <PolarRadiusAxis tick={false} axisLine={false} />
                  <Radar
                    name="Events" dataKey="value"
                    stroke="#8B5CF6" strokeWidth={2}
                    fill="url(#radarGrad)"
                    dot={{ r: 4, fill: "#8B5CF6", stroke: "#fff", strokeWidth: 1.5 }}
                  />
                  <Tooltip content={<ChartTooltip />} />
                </RadarChart>
              ) : (
                <BarChart data={byType} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.05)" vertical={false} />
                  <XAxis dataKey="type" tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Events">
                    {byType.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Ports + Honeypots ───────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-5">

        {/* Top Targeted Ports */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <SectionHeader title="Top Targeted Ports" sub="Most attacked services" accent="#3B82F6" />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {byPort.slice(0, 10).map((p: any, i: number) => {
              const pct = (p.count / maxPortCount) * 100;
              const color = THREAT_COLORS[Math.min(i, THREAT_COLORS.length - 1)];
              return (
                <div key={p.port}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontFamily: "monospace", fontSize: 12, fontWeight: 700,
                        background: `${color}18`, color, padding: "1px 7px", borderRadius: 5,
                      }}>
                        :{p.port}
                      </span>
                      <span style={{ fontSize: 11, color: "#64748B", fontWeight: 500 }}>
                        {portService(p.port)}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", fontVariantNumeric: "tabular-nums" }}>
                      {p.count.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 4, background: "rgba(15,23,42,0.06)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${color}cc, ${color})`,
                      transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Events by Honeypot */}
        <div className="card" style={{ padding: "22px 24px" }}>
          <SectionHeader title="Events by Honeypot" sub="Activity distribution across pots" accent="#10B981" />
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPot} margin={{ top: 4, right: 4, bottom: 4, left: -10 }}>
                <defs>
                  {byPot.map((_: any, i: number) => (
                    <linearGradient key={i} id={`potGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.55} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.05)" vertical={false} />
                <XAxis dataKey="pot_id" tick={{ fontSize: 10, fill: "#94A3B8", fontWeight: 600 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: "#94A3B8", fontWeight: 600 }} axisLine={false} tickLine={false}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Events" radius={[5, 5, 0, 0]}>
                  {byPot.map((_: any, i: number) => (
                    <Cell key={i} fill={`url(#potGrad${i})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Heatmap ──────────────────────────────────────────── */}
      <div className="card" style={{ padding: "22px 24px" }}>
        <SectionHeader title="Hourly Attack Heatmap" sub="Attack density by hour of day (last 30 days) — hover for details" accent="#8B5CF6" />
        {heatmap.length > 0
          ? <HeatmapGrid data={heatmap} />
          : <p style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", padding: "24px 0" }}>No heatmap data available</p>
        }
        {/* Scale legend */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>Low</span>
          <div style={{
            width: 80, height: 8, borderRadius: 4,
            background: "linear-gradient(90deg, rgba(139,92,246,0.15), rgba(139,92,246,0.95))",
          }} />
          <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>High</span>
        </div>
      </div>

      {/* ── Top Attacker IPs ─────────────────────────────────── */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{
          padding: "14px 22px", borderBottom: "1px solid rgba(15,23,42,0.06)",
          background: "linear-gradient(135deg, #FFFBEB, #FEF3C7)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>🎯</span>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", color: "#92400E" }}>
              Top Attacker IPs
            </p>
          </div>
          <div style={{
            background: "#F59E0B", color: "#fff", fontSize: 11, fontWeight: 800,
            padding: "2px 9px", borderRadius: 20,
          }}>
            {byIP.length}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["Rank", "Threat", "IP Address", "Attacks", "Share"].map(h => (
                  <th key={h} style={{
                    padding: "10px 18px", textAlign: "left",
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.09em", color: "#94A3B8",
                    borderBottom: "1px solid rgba(15,23,42,0.06)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {byIP.map((r: any, i: number) => {
                const threat = threatLevel(i);
                const pct = ((r.count / (total || 1)) * 100);
                return (
                  <tr key={r.ip} style={{ borderBottom: "1px solid rgba(15,23,42,0.04)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#FAFAFA"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
                  >
                    <td style={{ padding: "11px 18px", fontSize: 12, color: "#94A3B8", fontWeight: 700, fontFamily: "monospace" }}>
                      #{i + 1}
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 5,
                        background: threat.bg, color: threat.fg, letterSpacing: "0.05em",
                      }}>
                        {threat.label}
                      </span>
                    </td>
                    <td style={{ padding: "11px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: threat.fg, flexShrink: 0,
                          boxShadow: `0 0 6px ${threat.fg}88`,
                        }} />
                        <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#DC2626" }}>
                          {r.ip}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "11px 18px", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#0F172A" }}>
                      {r.count.toLocaleString()}
                    </td>
                    <td style={{ padding: "11px 18px", minWidth: 160 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(15,23,42,0.07)", overflow: "hidden" }}>
                          <div style={{
                            height: "100%", borderRadius: 3,
                            width: `${Math.min(pct, 100)}%`,
                            background: `linear-gradient(90deg, ${threat.fg}88, ${threat.fg})`,
                            transition: "width 0.6s",
                          }} />
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", minWidth: 38, fontVariantNumeric: "tabular-nums" }}>
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}

/* ─── Port service name helper ──────────────────────────── */
function portService(port: number): string {
  const known: Record<number, string> = {
    21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
    80: "HTTP", 110: "POP3", 143: "IMAP", 443: "HTTPS", 445: "SMB",
    1433: "MSSQL", 1521: "Oracle", 3306: "MySQL", 3389: "RDP",
    5432: "PostgreSQL", 5900: "VNC", 6379: "Redis", 8080: "HTTP-Alt",
    8443: "HTTPS-Alt", 27017: "MongoDB",
  };
  return known[port] ?? "";
}
