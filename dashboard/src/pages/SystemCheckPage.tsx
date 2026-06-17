import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { Icons } from "../components/Icons";

/* ── Local SVG helper ─────────────────────────────── */
const Ico = ({ d, size = 18, color = "currentColor", sw = 2 }: { d: string; size?: number; color?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

type CheckResult = { name: string; ok: boolean; critical?: boolean; detail: string; latency_ms?: number };
type Host = {
  hostname?: string; os?: string; platform?: string; platform_version?: string;
  kernel_version?: string; arch?: string; uptime_s?: number; procs?: number;
  cpu_model?: string; cpu_cores?: number; cpu_pct?: number;
  mem_total?: number; mem_used?: number; mem_pct?: number;
  disk_total?: number; disk_used?: number; disk_pct?: number; disk_path?: string;
  load1?: number; load5?: number; load15?: number;
};
type SystemReport = {
  ok: boolean;
  version: string;
  build?: { go?: string; revision?: string; time?: string; dirty?: boolean };
  uptime_s: number;
  checks: CheckResult[];
  host?: Host;
  runtime: { go_version: string; goroutines: number; cpu_count: number; heap_alloc_mb: number; sys_mb: number; num_gc?: number };
  db_pool?: { open: number; in_use: number; idle: number; max_open: number; wait_count: number };
  counts: { nodes: number; online_nodes: number; connected_sessions: number; deployments: number; events: number; users: number };
  deployment_status: Record<string, number>;
  now: string;
};

/* ── Formatters ───────────────────────────────────── */
function formatUptime(seconds?: number): string {
  if (!seconds && seconds !== 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
function humanBytes(n?: number): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB", "PB"]; let b = n, i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(b < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
/* Threshold colour (hex literals → safe for `${c}14` tints + solid bars). */
function gaugeColor(pct?: number): string {
  if (pct == null) return "#94A3B8";
  if (pct >= 90) return "#EF4444";
  if (pct >= 70) return "#F59E0B";
  return "#22C55E";
}

const STATUS_COLOR: Record<string, { bg: string; color: string; border: string; icon: string; bar: string; desc: string }> = {
  running:    { bg: "var(--ok-bg)",          color: "var(--ok)",        border: "var(--ok-border)",      bar: "var(--ok)",        icon: Icons.play,    desc: "Honeypots actively capturing traffic" },
  pending:    { bg: "var(--warn-bg)",         color: "var(--warn)",      border: "var(--warn-border)",    bar: "var(--warn)",      icon: Icons.clock,   desc: "Awaiting node acknowledgment" },
  installing: { bg: "var(--info-bg)",         color: "var(--info)",      border: "var(--info-border)",    bar: "var(--info)",      icon: Icons.install, desc: "Package installation in progress" },
  failed:     { bg: "var(--danger-bg)",       color: "var(--danger)",    border: "var(--danger-border)",  bar: "var(--danger)",    icon: Icons.warn,    desc: "Deployment encountered an error" },
  stopped:    { bg: "rgba(100,116,139,0.1)",  color: "var(--text-muted)",border: "rgba(100,116,139,0.3)", bar: "var(--text-faint)",icon: Icons.stop,    desc: "Intentionally halted by operator" },
  removed:    { bg: "rgba(100,116,139,0.06)", color: "var(--text-faint)",border: "rgba(100,116,139,0.2)", bar: "var(--border-2)",  icon: Icons.trash,   desc: "Uninstalled and cleaned up" },
};

/* ── Reusable bits ────────────────────────────────── */
function SectionLabel({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
      <Ico d={icon} size={13} color="var(--text-faint)" /> {children}
    </p>
  );
}

function Gauge({ label, pct, sub, icon }: { label: string; pct?: number; sub?: string; icon: string }) {
  const c = gaugeColor(pct);
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", background: `${c}14`, border: `1px solid ${c}33` }}>
            <Ico d={icon} size={16} color={c} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
        </div>
        <span style={{ fontSize: 26, fontWeight: 800, color: c, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
          {pct == null ? "—" : `${pct.toFixed(0)}%`}
        </span>
      </div>
      <div style={{ height: 8, borderRadius: 99, background: "var(--bg-2)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(pct ?? 0, 100)}%`, background: c, borderRadius: 99, transition: "width .5s ease" }} />
      </div>
      {sub && <p style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sub}>{sub}</p>}
    </div>
  );
}

function InfoTile({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div className="card-sub" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 12px" }}>
      <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center", background: `${color}14`, border: `1px solid ${color}33` }}>
        <Ico d={icon} size={15} color={color} sw={2} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 1 }}>{label}</p>
        <p style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>{value}</p>
      </div>
    </div>
  );
}

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
          <Ico d={Icons.refresh} size={36} color="var(--text-faint)" />
        </div>
        <p style={{ color: "var(--text-faint)", fontWeight: 600 }}>Running system diagnostics…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ padding: "40px 24px", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Ico d={Icons.warn} size={36} color="var(--danger)" />
        </div>
        <p style={{ fontWeight: 800, fontSize: 16, color: "var(--text)" }}>Failed to load diagnostics</p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "6px 0 18px" }}>
          The /system/check endpoint did not respond. Check that the core service is reachable.
        </p>
        <button onClick={() => refetch()} className="btn btn-primary" style={{ display: "inline-flex", gap: 6 }}>
          <Ico d={Icons.refresh} size={14} color="#1C0A00" /> Retry
        </button>
      </div>
    );
  }

  const host = data.host ?? {};
  const advisories = data.checks.filter(c => !c.ok && c.critical === false).length;
  const overallColor  = data.ok ? "#22C55E" : "#DC2626";
  const overallText   = data.ok ? "var(--ok)" : "var(--danger)";
  const overallBg     = data.ok ? "var(--ok-bg)" : "var(--danger-bg)";
  const overallBorder = data.ok ? "var(--ok-border)" : "var(--danger-border)";

  const osLabel = [host.platform || host.os, host.platform_version].filter(Boolean).join(" ");
  const hostTiles: { label: string; value: string; icon: string; color: string }[] = [
    host.hostname        ? { label: "Hostname",   value: host.hostname,                          icon: Icons.server,  color: "#0EA5E9" } : null,
    osLabel              ? { label: "OS",         value: osLabel,                                icon: Icons.hex,     color: "#7C3AED" } : null,
    host.kernel_version  ? { label: "Kernel",     value: host.kernel_version,                    icon: Icons.cpu,     color: "#06B6D4" } : null,
    host.arch            ? { label: "Arch",       value: host.arch,                              icon: Icons.cpu,     color: "#F59E0B" } : null,
    host.cpu_model       ? { label: "CPU",        value: host.cpu_model,                         icon: Icons.cpu,     color: "#EF4444" } : null,
    host.cpu_cores != null ? { label: "Cores",    value: String(host.cpu_cores),                 icon: Icons.activity,color: "#22C55E" } : null,
    host.uptime_s != null ? { label: "Host uptime", value: formatUptime(host.uptime_s),         icon: Icons.clock,   color: "#F59E0B" } : null,
    host.load1 != null   ? { label: "Load avg",   value: `${host.load1} / ${host.load5} / ${host.load15}`, icon: Icons.signal, color: "#7C3AED" } : null,
    host.procs != null   ? { label: "Processes",  value: String(host.procs),                     icon: Icons.hash,    color: "#06B6D4" } : null,
  ].filter(Boolean) as any;

  const hasResources = host.cpu_pct != null || host.mem_pct != null || host.disk_pct != null;

  return (
    <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 22 }}>

      {/* ── Hero summary ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden", border: `1.5px solid ${overallBorder}` }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${overallColor}, ${overallColor}88)` }} />
        <div style={{ padding: "22px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, flexWrap: "wrap",
          background: `linear-gradient(135deg, ${overallBg} 0%, transparent 70%)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 60, height: 60, borderRadius: 16, display: "grid", placeItems: "center", background: "var(--surface)",
              boxShadow: `0 0 0 2px ${overallBorder}, 0 6px 22px ${overallBg}` }}>
              <Ico d={data.ok ? Icons.check : Icons.warn} size={32} color={overallText} sw={2.5} />
            </div>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 700, color: overallText, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>System Status</p>
              <p className="section-title" style={{ fontSize: 22 }}>{data.ok ? "All Systems Operational" : "Issues Detected"}</p>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }}>
                {host.hostname && <><strong style={{ color: "var(--text)" }}>{host.hostname}</strong> · </>}
                v{data.version}{data.build?.revision ? ` (${data.build.revision}${data.build.dirty ? "·dirty" : ""})` : ""} ·
                Uptime <strong>{formatUptime(data.uptime_s)}</strong> · Checked {new Date(data.now).toLocaleTimeString()}
                {advisories > 0 && <> · <span style={{ color: "var(--warn)", fontWeight: 700 }}>{advisories} advisor{advisories === 1 ? "y" : "ies"}</span></>}
              </p>
            </div>
          </div>
          <button onClick={() => refetch()} disabled={isFetching} className="btn btn-secondary" style={{ display: "inline-flex", gap: 6, opacity: isFetching ? 0.6 : 1 }}>
            <Ico d={Icons.refresh} size={14} color="currentColor" /> {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* ── Live host resources ── */}
      {hasResources && (
        <div>
          <SectionLabel icon={Icons.cpu}>Host Resources</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <Gauge label="CPU"    pct={host.cpu_pct}  icon={Icons.cpu}     sub={host.cpu_model ? `${host.cpu_cores ?? "?"} cores · ${host.cpu_model}` : `${host.cpu_cores ?? "?"} cores`} />
            <Gauge label="Memory" pct={host.mem_pct}  icon={Icons.memory}  sub={`${humanBytes(host.mem_used)} of ${humanBytes(host.mem_total)} used`} />
            <Gauge label="Disk"   pct={host.disk_pct} icon={Icons.database} sub={`${humanBytes(host.disk_used)} of ${humanBytes(host.disk_total)}${host.disk_path ? ` · ${host.disk_path}` : ""}`} />
          </div>
        </div>
      )}

      {/* ── Host information ── */}
      {hostTiles.length > 0 && (
        <div>
          <SectionLabel icon={Icons.server}>System Information</SectionLabel>
          <div className="card" style={{ padding: "16px 18px" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
              {hostTiles.map(t => <InfoTile key={t.label} {...t} />)}
            </div>
          </div>
        </div>
      )}

      {/* ── Health checks ── */}
      <div>
        <SectionLabel icon={Icons.shield}>Health Checks</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {data.checks.map(c => {
            // A failing non-critical check is an advisory WARN (amber), not a hard FAIL (red).
            const warn   = !c.ok && c.critical === false;
            const color  = c.ok ? "var(--ok)" : warn ? "var(--warn)" : "var(--danger)";
            const bg     = c.ok ? "var(--ok-bg)" : warn ? "var(--warn-bg)" : "var(--danger-bg)";
            const border = c.ok ? "var(--ok-border)" : warn ? "var(--warn-border)" : "var(--danger-border)";
            return (
              <div key={c.name} className="card" style={{ padding: "14px 16px", border: `1.5px solid ${border}` }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: bg, border: `1px solid ${border}` }}>
                      <Ico d={c.ok ? Icons.check : Icons.warn} size={15} color={color} sw={2.5} />
                    </div>
                    <p style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", textTransform: "capitalize" }}>{c.name.replace(/_/g, " ")}</p>
                  </div>
                  <span style={{ padding: "2px 9px", borderRadius: 99, fontSize: 10.5, fontWeight: 800, background: bg, color, border: `1px solid ${border}` }}>
                    {c.ok ? "OK" : warn ? "WARN" : "FAIL"}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.55 }}>{c.detail}</p>
                {typeof c.latency_ms === "number" && c.latency_ms > 0 && (
                  <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, display: "flex", alignItems: "center", gap: 5 }}>
                    <Ico d={Icons.clock} size={11} color="var(--text-faint)" /> {c.latency_ms} ms
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Platform inventory ── */}
      <div>
        <SectionLabel icon={Icons.activity}>Platform Inventory</SectionLabel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12 }}>
          {[
            { label: "Nodes",         value: data.counts.nodes,              icon: Icons.nodes,  color: "#0EA5E9" },
            { label: "Online Nodes",  value: data.counts.online_nodes,       icon: Icons.online, color: "#22C55E" },
            { label: "Live Sessions", value: data.counts.connected_sessions, icon: Icons.signal, color: "#7C3AED" },
            { label: "Deployments",   value: data.counts.deployments,        icon: Icons.deploy, color: "#F59E0B" },
            { label: "Events",        value: data.counts.events,             icon: Icons.bolt,   color: "#EF4444" },
            { label: "Users",         value: data.counts.users,              icon: Icons.users,  color: "#06B6D4" },
          ].map(s => (
            <div key={s.label} className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.label}</p>
                <div style={{ width: 28, height: 28, borderRadius: 8, display: "grid", placeItems: "center", background: `${s.color}14`, border: `1px solid ${s.color}33` }}>
                  <Ico d={s.icon} size={14} color={s.color} sw={2} />
                </div>
              </div>
              <p className="stat-number-sm">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Deployment status breakdown ── */}
      {Object.keys(data.deployment_status).length > 0 && (() => {
        const entries = Object.entries(data.deployment_status) as [string, number][];
        const total = entries.reduce((s, [, v]) => s + v, 0);
        const activeCount = (data.deployment_status["running"] ?? 0);
        const failedCount = (data.deployment_status["failed"] ?? 0);
        const healthPct = total > 0 ? Math.round((activeCount / total) * 100) : 0;
        const ORDER = ["running", "installing", "pending", "stopped", "removed", "failed"];
        const sorted = [...entries].sort(([a], [b]) => {
          const ai = ORDER.indexOf(a); const bi = ORDER.indexOf(b);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
              <p style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.09em", display: "flex", alignItems: "center", gap: 6 }}>
                <Ico d={Icons.deploy} size={13} color="var(--text-faint)" /> Deployment Status Breakdown
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 11.5, color: "var(--text-faint)", fontWeight: 600 }}>{total} total deployment{total !== 1 ? "s" : ""}</span>
                {failedCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--danger)", background: "var(--danger-bg)", border: "1px solid var(--danger-border)", padding: "2px 8px", borderRadius: 99 }}>{failedCount} failed</span>
                )}
                <span style={{ fontSize: 11, fontWeight: 800, color: healthPct >= 80 ? "var(--ok)" : healthPct >= 50 ? "var(--warn)" : "var(--danger)", background: healthPct >= 80 ? "var(--ok-bg)" : healthPct >= 50 ? "var(--warn-bg)" : "var(--danger-bg)", border: `1px solid ${healthPct >= 80 ? "var(--ok-border)" : healthPct >= 50 ? "var(--warn-border)" : "var(--danger-border)"}`, padding: "2px 8px", borderRadius: 99 }}>
                  {healthPct}% active
                </span>
              </div>
            </div>
            <div className="card" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", gap: 2 }}>
                  {sorted.map(([status, count]) => {
                    const cfg = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
                    const pct = (count / total) * 100;
                    return <div key={status} title={`${status}: ${count} (${Math.round(pct)}%)`} style={{ flex: pct, background: cfg.bar, minWidth: pct > 0 ? 4 : 0, transition: "flex 0.4s ease" }} />;
                  })}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 9 }}>
                  {sorted.map(([status, count]) => {
                    const cfg = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
                    return (
                      <div key={status} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 99, background: cfg.bar, flexShrink: 0 }} />
                        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "capitalize" }}>
                          {status} <span style={{ color: "var(--text-faint)" }}>({Math.round((count / total) * 100)}%)</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 11 }}>
                {sorted.map(([status, count]) => {
                  const cfg = STATUS_COLOR[status] ?? STATUS_COLOR.stopped;
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={status} style={{ borderRadius: 12, padding: "14px 16px", background: cfg.bg, border: `1.5px solid ${cfg.border}`, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--surface)", boxShadow: `0 0 0 1.5px ${cfg.border}` }}>
                            <Ico d={cfg.icon} size={16} color={cfg.color} sw={2.2} />
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 800, color: cfg.color, textTransform: "capitalize" }}>{status}</span>
                        </div>
                        <span style={{ fontSize: 22, fontWeight: 800, color: cfg.color, fontFeatureSettings: "'tnum'", letterSpacing: "-0.02em" }}>{count}</span>
                      </div>
                      <div style={{ height: 5, borderRadius: 99, background: "var(--glass)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: cfg.bar, borderRadius: 99, transition: "width 0.5s ease" }} />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: cfg.color, opacity: 0.75, lineHeight: 1.4 }}>{cfg.desc}</span>
                        <span style={{ fontSize: 11.5, fontWeight: 800, color: cfg.color, marginLeft: 8, flexShrink: 0 }}>{Math.round(pct)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Process runtime + DB pool ── */}
      <div>
        <SectionLabel icon={Icons.hex}>Core Process &amp; Database</SectionLabel>
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 14 }}>
            {[
              { label: "Go Version",   value: data.build?.go || data.runtime.go_version,        icon: Icons.bolt,     color: "#06B6D4" },
              { label: "Goroutines",   value: data.runtime.goroutines.toLocaleString(),         icon: Icons.activity, color: "#22C55E" },
              { label: "GC Cycles",    value: (data.runtime.num_gc ?? 0).toLocaleString(),      icon: Icons.refresh,  color: "#7C3AED" },
              { label: "Heap Alloc",   value: `${data.runtime.heap_alloc_mb} MB`,               icon: Icons.memory,   color: "#F59E0B" },
              { label: "Process RSS",  value: `${data.runtime.sys_mb} MB`,                       icon: Icons.cpu,      color: "#EF4444" },
              ...(data.db_pool ? [
                { label: "DB Conns",     value: `${data.db_pool.open}/${data.db_pool.max_open || "∞"}`, icon: Icons.database, color: "#0EA5E9" },
                { label: "DB In Use",    value: String(data.db_pool.in_use),                      icon: Icons.signal,   color: "#22C55E" },
                { label: "DB Idle",      value: String(data.db_pool.idle),                        icon: Icons.clock,    color: "#94A3B8" },
              ] : []),
            ].map(item => (
              <InfoTile key={item.label} {...item} />
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
