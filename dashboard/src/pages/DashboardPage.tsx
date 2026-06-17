import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuthStore } from "../stores/auth";
import { Icon, Icons } from "../components/Icons";
import AssetTopologyGraph from "../components/AssetTopologyGraph";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/* ════════════════════════════════════════════════ Types */
interface Stats {
  total_events: number;
  unique_ips: number;
  by_type: { type: string; count: number }[];
  by_ip: { ip: string; count: number }[];
  timeline: { bucket: string; count: number }[];
}
interface NodeT { id: number; name: string; hostname?: string; ip_address?: string; os?: string; online?: boolean; status?: string }
interface Deployment { id: number; node_id: number; honeypot_type: string; pot_id: string; status: string }
interface EventT { id: number; node_id: number; honeypot_type: string; pot_id: string; event_type: string; source_ip: string; event_time: string }
interface AlertT { id: number; severity: string; title: string; message: string; acknowledged: boolean; created_at: string }

/* ════════════════════════════════════════════════ Helpers */
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${Math.max(s, 1)}s ago`;
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function fmtHour(bucket: string) {
  try { return new Date(bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return bucket; }
}
function isOnline(n: NodeT) { return !!(n.online || n.status === "online"); }
function eventMeta(type: string): { color: string; icon: string } {
  const t = (type || "").toLowerCase();
  if (t.includes("login")) return { color: "#F59E0B", icon: Icons.key };
  if (t.includes("command") || t.includes("cmd")) return { color: "#3B82F6", icon: Icons.bolt };
  if (t.includes("download") || t.includes("file")) return { color: "#7C3AED", icon: Icons.install };
  if (t.includes("scan")) return { color: "#DC2626", icon: Icons.search };
  if (t.includes("connect") && t.includes("dis")) return { color: "var(--text-faint)", icon: Icons.offline };
  if (t.includes("connect")) return { color: "#22C55E", icon: Icons.link };
  if (t.includes("error") || t.includes("fail")) return { color: "#DC2626", icon: Icons.warn };
  return { color: "var(--text-muted)", icon: Icons.activity };
}
const SEV: Record<string, { c: string; bg: string }> = {
  critical: { c: "var(--danger)", bg: "rgba(239,68,68,0.16)" }, high: { c: "#EA580C", bg: "rgba(234,88,12,0.16)" },
  medium: { c: "var(--accent)", bg: "rgba(245,158,11,0.16)" }, low: { c: "var(--text-muted)", bg: "var(--bg-2)" },
};

/* ════════════════════════════════════════════════ Small UI */
function StatCard({ label, value, sub, icon, tone = "amber" }:
  { label: string; value: any; sub?: string; icon: string; tone?: "amber" | "green" | "slate" | "red" | "blue" | "violet" }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    amber:  { bg: "var(--warn-bg)",   fg: "var(--accent)" },
    green:  { bg: "var(--ok-bg)",     fg: "var(--ok)" },
    slate:  { bg: "rgba(100,116,139,0.16)", fg: "var(--text-faint)" },
    red:    { bg: "var(--danger-bg)", fg: "var(--danger)" },
    blue:   { bg: "var(--info-bg)",   fg: "var(--info)" },
    violet: { bg: "var(--violet-bg)", fg: "var(--violet)" },
  };
  return (
    <div className="card-stat" style={{ padding: "13px 15px" }}>
      <div className="flex items-center justify-between gap-2">
        <p className="page-label" style={{ fontSize: 10 }}>{label}</p>
        <div className="h-7 w-7 rounded-lg grid place-items-center" style={{ background: tones[tone].bg, color: tones[tone].fg }}><Icon d={icon} size={14} /></div>
      </div>
      <p className="stat-number mt-1.5" style={{ fontSize: 24 }}>{value ?? "—"}</p>
      {sub && <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{sub}</p>}
    </div>
  );
}
function MiniHeader({ icon, title, right }: { icon: string; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2"><Icon d={icon} size={14} color="var(--accent)" /><span className="section-label" style={{ margin: 0 }}>{title}</span></div>
      {right}
    </div>
  );
}
function ViewAll({ to }: { to: string }) {
  return <Link to={to} className="flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: "var(--accent)", textDecoration: "none" }}>All <Icon d={Icons.arrow} size={12} /></Link>;
}
function Panel({ icon, title, right, children }: { icon: string; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card-sub p-3.5">
      <MiniHeader icon={icon} title={title} right={right} />
      {children}
    </div>
  );
}
function BarList({ items, color, mono }: { items: { label: string; value: number }[]; color: string; mono?: boolean }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (items.length === 0) return <div className="py-8 text-center" style={{ color: "var(--text-faint)", fontSize: 13 }}>No data yet</div>;
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="truncate" style={{ width: 120, fontSize: 12, fontWeight: 600, fontFamily: mono ? "ui-monospace,monospace" : undefined, color: "var(--text)" }}>{it.label}</span>
          <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "var(--bg-2)" }}>
            <div style={{ width: `${(it.value / max) * 100}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
          </div>
          <span className="tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", minWidth: 34, textAlign: "right" }}>{it.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
function Empty({ icon, text, color = "var(--text-faint)" }: { icon: string; text: string; color?: string }) {
  // flex-col + items-center so the (display:block) svg icon centers with the text.
  return <div className="py-10 flex flex-col items-center justify-center text-center" style={{ color }}><Icon d={icon} size={24} /><p style={{ fontSize: 13, marginTop: 8, color: "var(--text-muted)" }}>{text}</p></div>;
}

/* ════════════════════════════════════════════════ Page */
export default function DashboardPage() {
  const email = useAuthStore((s) => s.email);
  const qc = useQueryClient();
  const [tab, setTab] = useState<"live" | "threats" | "topology">("live");

  // NOTE: Go marshals empty slices as JSON `null`, so coerce to [] in the
  // queryFn (a `= []` default only catches `undefined`, not `null`).
  const { data: stats } = useQuery<Stats | null>({ queryKey: ["stats"], queryFn: async () => (await api.get("/events/stats")).data, refetchInterval: 15000 });
  const { data: nodes = [] } = useQuery<NodeT[]>({ queryKey: ["nodes"], queryFn: async () => (await api.get("/nodes")).data ?? [], refetchInterval: 10000 });
  const { data: deployments = [] } = useQuery<Deployment[]>({ queryKey: ["deployments"], queryFn: async () => (await api.get("/deployments")).data ?? [], refetchInterval: 15000 });
  const { data: alertCount } = useQuery({ queryKey: ["alert-count"], queryFn: async () => (await api.get("/alerts/count")).data, refetchInterval: 10000 });
  const { data: recentEvents = [] } = useQuery<EventT[]>({ queryKey: ["recent-events"], queryFn: async () => (await api.get("/events?limit=14")).data ?? [], refetchInterval: 8000 });
  const { data: recentAlerts = [] } = useQuery<AlertT[]>({ queryKey: ["recent-alerts"], queryFn: async () => (await api.get("/alerts?limit=6")).data ?? [], refetchInterval: 15000 });

  const { connected, lastMessage } = useWebSocket(["events", "nodes", "pot_events"]);
  useEffect(() => {
    if (!lastMessage) return;
    qc.invalidateQueries({ queryKey: ["recent-events"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    qc.invalidateQueries({ queryKey: ["alert-count"] });
  }, [lastMessage, qc]);

  const total = nodes.length;
  const online = nodes.filter(isOnline).length;
  const offline = total - online;
  const runningPots = deployments.filter((d) => d.status === "running").length;
  const timeline = stats?.timeline ?? [];
  const nodeNameById = new Map(nodes.map((n) => [n.id, n.name]));
  const runningByNode = (nid: number) => deployments.filter((d) => d.node_id === nid && d.status === "running").length;
  const potsByNode = (nid: number) => deployments.filter((d) => d.node_id === nid).length;
  const openAlerts = alertCount?.count ?? 0;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = email ? email.split("@")[0] : "there";
  const topIPs = (stats?.by_ip ?? []).slice(0, 6).map((x) => ({ label: x.ip, value: x.count }));
  const topTypes = (stats?.by_type ?? []).slice(0, 6).map((x) => ({ label: x.type, value: x.count }));

  const TABS = [
    { k: "live" as const, label: "Live", icon: Icons.activity },
    { k: "threats" as const, label: "Threats", icon: Icons.globe },
    { k: "topology" as const, label: "Topology", icon: Icons.network },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="page-label">{greeting}, {name}</p>
          <h1 className="page-title flex items-center gap-2.5" style={{ fontSize: 24 }}><Icon d={Icons.hex} size={23} color="var(--accent)" /> Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold"
             style={connected ? { background: "var(--ok-bg)", border: "1px solid var(--ok)", color: "var(--ok)" } : { background: "var(--warn-bg)", border: "1px solid var(--warn)", color: "var(--warn)" }}>
          <span className={`${connected ? "dot-online" : "dot-offline"}`} style={{ width: 7, height: 7, display: "inline-block" }} />
          {connected ? "Live" : "Connecting…"}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Nodes" value={total} sub={`${online} online · ${offline} off`} icon={Icons.server} tone="amber" />
        <StatCard label="Honeypots" value={deployments.length} sub={`${runningPots} running`} icon={Icons.honeypot} tone="green" />
        <StatCard label="Events" value={stats?.total_events?.toLocaleString()} sub="Interactions" icon={Icons.bolt} tone="violet" />
        <StatCard label="Unique IPs" value={stats?.unique_ips?.toLocaleString()} sub="Attackers" icon={Icons.globe} tone="red" />
        <StatCard label="Online" value={online} sub={total ? `${Math.round((online / total) * 100)}% fleet` : "—"} icon={Icons.online} tone="blue" />
        <StatCard label="Alerts" value={openAlerts} sub="Unacked" icon={Icons.bell} tone="slate" />
      </div>

      {/* Tabbed panel */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-1 p-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="segmented">
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)} aria-selected={tab === t.k} className="flex items-center gap-2">
                <Icon d={t.icon} size={15} /> {t.label}
              </button>
            ))}
          </div>
          <div className="ml-auto pr-1">
            <Link to="/analytics" className="text-[12px] font-semibold" style={{ color: "var(--accent)", textDecoration: "none" }}>Full analytics →</Link>
          </div>
        </div>

        {/* ── LIVE ── */}
        {tab === "live" && (
          <div className="p-4 space-y-4">
            {/* timeline — full width */}
            <Panel icon={Icons.chart} title="Attack timeline · last 24h" right={<ViewAll to="/analytics" />}>
              {timeline.length > 0 ? (
                <div style={{ height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timeline} margin={{ top: 6, right: 10, bottom: 0, left: -16 }}>
                      <defs><linearGradient id="dashGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#F59E0B" stopOpacity={0.32} /><stop offset="95%" stopColor="#F59E0B" stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="bucket" tickFormatter={fmtHour} tick={{ fontSize: 10 }} stroke="var(--text-faint)" minTickGap={24} />
                      <YAxis tick={{ fontSize: 10 }} stroke="var(--text-faint)" allowDecimals={false} width={32} />
                      <Tooltip contentStyle={{ background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)", color: "var(--text)", fontSize: 12 }} labelFormatter={(l) => fmtHour(String(l))} />
                      <Area type="monotone" dataKey="count" stroke="#F59E0B" strokeWidth={2} fill="url(#dashGrad)" name="Events" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <Empty icon={Icons.chart} text="No attack data captured yet." />}
            </Panel>

            {/* three equal panels */}
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))" }}>
              {/* activity */}
              <Panel icon={Icons.activity} title="Live activity" right={<ViewAll to="/events" />}>
                {recentEvents.length === 0 ? <Empty icon={Icons.activity} text="No events yet." /> : (
                  <div style={{ maxHeight: 250, overflowY: "auto" }}>
                    {recentEvents.slice(0, 12).map((e) => {
                      const m = eventMeta(e.event_type);
                      return (
                        <div key={e.id} className="flex items-center gap-2.5 py-1.5">
                          <div className="grid place-items-center shrink-0" style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${m.color} 9%, transparent)`, color: m.color }}><Icon d={m.icon} size={14} /></div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5"><span className="truncate" style={{ fontWeight: 700, fontSize: 12.5, fontFamily: "ui-monospace,monospace" }}>{e.source_ip || "unknown"}</span><span className="shrink-0" style={{ fontSize: 11, color: "var(--text-muted)" }}>{e.event_type}</span></div>
                            <div className="truncate" style={{ fontSize: 11, color: "var(--text-faint)" }}>{e.honeypot_type || e.pot_id} · {nodeNameById.get(e.node_id) ?? `node ${e.node_id}`}</div>
                          </div>
                          <span className="shrink-0" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{relativeTime(e.event_time)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* nodes */}
              <Panel icon={Icons.server} title="Nodes" right={<ViewAll to="/nodes" />}>
                {nodes.length === 0 ? (
                  <div className="py-6 flex flex-col items-center justify-center text-center" style={{ color: "var(--text-faint)" }}>
                    <Icon d={Icons.server} size={22} /><p style={{ fontSize: 12.5, marginTop: 6 }}>No nodes yet.</p>
                    <Link to="/nodes" className="btn btn-primary btn-xs" style={{ marginTop: 8, textDecoration: "none", display: "inline-flex" }}><Icon d={Icons.plus} size={12} /> Add node</Link>
                  </div>
                ) : (
                  <div style={{ maxHeight: 250, overflowY: "auto", margin: "-4px -10px", padding: "4px 10px" }}>
                    {nodes.slice(0, 8).map((n) => {
                      const on = isOnline(n);
                      return (
                        <Link key={n.id} to={`/nodes/${n.id}`} className="flex items-center justify-between gap-2 py-1.5" style={{ textDecoration: "none" }}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`shrink-0 ${on ? "dot-online" : "dot-offline"}`} style={{ width: 8, height: 8 }} />
                            <div className="min-w-0"><div className="truncate" style={{ fontWeight: 700, fontSize: 12.5, color: "var(--text)" }}>{n.name}</div><div className="truncate" style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "ui-monospace,monospace" }}>{n.ip_address || n.hostname || n.os || "—"}</div></div>
                          </div>
                          <span className={runningByNode(n.id) > 0 ? "chip chip-green shrink-0" : "chip chip-slate shrink-0"} style={{ fontSize: 10 }}>
                            {potsByNode(n.id)} pot{potsByNode(n.id) === 1 ? "" : "s"}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* alerts */}
              <Panel icon={Icons.bell} title="Alerts" right={openAlerts > 0 ? <span className="badge badge-error">{openAlerts}</span> : <ViewAll to="/alerts" />}>
                {recentAlerts.length === 0 ? <Empty icon={Icons.check} text="All clear — no recent alerts." color="var(--ok)" /> : (
                  <div style={{ maxHeight: 250, overflowY: "auto" }}>
                    {recentAlerts.map((a) => {
                      const sev = SEV[(a.severity || "low").toLowerCase()] ?? SEV.low;
                      return (
                        <div key={a.id} className="flex items-start gap-2.5 py-1.5" style={{ opacity: a.acknowledged ? 0.55 : 1 }}>
                          <span className="shrink-0 mt-1.5" style={{ width: 7, height: 7, borderRadius: 99, background: sev.c }} />
                          <div className="min-w-0 flex-1"><div className="truncate" style={{ fontWeight: 700, fontSize: 12.5 }}>{a.title}</div>{a.message && <div className="truncate" style={{ fontSize: 11, color: "var(--text-faint)" }}>{a.message}</div>}</div>
                          <span className="shrink-0" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{relativeTime(a.created_at)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        )}

        {/* ── THREATS ── */}
        {tab === "threats" && (
          <div className="grid gap-5 p-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))" }}>
            <div><MiniHeader icon={Icons.globe} title="Top attackers · by volume" /><BarList items={topIPs} color="var(--danger)" mono /></div>
            <div><MiniHeader icon={Icons.honeypot} title="Most targeted" /><BarList items={topTypes} color="var(--warn)" /></div>
          </div>
        )}

        {/* ── TOPOLOGY ── */}
        {tab === "topology" && (
          <div className="p-3">
            <AssetTopologyGraph nodes={nodes} deployments={deployments} email={email} />
          </div>
        )}
      </div>
    </div>
  );
}
