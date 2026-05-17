import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { Icons } from "../components/Icons";

/* ── Local SVG helper ─────────────────────────────── */
const Ico = ({ d, size = 18, color = "currentColor", sw = 2 }: { d: string; size?: number; color?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  latency_ms?: number;
};

type SystemReport = {
  ok: boolean;
  version: string;
  uptime_s: number;
  checks: CheckResult[];
  runtime: {
    go_version: string;
    goroutines: number;
    cpu_count: number;
    heap_alloc_mb: number;
    sys_mb: number;
  };
  counts: {
    nodes: number;
    online_nodes: number;
    connected_sessions: number;
    deployments: number;
    events: number;
    users: number;
  };
  deployment_status: Record<string, number>;
  now: string;
};

/* ── Pretty uptime formatter ─────────────────────── */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/* ── Status colour for deployment counts ────────── */
const STATUS_COLOR: Record<string, { bg: string; color: string; border: string; icon: string; bar: string; desc: string }> = {
  running:    { bg: "rgba(34,197,94,0.1)",    color: "#16A34A", border: "rgba(34,197,94,0.3)",    bar: "#22C55E", icon: Icons.play,    desc: "Honeypots actively capturing traffic" },
  pending:    { bg: "rgba(245,158,11,0.1)",   color: "#B45309", border: "rgba(245,158,11,0.3)",   bar: "#F59E0B", icon: Icons.clock,   desc: "Awaiting node acknowledgment" },
  installing: { bg: "rgba(59,130,246,0.1)",   color: "#1D4ED8", border: "rgba(59,130,246,0.3)",   bar: "#3B82F6", icon: Icons.install, desc: "Package installation in progress" },
  failed:     { bg: "rgba(239,68,68,0.1)",    color: "#DC2626", border: "rgba(239,68,68,0.3)",    bar: "#EF4444", icon: Icons.warn,    desc: "Deployment encountered an error" },
  stopped:    { bg: "rgba(100,116,139,0.1)",  color: "#475569", border: "rgba(100,116,139,0.3)",  bar: "#94A3B8", icon: Icons.stop,    desc: "Intentionally halted by operator" },
  removed:    { bg: "rgba(100,116,139,0.06)", color: "#94A3B8", border: "rgba(100,116,139,0.2)",  bar: "#CBD5E1", icon: Icons.trash,   desc: "Uninstalled and cleaned up" },
};

export default function SystemCheckPage() {
  const { data, isLoading, isFetching, refetch, error } = useQuery<SystemReport>({
    queryKey: ["system-check"],
    queryFn: async () => (await api.get("/system/check")).data,
    refetchInterval: 10_000,
  });

  if (isLoading) {
    return (
      <div style={{ textAlign: "center", padding: "80px 0" }}>
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "center", animation: "spin 1.6s linear infinite" }}>
          <Ico d={Icons.refresh} size={36} color="#94A3B8" />
        </div>
        <p style={{ color: "#94A3B8", fontWeight: 600 }}>Running system diagnostics…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Ico d={Icons.warn} size={36} color="#DC2626" />
        </div>
        <p style={{ fontWeight: 800, fontSize: 16, color: "#0F172A" }}>Failed to load diagnostics</p>
        <p style={{ fontSize: 13, color: "#64748B", margin: "6px 0 18px" }}>
          The /system/check endpoint did not respond. Check that the core service is reachable.
        </p>
        <button onClick={() => refetch()} className="btn btn-primary" style={{ display: "inline-flex", gap: 6 }}>
          <Ico d={Icons.refresh} size={14} color="#1C0A00" /> Retry
        </button>
      </div>
    );
  }

  const overallColor = data.ok ? "#16A34A" : "#DC2626";
  const overallBg    = data.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)";
  const overallBorder= data.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)";

  return (
    <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── Hero summary ── */}
      <div className="card" style={{
        padding: 0, overflow: "hidden",
        border: `1.5px solid ${overallBorder}`,
      }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${overallColor}, ${overallColor}88)` }} />
        <div style={{
          padding: "22px 26px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap",
          background: `linear-gradient(135deg, ${overallBg} 0%, rgba(255,255,255,0) 70%)`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 60, height: 60, borderRadius: 16, display: "grid", placeItems: "center",
              background: "#FFFFFF",
              boxShadow: `0 0 0 2px ${overallBorder}, 0 6px 22px ${overallBg}`,
            }}>
              <Ico d={data.ok ? Icons.check : Icons.warn} size={32} color={overallColor} sw={2.5} />
            </div>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: overallColor, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
                System Status
              </p>
              <p style={{ fontSize: 22, fontWeight: 900, color: "#0F172A", letterSpacing: "-0.02em", lineHeight: 1.1 }}>
                {data.ok ? "All Systems Operational" : "Issues Detected"}
              </p>
              <p style={{ fontSize: 12.5, color: "#64748B", marginTop: 4 }}>
                Version <strong>{data.version}</strong> · Uptime <strong>{formatUptime(data.uptime_s)}</strong> · Last check {new Date(data.now).toLocaleTimeString()}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn btn-secondary"
            style={{ display: "inline-flex", gap: 6, opacity: isFetching ? 0.6 : 1 }}
          >
            <Ico d={Icons.refresh} size={14} color="currentColor" />
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Health checks grid ── */}
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Ico d={Icons.shield} size={13} color="#94A3B8" /> Health Checks
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {data.checks.map(c => {
            const color  = c.ok ? "#16A34A" : "#DC2626";
            const bg     = c.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
            const border = c.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)";
            return (
              <div key={c.name} className="card" style={{ padding: "14px 16px", border: `1.5px solid ${border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center",
                      background: bg, border: `1px solid ${border}`,
                    }}>
                      <Ico d={c.ok ? Icons.check : Icons.warn} size={15} color={color} sw={2.5} />
                    </div>
                    <p style={{ fontSize: 13.5, fontWeight: 800, color: "#0F172A", textTransform: "capitalize" }}>
                      {c.name.replace(/_/g, " ")}
                    </p>
                  </div>
                  <span style={{
                    padding: "2px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 800,
                    background: bg, color, border: `1px solid ${border}`,
                  }}>
                    {c.ok ? "OK" : "FAIL"}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "#64748B", lineHeight: 1.55, fontFamily: c.detail.length > 40 ? "ui-monospace, monospace" : undefined }}>
                  {c.detail}
                </p>
                {typeof c.latency_ms === "number" && (
                  <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
                    <Ico d={Icons.clock} size={11} color="#94A3B8" /> {c.latency_ms} ms
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Counts grid ── */}
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Ico d={Icons.activity} size={13} color="#94A3B8" /> Platform Inventory
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
          {[
            { label: "Nodes",        value: data.counts.nodes,             icon: Icons.nodes,    color: "#0EA5E9" },
            { label: "Online Nodes", value: data.counts.online_nodes,      icon: Icons.online,   color: "#16A34A" },
            { label: "Live Sessions",value: data.counts.connected_sessions,icon: Icons.signal,   color: "#7C3AED" },
            { label: "Deployments",  value: data.counts.deployments,       icon: Icons.deploy,   color: "#F59E0B" },
            { label: "Events",       value: data.counts.events,            icon: Icons.bolt,     color: "#EF4444" },
            { label: "Users",        value: data.counts.users,             icon: Icons.users,    color: "#06B6D4" },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {s.label}
                </p>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center",
                  background: `${s.color}14`, border: `1px solid ${s.color}33`,
                }}>
                  <Ico d={s.icon} size={14} color={s.color} sw={2} />
                </div>
              </div>
              <p style={{ fontSize: 26, fontWeight: 900, color: "#0F172A", letterSpacing: "-0.03em", fontFeatureSettings: "'tnum'" }}>
                {s.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Deployment status breakdown ── */}
      {Object.keys(data.deployment_status).length > 0 && (() => {
        const entries = Object.entries(data.deployment_status) as [string, number][];
        const total = entries.reduce((s, [, v]) => s + v, 0);
        const activeCount  = (data.deployment_status["running"] ?? 0);
        const failedCount  = (data.deployment_status["failed"]  ?? 0);
        const healthPct    = total > 0 ? Math.round((activeCount / total) * 100) : 0;

        // order: running → installing → pending → stopped → removed → failed
        const ORDER = ["running","installing","pending","stopped","removed","failed"];
        const sorted = [...entries].sort(([a], [b]) => {
          const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        return (
          <div>
            {/* section header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ fontSize: 11.5, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.09em", display: "flex", alignItems: "center", gap: 6 }}>
                <Ico d={Icons.deploy} size={13} color="#94A3B8" /> Deployment Status Breakdown
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 11.5, color: "#94A3B8", fontWeight: 600 }}>
                  {total} total deployment{total !== 1 ? "s" : ""}
                </span>
                {failedCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: "#DC2626", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", padding: "2px 8px", borderRadius: 99 }}>
                    {failedCount} failed
                  </span>
                )}
                <span style={{ fontSize: 11, fontWeight: 800, color: healthPct >= 80 ? "#16A34A" : healthPct >= 50 ? "#B45309" : "#DC2626", background: healthPct >= 80 ? "rgba(34,197,94,0.1)" : healthPct >= 50 ? "rgba(245,158,11,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${healthPct >= 80 ? "rgba(34,197,94,0.3)" : healthPct >= 50 ? "rgba(245,158,11,0.3)" : "rgba(239,68,68,0.3)"}`, padding: "2px 8px", borderRadius: 99 }}>
                  {healthPct}% active
                </span>
              </div>
            </div>

            <div className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>

              {/* stacked proportion bar */}
              <div>
                <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", gap: 2 }}>
                  {sorted.map(([status, count]) => {
                    const cfg = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
                    const pct = (count / total) * 100;
                    return (
                      <div
                        key={status}
                        title={`${status}: ${count} (${Math.round(pct)}%)`}
                        style={{ flex: pct, background: cfg.bar, minWidth: pct > 0 ? 4 : 0, transition: "flex 0.4s ease" }}
                      />
                    );
                  })}
                </div>
                {/* legend row */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 9 }}>
                  {sorted.map(([status, count]) => {
                    const cfg = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
                    return (
                      <div key={status} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 99, background: cfg.bar, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "#64748B", fontWeight: 600, textTransform: "capitalize" }}>
                          {status} <span style={{ color: "#94A3B8" }}>({Math.round((count / total) * 100)}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* status cards grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 11 }}>
                {sorted.map(([status, count]) => {
                  const cfg = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={status} style={{
                      borderRadius: 12, padding: "14px 16px",
                      background: cfg.bg, border: `1.5px solid ${cfg.border}`,
                      display: "flex", flexDirection: "column", gap: 10,
                    }}>
                      {/* top row */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{
                            width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center",
                            background: "#fff", boxShadow: `0 0 0 1.5px ${cfg.border}`,
                          }}>
                            <Ico d={cfg.icon} size={16} color={cfg.color} sw={2.2} />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: cfg.color, textTransform: "capitalize" }}>
                            {status}
                          </span>
                        </div>
                        <span style={{ fontSize: 22, fontWeight: 900, color: cfg.color, fontFeatureSettings: "'tnum'", letterSpacing: "-0.02em" }}>
                          {count}
                        </span>
                      </div>

                      {/* progress bar */}
                      <div style={{ height: 5, borderRadius: 99, background: "rgba(255,255,255,0.55)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: cfg.bar, borderRadius: 99, transition: "width 0.5s ease" }} />
                      </div>

                      {/* footer */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: cfg.color, opacity: 0.75, lineHeight: 1.4 }}>
                          {cfg.desc}
                        </span>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: cfg.color, marginLeft: 8, flexShrink: 0 }}>
                          {Math.round(pct)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        );
      })()}

      {/* ── Runtime info ── */}
      <div>
        <p style={{ fontSize: 11.5, fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <Ico d={Icons.cpu} size={13} color="#94A3B8" /> Runtime Information
        </p>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
            {[
              { label: "Go Version",   value: data.runtime.go_version,                icon: Icons.bolt,     color: "#06B6D4" },
              { label: "Goroutines",   value: data.runtime.goroutines.toLocaleString(),icon: Icons.activity, color: "#16A34A" },
              { label: "CPU Cores",    value: data.runtime.cpu_count.toString(),      icon: Icons.cpu,      color: "#7C3AED" },
              { label: "Heap Alloc",   value: `${data.runtime.heap_alloc_mb} MB`,     icon: Icons.memory,   color: "#F59E0B" },
              { label: "System Memory",value: `${data.runtime.sys_mb} MB`,            icon: Icons.database, color: "#EF4444" },
            ].map(item => (
              <div key={item.label} style={{
                display: "flex", alignItems: "center", gap: 11,
                padding: "10px 12px", borderRadius: 10,
                background: "rgba(248,250,252,0.7)", border: "1px solid rgba(15,23,42,0.06)",
              }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                  display: "grid", placeItems: "center",
                  background: `${item.color}14`, border: `1px solid ${item.color}33`,
                }}>
                  <Ico d={item.icon} size={15} color={item.color} sw={2} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 1 }}>
                    {item.label}
                  </p>
                  <p style={{ fontSize: 13, fontWeight: 800, color: "#0F172A", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
