import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import api from "../api/client";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import {
  FiZap, FiTarget, FiCpu, FiServer, FiShield,
  FiActivity, FiClock, FiTrendingUp,
} from "react-icons/fi";
import { HiOutlineGlobeAlt } from "react-icons/hi";
import { MdOutlineRadar } from "react-icons/md";
import { BsBarChartSteps } from "react-icons/bs";
import { RiFireLine } from "react-icons/ri";

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
interface StatCardProps {
  label: string; value: any; sub?: string;
  icon: React.ReactNode; accent: string; accentBg: string; trend?: string;
}
function StatCard({ label, value, sub, icon, accent, accentBg, trend }: StatCardProps) {
  return (
    <div style={{
      background: "#fff", borderRadius: 16, padding: "20px 22px",
      border: "1px solid rgba(15,23,42,0.07)",
      boxShadow: "0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)",
      position: "relative", overflow: "hidden",
      transition: "box-shadow 0.2s, transform 0.2s",
    }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 20px rgba(15,23,42,0.10), 0 0 0 1px ${accent}22`;
        (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(15,23,42,0.06), 0 4px 16px rgba(15,23,42,0.04)";
        (e.currentTarget as HTMLElement).style.transform = "";
      }}
    >
      <div style={{
        position: "absolute", top: -30, right: -30, width: 100, height: 100,
        borderRadius: "50%", background: accentBg, filter: "blur(28px)", opacity: 0.7,
        pointerEvents: "none",
      }} />
      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#94A3B8" }}>
            {label}
          </p>
          <div style={{
            width: 36, height: 36, borderRadius: 10, background: accentBg,
            display: "flex", alignItems: "center", justifyContent: "center", color: accent,
          }}>
            {icon}
          </div>
        </div>
        <p style={{ fontSize: 30, fontWeight: 800, color: "#0F172A", lineHeight: 1, letterSpacing: "-0.03em", marginBottom: 6 }}>
          {value?.toLocaleString() ?? "—"}
        </p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {sub && <p style={{ fontSize: 11, color: "#94A3B8" }}>{sub}</p>}
          {trend && (
            <span style={{ fontSize: 10, fontWeight: 700, color: accent, background: accentBg, padding: "2px 7px", borderRadius: 20 }}>
              {trend}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Section Header ────────────────────────────────────── */
function SectionHeader({
  title, sub, icon, accent = "#F59E0B",
}: { title: string; sub?: string; icon?: React.ReactNode; accent?: string }) {
  return (
    <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 10 }}>
      {icon && (
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: `${accent}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accent, flexShrink: 0, marginTop: 1,
        }}>{icon}</div>
      )}
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#0F172A", letterSpacing: "-0.01em" }}>{title}</p>
        {sub && <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{sub}</p>}
      </div>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 4 }}>
        {all.map(({ hour, count }) => {
          const intensity = count / max;
          const alpha = 0.08 + intensity * 0.88;
          return (
            <div
              key={hour}
              title={`${hour}:00 — ${count.toLocaleString()} events`}
              style={{
                height: 40, borderRadius: 7,
                background: `rgba(245,158,11,${alpha})`,
                border: `1px solid rgba(245,158,11,${Math.min(alpha + 0.12, 1)})`,
                cursor: "default",
                transition: "transform 0.15s, box-shadow 0.15s",
                position: "relative",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.transform = "scaleY(1.18)";
                (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px rgba(245,158,11,0.45)`;
                (e.currentTarget as HTMLElement).style.zIndex = "10";
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
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        {[0, 4, 8, 12, 16, 20, 23].map(h => (
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", border: "1px solid rgba(15,23,42,0.07)", height: 110 }}>
            <div style={{ width: "55%", height: 9, borderRadius: 5, background: "rgba(15,23,42,0.07)", marginBottom: 14 }} />
            <div style={{ width: "38%", height: 26, borderRadius: 7, background: "rgba(15,23,42,0.09)", marginBottom: 8 }} />
            <div style={{ width: "70%", height: 8, borderRadius: 5, background: "rgba(15,23,42,0.05)" }} />
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 16, height: 320, border: "1px solid rgba(15,23,42,0.07)", display: "flex", alignItems: "center", justifyContent: "center" }}>
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

  const timeline      = data?.timeline        ?? [];
  const byType        = data?.by_type         ?? [];
  const byIP          = data?.by_ip           ?? [];
  const byPort        = data?.by_port         ?? [];
  const byPot         = data?.by_pot          ?? [];
  const heatmap       = data?.hourly_heatmap  ?? [];
  const total         = data?.total_events    ?? 0;
  const maxPortCount  = Math.max(...byPort.map((p: any) => p.count), 1);

  const radarData = byType.slice(0, 6).map((t: any) => ({
    subject: t.type,
    value: t.count,
    fullMark: Math.max(...byType.map((x: any) => x.count), 1),
  }));

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }} className="animate-fade-in">

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9, background: "rgba(245,158,11,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#F59E0B",
            }}>
              <FiActivity size={16} />
            </div>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "#94A3B8" }}>
              Intelligence
            </p>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0F172A", letterSpacing: "-0.03em", lineHeight: 1.2 }}>
            Attack Analytics
          </h1>
          <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 5, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <FiZap size={11} color="#F59E0B" />
            <span><b style={{ color: "#F59E0B" }}>{total.toLocaleString()}</b> total events</span>
            <span style={{ color: "#CBD5E1" }}>·</span>
            <span><b style={{ color: "#EF4444" }}>{data?.unique_ips ?? 0}</b> unique attackers</span>
            <span style={{ color: "#CBD5E1" }}>·</span>
            <FiClock size={11} />
            <span>updated {lastUpdated}</span>
          </p>
        </div>

        {/* Timeframe pill selector */}
        <div style={{ display: "flex", gap: 3, padding: 4, background: "rgba(15,23,42,0.05)", borderRadius: 12 }}>
          {[
            { label: "6h", value: 6 },
            { label: "24h", value: 24 },
            { label: "48h", value: 48 },
            { label: "7d", value: 168 },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setHours(opt.value)}
              style={{
                padding: "6px 16px", borderRadius: 8, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: 700,
                background: hours === opt.value ? "#fff" : "transparent",
                color: hours === opt.value ? "#0F172A" : "#94A3B8",
                boxShadow: hours === opt.value ? "0 1px 6px rgba(15,23,42,0.12)" : "none",
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
          label="Total Events" value={total}
          sub={`Last ${hours}h window`}
          icon={<FiZap size={17} />}
          accent="#F59E0B" accentBg="rgba(245,158,11,0.12)"
          trend="Live"
        />
        <StatCard
          label="Unique Attackers" value={data?.unique_ips}
          sub="Distinct source IPs"
          icon={<FiTarget size={17} />}
          accent="#EF4444" accentBg="rgba(239,68,68,0.10)"
        />
        <StatCard
          label="Attack Types" value={byType.length}
          sub="Distinct event types"
          icon={<FiCpu size={17} />}
          accent="#3B82F6" accentBg="rgba(59,130,246,0.10)"
        />
        <StatCard
          label="Targeted Ports" value={byPort.length}
          sub="Exposed services"
          icon={<FiServer size={17} />}
          accent="#10B981" accentBg="rgba(16,185,129,0.10)"
        />
      </div>

      {/* ── Timeline ────────────────────────────────────────── */}
      <div style={{
        background: "#fff", borderRadius: 16, padding: "24px 26px",
        border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
      }}>
        <SectionHeader
          title={`Attack Timeline — Last ${hours}h`}
          sub="Events per time bucket — auto-refreshes every 30s"
          icon={<FiTrendingUp size={15} />}
          accent="#F59E0B"
        />
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="gradTimeline" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor="#F59E0B" stopOpacity={0.30} />
                  <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%"   stopColor="#FCD34D" />
                  <stop offset="100%" stopColor="#F97316" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
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
                stroke="url(#gradStroke)" strokeWidth={2.5}
                fill="url(#gradTimeline)" dot={false}
                activeDot={{ r: 5, fill: "#F59E0B", stroke: "#fff", strokeWidth: 2 }}
                filter="url(#glow)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Donut + Radar ────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-5">

        {/* Event Types Donut */}
        <div style={{
          background: "#fff", borderRadius: 16, padding: "24px 26px",
          border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
        }}>
          <SectionHeader
            title="Event Types Distribution"
            sub="Breakdown of captured attack patterns"
            icon={<FiShield size={15} />}
            accent="#3B82F6"
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: "0 0 200px", height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <defs>
                    {byType.map((_: any, i: number) => (
                      <radialGradient key={i} id={`pg${i}`} cx="50%" cy="50%" r="50%">
                        <stop offset="0%"   stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.9} />
                        <stop offset="100%" stopColor={PALETTE[i % PALETTE.length]} stopOpacity={0.6} />
                      </radialGradient>
                    ))}
                  </defs>
                  <Pie
                    data={byType} cx="50%" cy="50%"
                    innerRadius={55} outerRadius={88}
                    dataKey="count" nameKey="type"
                    stroke="none" paddingAngle={2}
                    labelLine={false} label={PieLabel}
                  >
                    {byType.map((_: any, i: number) => (
                      <Cell key={i} fill={`url(#pg${i})`} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
              {byType.map((t: any, i: number) => (
                <div key={t.type} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: PALETTE[i % PALETTE.length], flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 11, color: "#475569", fontWeight: 600,
                    flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{t.type}</span>
                  <span style={{ fontSize: 11, color: "#0F172A", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                    {t.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Radar / Bar */}
        <div style={{
          background: "#fff", borderRadius: 16, padding: "24px 26px",
          border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
        }}>
          <SectionHeader
            title="Attack Pattern Radar"
            sub="Relative intensity by event type"
            icon={<MdOutlineRadar size={15} />}
            accent="#8B5CF6"
          />
          <div style={{ height: 230 }}>
            <ResponsiveContainer width="100%" height="100%">
              {radarData.length >= 3 ? (
                <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
                  <defs>
                    <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
                      <stop offset="0%"   stopColor="#8B5CF6" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.05} />
                    </radialGradient>
                  </defs>
                  <PolarGrid stroke="rgba(15,23,42,0.08)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "#64748B", fontWeight: 600 }} />
                  <PolarRadiusAxis tick={false} axisLine={false} />
                  <Radar
                    name="Events" dataKey="value"
                    stroke="#8B5CF6" strokeWidth={2}
                    fill="url(#radarFill)"
                    dot={{ r: 4, fill: "#8B5CF6", stroke: "#fff", strokeWidth: 1.5 } as any}
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
        <div style={{
          background: "#fff", borderRadius: 16, padding: "24px 26px",
          border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
        }}>
          <SectionHeader
            title="Top Targeted Ports"
            sub="Most attacked services"
            icon={<BsBarChartSteps size={14} />}
            accent="#3B82F6"
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {byPort.slice(0, 10).map((p: any, i: number) => {
              const pct = (p.count / maxPortCount) * 100;
              const color = THREAT_COLORS[Math.min(i, THREAT_COLORS.length - 1)];
              return (
                <div key={p.port}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontFamily: "monospace", fontSize: 11, fontWeight: 800,
                        background: `${color}15`, color, padding: "2px 8px", borderRadius: 6,
                      }}>:{p.port}</span>
                      <span style={{ fontSize: 11, color: "#64748B", fontWeight: 500 }}>
                        {portService(p.port)}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", fontVariantNumeric: "tabular-nums" }}>
                      {p.count.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: "rgba(15,23,42,0.06)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4, width: `${pct}%`,
                      background: `linear-gradient(90deg, ${color}bb, ${color})`,
                      transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Events by Honeypot */}
        <div style={{
          background: "#fff", borderRadius: 16, padding: "24px 26px",
          border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
        }}>
          <SectionHeader
            title="Events by Honeypot"
            sub="Activity distribution across pots"
            icon={<FiServer size={15} />}
            accent="#10B981"
          />
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPot} margin={{ top: 4, right: 4, bottom: 4, left: -10 }}>
                <defs>
                  {byPot.map((_: any, i: number) => (
                    <linearGradient key={i} id={`potG${i}`} x1="0" y1="0" x2="0" y2="1">
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
                <Bar dataKey="count" name="Events" radius={[6, 6, 0, 0]}>
                  {byPot.map((_: any, i: number) => (
                    <Cell key={i} fill={`url(#potG${i})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ── Heatmap ──────────────────────────────────────────── */}
      <div style={{
        background: "#fff", borderRadius: 16, padding: "24px 26px",
        border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
      }}>
        <SectionHeader
          title="Hourly Attack Heatmap"
          sub="Attack density by hour of day — hover each column for details"
          icon={<RiFireLine size={15} />}
          accent="#8B5CF6"
        />
        {heatmap.length > 0
          ? <HeatmapGrid data={heatmap} />
          : <p style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", padding: "28px 0" }}>No heatmap data available</p>
        }
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>Low</span>
          <div style={{
            width: 90, height: 7, borderRadius: 4,
            background: "linear-gradient(90deg, rgba(245,158,11,0.12), rgba(245,158,11,0.96))",
          }} />
          <span style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>High</span>
        </div>
      </div>

      {/* ── Top Attacker IPs ─────────────────────────────────── */}
      <div style={{
        background: "#fff", borderRadius: 16,
        border: "1px solid rgba(15,23,42,0.07)", boxShadow: "0 1px 3px rgba(15,23,42,0.05)",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "16px 24px",
          background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)",
          borderBottom: "1px solid rgba(245,158,11,0.15)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, background: "rgba(245,158,11,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center", color: "#B45309",
            }}>
              <HiOutlineGlobeAlt size={16} />
            </div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#92400E" }}>Top Attacker IPs</p>
          </div>
          <div style={{
            background: "#F59E0B", color: "#fff",
            fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20,
          }}>
            {byIP.length} sources
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                {["Rank", "Threat", "IP Address", "Attacks", "Share"].map(h => (
                  <th key={h} style={{
                    padding: "10px 20px", textAlign: "left",
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
                  <tr
                    key={r.ip}
                    style={{ borderBottom: "1px solid rgba(15,23,42,0.04)", transition: "background 0.12s" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "#F8FAFC"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = ""}
                  >
                    <td style={{ padding: "12px 20px", fontSize: 12, color: "#94A3B8", fontWeight: 700, fontFamily: "monospace" }}>
                      #{i + 1}
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 6,
                        background: threat.bg, color: threat.fg, letterSpacing: "0.05em",
                        border: `1px solid ${threat.fg}22`,
                      }}>
                        {threat.label}
                      </span>
                    </td>
                    <td style={{ padding: "12px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: threat.fg, flexShrink: 0,
                          boxShadow: `0 0 6px ${threat.fg}88`,
                        }} />
                        <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#DC2626" }}>
                          {r.ip}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "12px 20px", fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "#0F172A" }}>
                      {r.count.toLocaleString()}
                    </td>
                    <td style={{ padding: "12px 20px", minWidth: 160 }}>
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
