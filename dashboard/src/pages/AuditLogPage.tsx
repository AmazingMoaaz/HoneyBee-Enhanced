import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import api from "../api/client";

/* ─── Helpers ───────────────────────────────────────────── */
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}
function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
function dayKey(iso: string) {
  return new Date(iso).toDateString();
}

/* ─── Action meta ───────────────────────────────────────── */
interface ActionMeta { bg: string; fg: string; border: string; icon: string; label: string; }
const ACTION_META: Record<string, ActionMeta> = {
  create:             { bg: "#F0FDF4", fg: "#15803D", border: "#86EFAC", icon: "✦", label: "Create" },
  delete:             { bg: "#FEF2F2", fg: "#DC2626", border: "#FECACA", icon: "✕", label: "Delete" },
  uninstall:          { bg: "#FEF2F2", fg: "#DC2626", border: "#FECACA", icon: "⊖", label: "Uninstall" },
  update:             { bg: "#EFF6FF", fg: "#2563EB", border: "#BFDBFE", icon: "✎", label: "Update" },
  login:              { bg: "#F0FDF4", fg: "#059669", border: "#6EE7B7", icon: "→", label: "Login" },
  logout:             { bg: "#F8FAFC", fg: "#475569", border: "#CBD5E1", icon: "←", label: "Logout" },
  "regenerate-token": { bg: "#FFFBEB", fg: "#D97706", border: "#FCD34D", icon: "↻", label: "Regen Token" },
  deploy:             { bg: "#FAF5FF", fg: "#7C3AED", border: "#C4B5FD", icon: "▲", label: "Deploy" },
  start:              { bg: "#ECFDF5", fg: "#047857", border: "#6EE7B7", icon: "▶", label: "Start" },
  stop:               { bg: "#FFF7ED", fg: "#C2410C", border: "#FED7AA", icon: "■", label: "Stop" },
};
function getActionMeta(action: string): ActionMeta {
  return ACTION_META[action] ?? { bg: "#F8FAFC", fg: "#475569", border: "#E2E8F0", icon: "·", label: action };
}

/* ─── Resource icon ─────────────────────────────────────── */
function resourceIcon(res: string) {
  if (!res) return "📦";
  const r = res.toLowerCase();
  if (r.includes("node"))   return "🖥";
  if (r.includes("user"))   return "👤";
  if (r.includes("deploy")) return "🚀";
  if (r.includes("pot"))    return "🍯";
  if (r.includes("alert"))  return "🔔";
  if (r.includes("session"))return "💬";
  if (r.includes("token"))  return "🔑";
  if (r.includes("org"))    return "🏢";
  return "📦";
}

/* ─── User avatar ───────────────────────────────────────── */
function UserAvatar({ userId }: { userId: any }) {
  const id = userId ?? 0;
  const hue = (id * 47) % 360;
  const initials = `#${id}`;
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
      background: `hsl(${hue},60%,88%)`,
      border: `2px solid hsl(${hue},45%,75%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 9, fontWeight: 800, color: `hsl(${hue},50%,35%)`,
      fontFamily: "monospace",
    }}>
      {initials}
    </div>
  );
}

/* ─── Stat chip ─────────────────────────────────────────── */
function StatChip({ label, value, meta, active }: { label: string; value: number; meta: ActionMeta; active?: boolean }) {
  return (
    <div className="card card-hover" style={{
      padding: "12px 16px", display: "flex", alignItems: "center", gap: 10,
      background: active ? meta.bg : undefined,
      border: active ? `2px solid ${meta.border}` : undefined,
      boxShadow: active ? `0 0 0 3px ${meta.border}55, 0 2px 8px ${meta.border}44` : undefined,
      transform: active ? "translateY(-1px)" : undefined,
      transition: "all 0.18s",
      position: "relative",
    }}>
      {active && (
        <div style={{
          position: "absolute", top: 6, right: 8,
          width: 16, height: 16, borderRadius: "50%",
          background: meta.fg, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg viewBox="0 0 12 12" width="8" height="8" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="2,6 5,9 10,3" />
          </svg>
        </div>
      )}
      <div style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: active ? meta.fg : meta.bg,
        border: `1px solid ${meta.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 15, color: active ? "#fff" : meta.fg,
        transition: "all 0.18s",
      }}>
        {meta.icon}
      </div>
      <div>
        <p style={{ fontSize: 18, fontWeight: 800, color: meta.fg, lineHeight: 1, letterSpacing: "-0.02em" }}>
          {value.toLocaleString()}
        </p>
        <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: active ? meta.fg : "#94A3B8", marginTop: 2 }}>
          {label}
        </p>
      </div>
    </div>
  );
}

/* ─── Expandable row ────────────────────────────────────── */
function AuditRow({ e, expanded, onToggle }: { e: any; expanded: boolean; onToggle: () => void }) {
  const meta = getActionMeta(e.action);
  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: expanded ? "none" : "1px solid rgba(15,23,42,0.05)",
          cursor: "pointer",
          background: expanded ? `${meta.bg}66` : undefined,
          transition: "background 0.15s",
        }}
        onMouseEnter={ev => { if (!expanded) (ev.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.03)"; }}
        onMouseLeave={ev => { if (!expanded) (ev.currentTarget as HTMLElement).style.background = ""; }}
      >
        {/* Expand chevron */}
        <td style={{ padding: "11px 8px 11px 16px", width: 28 }}>
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round"
            style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
            <polyline points="5,3 11,8 5,13" />
          </svg>
        </td>

        {/* Time */}
        <td style={{ padding: "11px 14px", whiteSpace: "nowrap" }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", fontFamily: "monospace" }}>{fmtTime(e.created_at)}</p>
          <p style={{ fontSize: 10, color: "#94A3B8", marginTop: 1 }}>{fmtRelative(e.created_at)}</p>
        </td>

        {/* User */}
        <td style={{ padding: "11px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <UserAvatar userId={e.user_id} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>
              {e.user_id ? `User #${e.user_id}` : "System"}
            </span>
          </div>
        </td>

        {/* Action badge */}
        <td style={{ padding: "11px 14px" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "3px 9px", borderRadius: 6, fontSize: 11, fontWeight: 700,
            background: meta.bg, color: meta.fg,
            border: `1px solid ${meta.border}`,
            letterSpacing: "0.02em",
          }}>
            <span style={{ fontSize: 12 }}>{meta.icon}</span>
            {meta.label}
          </span>
        </td>

        {/* Resource */}
        <td style={{ padding: "11px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>{resourceIcon(e.resource)}</span>
            <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600, color: "#334155" }}>{e.resource || "—"}</span>
          </div>
        </td>

        {/* Resource ID */}
        <td style={{ padding: "11px 14px" }}>
          {e.resource_id != null ? (
            <span style={{
              fontFamily: "monospace", fontSize: 11, fontWeight: 700,
              background: "rgba(245,158,11,0.10)", color: "#92400E",
              padding: "2px 7px", borderRadius: 5,
            }}>
              {e.resource_id}
            </span>
          ) : (
            <span style={{ color: "#CBD5E1", fontSize: 12 }}>—</span>
          )}
        </td>

        {/* Details preview */}
        <td style={{ padding: "11px 14px", maxWidth: 220 }}>
          {e.details
            ? <span style={{ fontSize: 11, color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{e.details}</span>
            : <span style={{ color: "#CBD5E1", fontSize: 12 }}>—</span>
          }
        </td>
      </tr>

      {/* Expanded detail panel */}
      {expanded && (
        <tr style={{ borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
          <td colSpan={7} style={{ padding: 0 }}>
            <div style={{
              margin: "0 16px 12px 40px", borderRadius: 10,
              background: meta.bg, border: `1px solid ${meta.border}`,
              padding: "12px 16px",
            }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                <DetailField label="Event ID"    value={`#${e.id}`} mono />
                <DetailField label="Timestamp"   value={new Date(e.created_at).toISOString()} mono />
                <DetailField label="User ID"     value={e.user_id ?? "System"} mono />
                <DetailField label="Action"      value={e.action} mono />
                <DetailField label="Resource"    value={e.resource || "—"} mono />
                <DetailField label="Resource ID" value={e.resource_id ?? "—"} mono />
              </div>
              {e.details && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${meta.border}` }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: meta.fg, marginBottom: 4 }}>Details</p>
                  <p style={{ fontSize: 12, color: "#334155", fontFamily: "monospace", wordBreak: "break-all" }}>{e.details}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailField({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#94A3B8", marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", fontFamily: mono ? "monospace" : undefined }}>{String(value)}</p>
    </div>
  );
}

/* ─── Day separator ─────────────────────────────────────── */
function DaySeparator({ date }: { date: string }) {
  return (
    <tr>
      <td colSpan={7} style={{ padding: "6px 16px 4px", background: "#F8FAFC", borderBottom: "1px solid rgba(15,23,42,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B", flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.09em", color: "#94A3B8" }}>
            {date}
          </span>
        </div>
      </td>
    </tr>
  );
}

/* ─── Skeleton ──────────────────────────────────────────── */
function Skeleton() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <div style={{ width: 80, height: 9, borderRadius: 5, background: "rgba(15,23,42,0.07)", marginBottom: 8 }} />
        <div style={{ width: 180, height: 22, borderRadius: 8, background: "rgba(15,23,42,0.09)" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="card" style={{ padding: "12px 16px", height: 62 }}>
            <div style={{ width: "50%", height: 9, borderRadius: 5, background: "rgba(15,23,42,0.07)" }} />
          </div>
        ))}
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        {[...Array(8)].map((_, i) => (
          <div key={i} style={{ padding: "14px 18px", borderBottom: "1px solid rgba(15,23,42,0.05)", display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ width: 80, height: 10, borderRadius: 5, background: "rgba(15,23,42,0.06)" }} />
            <div style={{ width: 50, height: 10, borderRadius: 5, background: "rgba(15,23,42,0.05)" }} />
            <div style={{ width: 70, height: 18, borderRadius: 6, background: "rgba(15,23,42,0.06)" }} />
            <div style={{ width: 90, height: 10, borderRadius: 5, background: "rgba(15,23,42,0.05)" }} />
            <div style={{ flex: 1, height: 10, borderRadius: 5, background: "rgba(15,23,42,0.04)" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════ */
const PAGE_SIZE = 25;

export default function AuditLogPage() {
  const [search, setSearch]       = useState("");
  const [filterAction, setFilter] = useState("all");
  const [page, setPage]           = useState(1);
  const [expanded, setExpanded]   = useState<number | null>(null);

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => (await api.get("/audit-log?limit=500")).data,
    refetchInterval: 15000,
  });

  const raw: any[] = data ?? [];

  /* Derive action summary counts */
  const actionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    raw.forEach(e => { map[e.action] = (map[e.action] ?? 0) + 1; });
    return map;
  }, [raw]);

  /* Top 4 actions by count for stat chips */
  const topActions = useMemo(() =>
    Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4),
    [actionCounts]
  );

  /* All unique actions for filter dropdown */
  const allActions = useMemo(() => Array.from(new Set(raw.map(e => e.action))).sort(), [raw]);

  /* Filtered list */
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return raw.filter(e => {
      if (filterAction !== "all" && e.action !== filterAction) return false;
      if (!q) return true;
      return (
        String(e.user_id ?? "").includes(q) ||
        (e.action ?? "").toLowerCase().includes(q) ||
        (e.resource ?? "").toLowerCase().includes(q) ||
        String(e.resource_id ?? "").toLowerCase().includes(q) ||
        (e.details ?? "").toLowerCase().includes(q)
      );
    });
  }, [raw, search, filterAction]);

  /* Pagination */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /* Group by day for separators */
  const rows: Array<{ type: "day"; date: string } | { type: "row"; e: any }> = [];
  let lastDay = "";
  for (const e of paginated) {
    const d = dayKey(e.created_at);
    if (d !== lastDay) { rows.push({ type: "day", date: fmtDate(e.created_at) }); lastDay = d; }
    rows.push({ type: "row", e });
  }

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  if (isLoading) return <Skeleton />;

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p className="page-label">Security</p>
          <h1 className="page-title">Audit Log</h1>
          <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 3 }}>
            <span style={{ color: "#F59E0B", fontWeight: 700 }}>{raw.length.toLocaleString()}</span> total entries &nbsp;·&nbsp;
            <span style={{ color: "#475569", fontWeight: 600 }}>{filtered.length.toLocaleString()}</span> shown &nbsp;·&nbsp;
            updated {lastUpdated}
          </p>
        </div>
        {/* Live indicator */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 12px", borderRadius: 20,
          background: "#F0FDF4", border: "1px solid #86EFAC",
          fontSize: 11, fontWeight: 700, color: "#15803D",
        }}>
          <span className="dot-online" style={{ width: 6, height: 6 }} />
          Live · 15s refresh
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Search row */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 220px", position: "relative" }}>
            <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="#94A3B8" strokeWidth="2"
              style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx="8" cy="8" r="5" /><path d="M17 17l-4-4" />
            </svg>
            <input
              className="input"
              placeholder="Search user, action, resource, details…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              style={{ paddingLeft: 30, fontSize: 13 }}
            />
          </div>
          {(search || filterAction !== "all") && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { setSearch(""); setFilter("all"); setPage(1); }}
              style={{ alignSelf: "center" }}
            >
              ✕ Clear filters
            </button>
          )}
        </div>

        {/* Action filter pills */}
        {allActions.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6,
            padding: "10px 14px",
            background: "#F8FAFC",
            borderRadius: 12,
            border: "1px solid rgba(15,23,42,0.07)",
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#94A3B8", alignSelf: "center", marginRight: 4 }}>Filter:</span>
            {/* All button */}
            <button
              onClick={() => { setFilter("all"); setPage(1); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                cursor: "pointer", border: "1.5px solid",
                transition: "all 0.15s",
                background: filterAction === "all" ? "#0F172A" : "#1E293B",
                color: "#fff",
                borderColor: filterAction === "all" ? "#0F172A" : "#334155",
                boxShadow: filterAction === "all" ? "0 2px 6px rgba(15,23,42,0.35)" : "0 1px 3px rgba(15,23,42,0.25)",
                opacity: filterAction === "all" ? 1 : 0.72,
              }}
            >
              <span style={{ fontSize: 10, opacity: 0.7 }}>⊞</span>
              All
              <span style={{
                background: "rgba(255,255,255,0.18)",
                color: "#fff",
                padding: "1px 6px", borderRadius: 10, fontSize: 10, fontWeight: 800,
              }}>{raw.length}</span>
            </button>
            {/* Per-action pill buttons */}
            {allActions.map(a => {
              const m = getActionMeta(a);
              const isActive = filterAction === a;
              return (
                <button
                  key={a}
                  onClick={() => { setFilter(f => f === a ? "all" : a); setPage(1); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "4px 11px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                    cursor: "pointer", border: "1.5px solid",
                    transition: "all 0.15s",
                    background: isActive ? m.fg : "#fff",
                    color: isActive ? "#fff" : m.fg,
                    borderColor: isActive ? m.fg : m.border,
                    boxShadow: isActive ? `0 2px 8px ${m.border}88` : "none",
                    transform: isActive ? "translateY(-1px)" : "none",
                  }}
                >
                  <span style={{ fontSize: 12 }}>{m.icon}</span>
                  {m.label}
                  <span style={{
                    background: isActive ? "rgba(255,255,255,0.28)" : m.bg,
                    color: isActive ? "#fff" : m.fg,
                    padding: "1px 6px", borderRadius: 10, fontSize: 10, fontWeight: 800,
                    border: isActive ? "none" : `1px solid ${m.border}`,
                  }}>{actionCounts[a] ?? 0}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Table ───────────────────────────────────────────── */}
      <div className="card" style={{ overflow: "hidden" }}>
        {/* Table header */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={{ width: 28, padding: "10px 8px 10px 16px", borderBottom: "1px solid rgba(15,23,42,0.07)" }} />
                {["Time", "User", "Action", "Resource", "ID", "Details"].map(h => (
                  <th key={h} style={{
                    padding: "10px 14px", textAlign: "left", whiteSpace: "nowrap",
                    fontSize: 10, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.09em", color: "#94A3B8",
                    borderBottom: "1px solid rgba(15,23,42,0.07)",
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "48px 24px", textAlign: "center" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>🔍</div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "#475569" }}>No entries match your filters</p>
                    <p style={{ fontSize: 12, color: "#94A3B8", marginTop: 4 }}>Try adjusting your search or filter</p>
                  </td>
                </tr>
              )}
              {rows.map((row, i) =>
                row.type === "day"
                  ? <DaySeparator key={`day-${i}`} date={row.date} />
                  : <AuditRow
                      key={row.e.id}
                      e={row.e}
                      expanded={expanded === row.e.id}
                      onToggle={() => setExpanded(p => p === row.e.id ? null : row.e.id)}
                    />
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────── */}
        {totalPages > 1 && (
          <div style={{
            padding: "12px 18px", borderTop: "1px solid rgba(15,23,42,0.06)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            background: "#FAFAFA", flexWrap: "wrap", gap: 8,
          }}>
            <p style={{ fontSize: 12, color: "#64748B" }}>
              Showing <strong>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)}</strong> of{" "}
              <strong>{filtered.length}</strong> entries
            </p>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className="btn btn-secondary btn-xs"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >← Prev</button>

              {/* Page number buttons (show up to 7) */}
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
                .reduce<(number | "…")[]>((acc, p, i, arr) => {
                  if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push("…");
                  acc.push(p); return acc;
                }, [])
                .map((p, i) =>
                  p === "…"
                    ? <span key={`ellipsis-${i}`} style={{ padding: "4px 8px", fontSize: 12, color: "#94A3B8" }}>…</span>
                    : <button
                        key={p}
                        className="btn btn-xs"
                        onClick={() => setPage(p as number)}
                        style={{
                          background: page === p ? "#F59E0B" : "#fff",
                          color: page === p ? "#fff" : "#475569",
                          border: `1px solid ${page === p ? "#F59E0B" : "rgba(15,23,42,0.12)"}`,
                          fontWeight: 700,
                        }}
                      >{p}</button>
                )
              }

              <button
                className="btn btn-secondary btn-xs"
                disabled={page === totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
