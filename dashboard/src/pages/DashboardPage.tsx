import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { useWebSocket } from "../hooks/useWebSocket";

interface Stats {
  total_events: number;
  unique_ips: number;
  by_type: { event_type: string; count: number }[];
  by_ip:   { source_ip:  string; count: number }[];
}

/* ── Inline SVG icon helper ── */
const ICON = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const I = {
  server:    "M5 12H3a2 2 0 01-2-2V5a2 2 0 012-2h18a2 2 0 012 2v5a2 2 0 01-2 2h-2M5 12h14M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7M7 7h.01M7 17h.01",
  online:    "M5 13l4 4L19 7",
  offline:   "M18 6L6 18M6 6l12 12",
  bolt:      "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
  globe:     "M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20",
};

function StatCard({ label, value, sub, iconPath, tone = "amber" }:
  { label: string; value: any; sub?: string; iconPath: string; tone?: "amber" | "green" | "slate" | "red" }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    amber: { bg: "linear-gradient(135deg,#FEF3C7,#FDE68A)", fg: "#B45309" },
    green: { bg: "#DCFCE7", fg: "#15803D" },
    slate: { bg: "#F1F5F9", fg: "#475569" },
    red:   { bg: "#FEE2E2", fg: "#B91C1C" },
  };
  return (
    <div className="card-stat" style={{ padding: "20px 22px" }}>
      <div className="flex items-start justify-between gap-3">
        <p className="page-label">{label}</p>
        <div className="h-8 w-8 rounded-lg grid place-items-center" style={{ background: tones[tone].bg, color: tones[tone].fg }}>
          <ICON d={iconPath} />
        </div>
      </div>
      <p className="stat-number mt-3">{value ?? "—"}</p>
      {sub && <p className="text-[12px] mt-1.5" style={{ color: "#64748B" }}>{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => (await api.get("/events/stats")).data,
    refetchInterval: 10000,
  });
  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    refetchInterval: 10000,
  });
  const { connected } = useWebSocket(["events", "nodes"]);

  const total   = (nodes ?? []).length;
  const online  = (nodes ?? []).filter((n: any) => n.online).length;
  const offline = total - online;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Monitor your HoneyBee infrastructure</p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold"
             style={connected
               ? { background: "#F0FDF4", border: "1px solid #86EFAC", color: "#15803D" }
               : { background: "#FFFBEB", border: "1px solid #FCD34D", color: "#92400E" }}>
          <span className={`w-1.5 h-1.5 ${connected ? "dot-online" : "dot-offline"}`} />
          {connected ? "System Online" : "Connecting…"}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Total nodes"  value={total}    sub={`${online} online · ${offline} offline`} iconPath={I.server}  tone="amber" />
        <StatCard label="Online"       value={online}   sub="Active nodes"                              iconPath={I.online}  tone="green" />
        <StatCard label="Offline"      value={offline}  sub="Disconnected"                              iconPath={I.offline} tone="slate" />
        <StatCard label="Total events" value={stats?.total_events} sub="Captured attacks"               iconPath={I.bolt}    tone="amber" />
        <StatCard label="Unique IPs"   value={stats?.unique_ips}   sub="Distinct attackers"             iconPath={I.globe}   tone="red" />
      </div>

      {/* Detail cards */}
      <div className="grid md:grid-cols-2 gap-5">
        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 flex items-center justify-between"
               style={{ borderBottom: "1px solid rgba(15,23,42,0.06)", background: "#F8FAFC" }}>
            <p className="section-label" style={{ marginBottom: 0 }}>Top event types</p>
            <span className="badge badge-honey">{(stats?.by_type ?? []).length}</span>
          </div>
          <div className="p-5">
            {(stats?.by_type ?? []).length === 0
              ? <p className="text-sm" style={{ color: "#94A3B8" }}>No events captured yet</p>
              : <ul className="space-y-3">
                  {(stats?.by_type ?? []).map((r) => (
                    <li key={r.event_type} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#F59E0B" }} />
                        <span className="text-[13px] font-mono font-medium" style={{ color: "#0F172A" }}>{r.event_type}</span>
                      </div>
                      <span className="badge badge-honey">{r.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
            }
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="px-5 py-3.5 flex items-center justify-between"
               style={{ borderBottom: "1px solid rgba(15,23,42,0.06)", background: "#F8FAFC" }}>
            <p className="section-label" style={{ marginBottom: 0 }}>Top attacker IPs</p>
            <span className="badge badge-honey">{(stats?.by_ip ?? []).length}</span>
          </div>
          <div className="p-5">
            {(stats?.by_ip ?? []).length === 0
              ? <p className="text-sm" style={{ color: "#94A3B8" }}>No attackers yet</p>
              : <ul className="space-y-3">
                  {(stats?.by_ip ?? []).map((r) => (
                    <li key={r.source_ip} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#DC2626" }} />
                        <span className="text-[13px] font-mono font-medium" style={{ color: "#0F172A" }}>{r.source_ip}</span>
                      </div>
                      <span className="badge badge-honey">{r.count.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
