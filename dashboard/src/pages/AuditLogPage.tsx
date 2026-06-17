import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import api from "../api/client";
import { Icon, Icons } from "../components/Icons";
import { useAuthStore } from "../stores/auth";

/* ─── time helpers ──────────────────────────────────────── */
const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtRelative = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const dayKey = (iso: string) => new Date(iso).toDateString();
const titleCase = (s: string) => (s || "").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

/* ─── action → tone + icon ──────────────────────────────── */
type Tone = "ok" | "danger" | "warn" | "info" | "violet" | "muted";
const TONE: Record<Tone, { bg: string; fg: string; border: string }> = {
  ok:     { bg: "var(--ok-bg)",     fg: "var(--ok)",     border: "var(--ok-border)" },
  danger: { bg: "var(--danger-bg)", fg: "var(--danger)", border: "var(--danger-border)" },
  warn:   { bg: "var(--warn-bg)",   fg: "var(--accent)", border: "var(--warn-border)" },
  info:   { bg: "var(--info-bg)",   fg: "var(--info)",   border: "var(--info-border)" },
  violet: { bg: "var(--violet-bg)", fg: "var(--violet)", border: "var(--violet-border)" },
  muted:  { bg: "var(--bg-2)",      fg: "var(--text-muted)", border: "var(--border-2)" },
};
const ACTION_META: Record<string, { icon: string; tone: Tone; label: string }> = {
  create:             { icon: Icons.plus,    tone: "ok",     label: "Create" },
  delete:             { icon: Icons.trash,   tone: "danger", label: "Delete" },
  remove:             { icon: Icons.trash,   tone: "danger", label: "Remove" },
  uninstall:          { icon: Icons.offline, tone: "danger", label: "Uninstall" },
  update:             { icon: Icons.settings,tone: "info",   label: "Update" },
  login:              { icon: Icons.online,  tone: "ok",     label: "Login" },
  logout:             { icon: Icons.logout,  tone: "muted",  label: "Logout" },
  "regenerate-token": { icon: Icons.key,     tone: "warn",   label: "Regen Token" },
  deploy:             { icon: Icons.deploy,  tone: "violet", label: "Deploy" },
  start:              { icon: Icons.play,     tone: "ok",     label: "Start" },
  stop:               { icon: Icons.stop,     tone: "warn",   label: "Stop" },
  restart:            { icon: Icons.restart,  tone: "info",   label: "Restart" },
  broadcast:          { icon: Icons.megaphone,tone: "violet", label: "Broadcast" },
  "user-create":      { icon: Icons.user,    tone: "ok",     label: "User Created" },
  "user-update":      { icon: Icons.user,    tone: "info",   label: "User Updated" },
  "user-delete":      { icon: Icons.user,    tone: "danger", label: "User Deleted" },
  "user-role-change": { icon: Icons.shield,  tone: "violet", label: "Role Changed" },
  "role-create":      { icon: Icons.key,     tone: "ok",     label: "Role Created" },
  "role-update":      { icon: Icons.key,     tone: "violet", label: "Role Updated" },
  "role-delete":      { icon: Icons.key,     tone: "danger", label: "Role Deleted" },
};
function getActionMeta(action: string): { icon: string; tone: Tone; label: string } {
  if (ACTION_META[action]) return ACTION_META[action];
  const a = (action || "").toLowerCase();
  if (a.includes("delete") || a.includes("remove") || a.includes("uninstall")) return { icon: Icons.trash, tone: "danger", label: titleCase(action) };
  if (a.includes("create") || a.includes("add"))                              return { icon: Icons.plus, tone: "ok", label: titleCase(action) };
  if (a.includes("role"))                                                     return { icon: Icons.shield, tone: "violet", label: titleCase(action) };
  if (a.includes("token") || a.includes("regen"))                             return { icon: Icons.key, tone: "warn", label: titleCase(action) };
  if (a.includes("update") || a.includes("edit") || a.includes("config"))     return { icon: Icons.settings, tone: "info", label: titleCase(action) };
  if (a.includes("login"))                                                    return { icon: Icons.online, tone: "ok", label: titleCase(action) };
  if (a.includes("logout"))                                                   return { icon: Icons.logout, tone: "muted", label: titleCase(action) };
  return { icon: Icons.hash, tone: "muted", label: titleCase(action) };
}
function resourceIcon(res: string): string {
  const r = (res || "").toLowerCase();
  if (r.includes("node")) return Icons.server;
  if (r.includes("user")) return Icons.users;
  if (r.includes("deploy")) return Icons.deploy;
  if (r.includes("pot")) return Icons.honeypot;
  if (r.includes("alert")) return Icons.bell;
  if (r.includes("session")) return Icons.signal;
  if (r.includes("token")) return Icons.key;
  if (r.includes("role")) return Icons.shield;
  if (r.includes("org")) return Icons.hash;
  return Icons.clipboard;
}

type UserLite = { id: number; name?: string; email?: string; avatar?: string };

/* ─── actor avatar ──────────────────────────────────────── */
function Avatar({ uid, user }: { uid: number | null; user?: UserLite }) {
  if (uid == null) {
    return (
      <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center", background: "var(--bg-2)", border: "1px solid var(--border-2)", color: "var(--text-faint)" }}>
        <Icon d={Icons.settings} size={13} color="var(--text-faint)" />
      </div>
    );
  }
  if (user?.avatar) return <img src={user.avatar} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  const initials = (user?.name ? user.name.split(/\s+/).map(w => w[0]).slice(0, 2).join("") : user?.email ? user.email.slice(0, 2) : String(uid)).toUpperCase();
  const hue = (uid * 47) % 360;
  return (
    <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: `hsl(${hue},60%,86%)`, border: `2px solid hsl(${hue},45%,72%)`,
      display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800, color: `hsl(${hue},55%,32%)` }}>
      {initials}
    </div>
  );
}

/* ─── expandable row ────────────────────────────────────── */
function AuditRow({ e, user, actorName, expanded, onToggle }: { e: any; user?: UserLite; actorName: string; expanded: boolean; onToggle: () => void }) {
  const m = getActionMeta(e.action);
  const t = TONE[m.tone];
  return (
    <>
      <tr onClick={onToggle}
        style={{ borderBottom: expanded ? "none" : "1px solid var(--border)", cursor: "pointer", background: expanded ? t.bg : undefined, transition: "background 0.15s" }}
        onMouseEnter={ev => { if (!expanded) (ev.currentTarget as HTMLElement).style.background = "var(--sel-amber)"; }}
        onMouseLeave={ev => { if (!expanded) (ev.currentTarget as HTMLElement).style.background = ""; }}>
        <td style={{ padding: "11px 8px 11px 16px", width: 28 }}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}><polyline points="5,3 11,8 5,13" /></svg>
        </td>
        <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{fmtTime(e.created_at)}</p>
          <p style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 1 }}>{fmtRelative(e.created_at)}</p>
        </td>
        <td style={{ padding: "11px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <Avatar uid={e.user_id ?? null} user={user} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: e.user_id == null ? "var(--text-faint)" : "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{actorName}</span>
          </div>
        </td>
        <td style={{ padding: "11px 14px" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: t.bg, color: t.fg, border: `1px solid ${t.border}`, whiteSpace: "nowrap" }}>
            <Icon d={m.icon} size={11} color={t.fg} /> {m.label}
          </span>
        </td>
        <td style={{ padding: "11px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Icon d={resourceIcon(e.resource)} size={14} color="var(--text-faint)" />
            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{e.resource || "—"}</span>
          </div>
        </td>
        <td style={{ padding: "11px 14px" }}>
          {e.resource_id != null
            ? <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 700, background: "var(--warn-bg)", color: "var(--accent)", padding: "2px 7px", borderRadius: 6, border: "1px solid var(--warn-border)" }}>{e.resource_id}</span>
            : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>}
        </td>
        <td style={{ padding: "11px 14px", maxWidth: 240 }}>
          {e.details
            ? <span style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{e.details}</span>
            : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>}
        </td>
      </tr>

      {expanded && (
        <tr style={{ borderBottom: "1px solid var(--border)" }}>
          <td colSpan={7} style={{ padding: 0 }}>
            <div style={{ margin: "0 16px 12px 40px", borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, padding: "12px 16px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                <DetailField label="Event ID" value={`#${e.id}`} />
                <DetailField label="Timestamp" value={new Date(e.created_at).toISOString()} />
                <DetailField label="Actor" value={actorName} />
                <DetailField label="Action" value={e.action} />
                <DetailField label="Resource" value={e.resource || "—"} />
                <DetailField label="Resource ID" value={e.resource_id ?? "—"} />
              </div>
              {e.details && (
                <div style={{ marginTop: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: t.fg, marginBottom: 5 }}>Details</p>
                  <pre className="code-block" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 11.5 }}>{e.details}</pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
function DetailField({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-faint)", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>{String(value)}</p>
    </div>
  );
}
function DaySeparator({ date }: { date: string }) {
  return (
    <tr>
      <td colSpan={7} style={{ padding: "7px 16px 5px", background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="status-dot status-dot-amber" style={{ width: 6, height: 6 }} />
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "var(--text-faint)" }}>{date}</span>
        </div>
      </td>
    </tr>
  );
}

/* ─── stat tile ─────────────────────────────────────────── */
function StatTile({ color, label, value, icon }: { color: string; label: string; value: number; icon: string }) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0, background: `${color}1A`, color }}>
        <Icon d={icon} size={18} color={color} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, minWidth: 0 }}>
        <span className="stat-number-sm">{value.toLocaleString()}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 3, whiteSpace: "nowrap" }}>{label}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════ */
const PAGE_SIZE = 25;
type Range = "all" | "24h" | "7d" | "30d";
const RANGES: { key: Range; label: string; ms: number }[] = [
  { key: "all", label: "All time", ms: 0 },
  { key: "24h", label: "24h", ms: 86400e3 },
  { key: "7d", label: "7 days", ms: 7 * 86400e3 },
  { key: "30d", label: "30 days", ms: 30 * 86400e3 },
];

export default function AuditLogPage() {
  const [search, setSearch] = useState("");
  const [filterAction, setFilter] = useState("all");
  const [range, setRange] = useState<Range>("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const canSeeUsers = useAuthStore(s => s.hasPerm("users.manage"));

  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => (await api.get("/audit-log?limit=500")).data ?? [],
    refetchInterval: 15000,
  });
  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data ?? [],
    enabled: canSeeUsers, staleTime: 60_000, retry: false,
  });

  const raw: any[] = data ?? [];
  const userMap = useMemo(() => {
    const m = new Map<number, UserLite>();
    (usersData ?? []).forEach((u: any) => m.set(u.id, u));
    return m;
  }, [usersData]);
  const actorName = (uid: number | null) => {
    if (uid == null) return "System";
    const u = userMap.get(uid);
    return u?.name || u?.email || `User #${uid}`;
  };

  const actionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    raw.forEach(e => { map[e.action] = (map[e.action] ?? 0) + 1; });
    return map;
  }, [raw]);
  const allActions = useMemo(() => Object.keys(actionCounts).sort((a, b) => actionCounts[b] - actionCounts[a]), [actionCounts]);

  /* stats */
  const now = Date.now();
  const stats = useMemo(() => {
    const day = now - 86400e3;
    const actors = new Set<number>();
    let today = 0, security = 0;
    raw.forEach(e => {
      if (e.user_id != null) actors.add(e.user_id);
      if (new Date(e.created_at).getTime() >= day) today++;
      const a = (e.action || "").toLowerCase();
      if (a.includes("delete") || a.includes("remove") || a.includes("uninstall") || a.includes("regen") || a.includes("role")) security++;
    });
    return { total: raw.length, today, actors: actors.size, security };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const cutoff = range === "all" ? 0 : now - (RANGES.find(r => r.key === range)?.ms ?? 0);
    return raw.filter(e => {
      if (filterAction !== "all" && e.action !== filterAction) return false;
      if (cutoff && new Date(e.created_at).getTime() < cutoff) return false;
      if (!q) return true;
      return String(e.user_id ?? "").includes(q) || actorName(e.user_id ?? null).toLowerCase().includes(q) ||
        (e.action ?? "").toLowerCase().includes(q) || (e.resource ?? "").toLowerCase().includes(q) ||
        String(e.resource_id ?? "").toLowerCase().includes(q) || (e.details ?? "").toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, search, filterAction, range, userMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const rows: Array<{ type: "day"; date: string } | { type: "row"; e: any }> = [];
  let lastDay = "";
  for (const e of paginated) {
    const d = dayKey(e.created_at);
    if (d !== lastDay) { rows.push({ type: "day", date: fmtDate(e.created_at) }); lastDay = d; }
    rows.push({ type: "row", e });
  }

  const anyFilter = !!search || filterAction !== "all" || range !== "all";
  const clearAll = () => { setSearch(""); setFilter("all"); setRange("all"); setPage(1); };
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";

  const exportCSV = () => {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["id", "timestamp", "actor", "action", "resource", "resource_id", "details"].join(",")];
    filtered.forEach(e => lines.push([e.id, new Date(e.created_at).toISOString(), actorName(e.user_id ?? null), e.action, e.resource, e.resource_id ?? "", e.details ?? ""].map(esc).join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `honeybee-audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="page-label">Security</p>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            Audit Log
            <span className="status-dot status-dot-green" title="Live · 15s" style={{ width: 7, height: 7, opacity: isFetching ? 1 : 0.5, transition: "opacity .2s" }} />
          </h1>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 5 }}>
            Every privileged action is recorded. <span style={{ color: "var(--text-faint)" }}>Updated {lastUpdated}</span>
          </p>
        </div>
        <button onClick={exportCSV} disabled={filtered.length === 0} className="btn btn-secondary" style={{ gap: 6 }}>
          <Icon d={Icons.install} size={14} color="var(--text-muted)" /> Export CSV
        </button>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <StatTile color="#F59E0B" label="Total entries" value={stats.total} icon={Icons.clipboard} />
        <StatTile color="#3B82F6" label="Last 24h" value={stats.today} icon={Icons.clock} />
        <StatTile color="#7C3AED" label="Unique actors" value={stats.actors} icon={Icons.users} />
        <StatTile color="#EF4444" label="Security events" value={stats.security} icon={Icons.shield} />
      </div>

      {/* Toolbar */}
      <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
            <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <Icon d={Icons.search} size={14} color="var(--text-faint)" />
            </div>
            <input className="input" placeholder="Search actor, action, resource, details…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }} />
          </div>
          <div className="segmented">
            {RANGES.map(r => (
              <button key={r.key} className={range === r.key ? "is-active" : ""} aria-selected={range === r.key} onClick={() => { setRange(r.key); setPage(1); }}>{r.label}</button>
            ))}
          </div>
          {anyFilter && <button className="btn btn-secondary btn-sm" onClick={clearAll} style={{ gap: 5 }}><Icon d={Icons.close} size={12} color="var(--text-muted)" /> Clear</button>}
        </div>

        {/* Action filter chips */}
        {allActions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            <button onClick={() => { setFilter("all"); setPage(1); }} style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              border: "1.5px solid", transition: "all .15s",
              background: filterAction === "all" ? "var(--text)" : "var(--surface)", color: filterAction === "all" ? "var(--surface)" : "var(--text-muted)",
              borderColor: filterAction === "all" ? "var(--text)" : "var(--border-2)" }}>
              All <span style={{ padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: filterAction === "all" ? "rgba(255,255,255,0.2)" : "var(--bg-2)" }}>{raw.length}</span>
            </button>
            {allActions.map(a => {
              const m = getActionMeta(a); const t = TONE[m.tone]; const active = filterAction === a;
              return (
                <button key={a} onClick={() => { setFilter(f => f === a ? "all" : a); setPage(1); }} style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                  border: "1.5px solid", transition: "all .15s",
                  background: active ? t.fg : t.bg, color: active ? "#fff" : t.fg, borderColor: active ? t.fg : t.border,
                  boxShadow: active ? `0 2px 8px color-mix(in srgb, ${t.fg} 45%, transparent)` : "none", transform: active ? "translateY(-1px)" : "none" }}>
                  <Icon d={m.icon} size={11} color={active ? "#fff" : t.fg} /> {m.label}
                  <span style={{ padding: "1px 6px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: active ? "rgba(255,255,255,0.25)" : "var(--surface)", color: active ? "#fff" : t.fg }}>{actionCounts[a] ?? 0}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th className="th" style={{ width: 28, padding: "10px 8px 10px 16px" }} />
                {["Time", "Actor", "Action", "Resource", "ID", "Details"].map(h => <th key={h} className="th" style={{ padding: "10px 14px" }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td className="td" /><td className="td"><div className="skeleton" style={{ height: 12, width: 90 }} /></td>
                    <td className="td"><div className="skeleton" style={{ height: 12, width: 110 }} /></td>
                    <td className="td"><div className="skeleton" style={{ height: 18, width: 80, borderRadius: 99 }} /></td>
                    <td className="td"><div className="skeleton" style={{ height: 12, width: 70 }} /></td>
                    <td className="td"><div className="skeleton" style={{ height: 12, width: 40 }} /></td>
                    <td className="td"><div className="skeleton" style={{ height: 12, width: "70%" }} /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 0 }}>
                  <div className="empty-state">
                    <div className="empty-icon"><Icon d={anyFilter ? Icons.search : Icons.clipboard} size={26} color="var(--text-faint)" /></div>
                    <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{anyFilter ? "No entries match your filters" : "No audit entries yet"}</p>
                    <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{anyFilter ? "Try adjusting your search, range, or action filter." : "Privileged actions will appear here as they happen."}</p>
                    {anyFilter && <button onClick={clearAll} className="btn btn-secondary btn-sm" style={{ marginTop: 4 }}>Clear filters</button>}
                  </div>
                </td></tr>
              ) : rows.map((row, i) =>
                row.type === "day"
                  ? <DaySeparator key={`day-${i}`} date={row.date} />
                  : <AuditRow key={row.e.id} e={row.e} user={row.e.user_id != null ? userMap.get(row.e.user_id) : undefined}
                      actorName={actorName(row.e.user_id ?? null)} expanded={expanded === row.e.id}
                      onToggle={() => setExpanded(p => p === row.e.id ? null : row.e.id)} />
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-2)", flexWrap: "wrap", gap: 8 }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Showing <strong>{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)}</strong> of <strong>{filtered.length}</strong>
            </p>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button className="btn btn-secondary btn-xs" disabled={safePage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Prev</button>
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                .reduce<(number | "…")[]>((acc, p, i, arr) => { if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…"); acc.push(p); return acc; }, [])
                .map((p, i) => p === "…"
                  ? <span key={`e-${i}`} style={{ padding: "4px 8px", fontSize: 12, color: "var(--text-faint)" }}>…</span>
                  : <button key={p} className="btn btn-xs" onClick={() => setPage(p as number)}
                      style={{ background: safePage === p ? "var(--accent)" : "var(--surface)", color: safePage === p ? "#fff" : "var(--text-muted)", border: `1px solid ${safePage === p ? "var(--accent)" : "var(--border-2)"}`, fontWeight: 700 }}>{p}</button>)}
              <button className="btn btn-secondary btn-xs" disabled={safePage === totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
