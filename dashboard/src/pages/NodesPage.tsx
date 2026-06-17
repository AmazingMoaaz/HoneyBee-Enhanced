import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createPortal } from "react-dom";
import api from "../api/client";
import { Icon, Icons } from "../components/Icons";
import { copyToClipboard } from "../hooks/useCopy";
import { useAuthStore } from "../stores/auth";

/* ─────────────────────────────────────────────────────────────────────
   Node Manager — fleet command center
   • Grid + Table views (segmented)
   • Live fleet stats: nodes, honeypots deployed/running, avg load
   • Per-node honeypot counts (joined from /deployments)
   • Full action menu: Manage · Copy ID · Regenerate token · Log Analyzer
     toggle · Uninstall agent · Delete  (all RBAC-gated by nodes.manage)
   • Multi-select + bulk delete · search · filter · sort
   • One-time install banner (create + token rotation)
───────────────────────────────────────────────────────────────────── */

type CreatedNode = {
  id: number; name: string; token: string;
  la_enabled?: boolean;
  la_workspace_id?: string;
  la_workspace_name?: string;
  la_workspace_url?: string;
  la_error?: string;
};
type Node = {
  id: number; name: string; online: boolean; status?: string;
  last_heartbeat: string | null; created_at?: string; display_order: number;
  ip_address?: string; os?: string; arch?: string; hostname?: string;
  cpu_pct?: number; mem_pct?: number; disk_pct?: number; uptime_secs?: number;
  la_enabled?: boolean;
  la_workspace_id?: string;
  la_workspace_name?: string;
  la_workspace_url?: string;
};
type Deployment = { id: number; node_id: number; status: string; honeypot_type?: string };
type LAInfo = { enabled: boolean; public_url: string };
type PotStat = { total: number; running: number };

/* ── Helpers ─────────────────────────────────────────────────────── */
function relTime(iso: string | null | undefined): string {
  if (!iso) return "Never seen";
  const d = Date.now() - new Date(iso).getTime();
  if (d < 30_000)       return "Just now";
  const m = Math.floor(d / 60_000);
  if (m < 60)           return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)           return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7)         return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
function fmtUptime(secs?: number): string | null {
  if (!secs || secs <= 0) return null;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
/* Online wins; otherwise surface the server status enum (deploying/failed). */
function statusInfo(n: Node): { label: string; dot: string; chip: string; style?: React.CSSProperties } {
  if (n.online)               return { label: "Online",    dot: "status-dot-green", chip: "chip chip-green" };
  if (n.status === "failed")  return { label: "Failed",    dot: "status-dot-red",   chip: "chip",
    style: { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" } };
  if (n.status === "deploying") return { label: "Deploying", dot: "status-dot-amber", chip: "chip chip-amber" };
  return { label: "Offline", dot: "status-dot-slate", chip: "chip chip-slate" };
}

/* ════════════════════════════════════════════════════════════════════
   Install banner — shown after create or token rotation
═══════════════════════════════════════════════════════════════════════ */
function InstallBanner({ created, rotated, onClose }: { created: CreatedNode; rotated?: boolean; onClose: () => void }) {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [copied,   setCopied]   = useState<string | null>(null);
  const base = window.location.origin;
  const cmd  = platform === "linux"
    ? `curl -fsSL "${base}/api/v1/nodes/${created.id}/install?token=${created.token}" | bash`
    : `irm "${base}/api/v1/nodes/${created.id}/install?platform=windows&token=${created.token}" | iex`;

  const copy = (text: string, key: string) =>
    copyToClipboard(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2200); });

  return (
    <div className="card animate-fade-up" style={{ overflow: "hidden", position: "relative" }}>
      <div style={{
        height: 3,
        background: "linear-gradient(90deg, #FCD34D, #F59E0B, #D97706, #F59E0B, #FCD34D)",
        backgroundSize: "200% 100%", animation: "shimmer 4s linear infinite",
      }} />
      <div style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div className="glow-amber" style={{
              width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", flexShrink: 0,
              background: "linear-gradient(135deg, #FCD34D, #D97706)",
            }}>
              <Icon d={rotated ? Icons.refresh : Icons.spark} size={19} color="#1C0A00" sw={2.2} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 15, color: "var(--text)", lineHeight: 1.3 }}>
                Node <span style={{ color: "var(--accent)" }}>{created.name}</span> {rotated ? "— new token issued" : "registered"}
              </p>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                {rotated
                  ? "The old token is now invalid. Re-run the install command to use the new one."
                  : "Run the install command on your target server to bring it online."}
              </p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon d={Icons.close} size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Token */}
          <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--border-2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 13px",
              background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", display: "flex",
                alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <Icon d={Icons.key} size={11} color="var(--accent)" sw={2.2} /> Token
              </span>
              <button onClick={() => copy(created.token, "token")} className="btn btn-xs btn-secondary" style={{ gap: 4 }}>
                {copied === "token"
                  ? <><Icon d={Icons.check} size={11} color="var(--ok)" /> Copied</>
                  : <><Icon d={Icons.copy} size={11} color="var(--text-muted)" /> Copy</>}
              </button>
            </div>
            <div className="code-block" style={{ borderRadius: 0, fontSize: 10.5, lineHeight: 1.7, margin: 0, padding: "12px 13px" }}>
              {created.token}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 13px",
              background: "var(--danger-bg)", borderTop: "1px solid var(--danger-border)",
              fontSize: 11, color: "var(--danger)", fontWeight: 600 }}>
              <Icon d={Icons.warn} size={11} color="var(--danger)" /> Shown once — save it now.
            </div>
          </div>

          {/* Install command */}
          <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid var(--border-2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px 7px 13px",
              background: "var(--bg-2)", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", gap: 5 }}>
                {(["linux", "windows"] as const).map(p => (
                  <button key={p} onClick={() => setPlatform(p)}
                    className={`btn btn-xs ${platform === p ? "btn-primary" : "btn-secondary"}`}
                    style={{ gap: 4, textTransform: "capitalize" }}>
                    {p}
                  </button>
                ))}
              </div>
              <button onClick={() => copy(cmd, "cmd")} className="btn btn-xs btn-secondary" style={{ gap: 4 }}>
                {copied === "cmd"
                  ? <><Icon d={Icons.check} size={11} color="var(--ok)" /> Copied</>
                  : <><Icon d={Icons.copy} size={11} color="var(--text-muted)" /> Copy</>}
              </button>
            </div>
            <div className="code-block" style={{ borderRadius: 0, fontSize: 10.5, lineHeight: 1.7, margin: 0, padding: "12px 13px" }}>
              <span style={{ color: "#FCD34D", fontWeight: 700 }}>{cmd.split(" ")[0]}</span>
              {" " + cmd.slice(cmd.indexOf(" ") + 1)}
            </div>
          </div>
        </div>

        {created.la_enabled && created.la_workspace_url && (
          <div style={{ marginTop: 14, padding: "11px 14px", borderRadius: 10, background: "var(--info-bg)",
            border: "1px solid var(--info-border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center",
              background: "linear-gradient(135deg, #60A5FA, #2563EB)" }}>
              <Icon d={Icons.search} size={15} color="#FFFFFF" sw={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <p style={{ fontWeight: 700, fontSize: 12.5, color: "var(--info)", marginBottom: 2 }}>Log Analyzer workspace ready</p>
              <p style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Events &amp; logs from <strong>{created.name}</strong> stream into{" "}
                <code style={{ fontFamily: "ui-monospace, monospace", color: "var(--info)", fontSize: 11 }}>
                  {created.la_workspace_name}
                </code>.
              </p>
            </div>
            <a href={created.la_workspace_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ gap: 5 }}>
              Open <Icon d={Icons.external} size={12} color="var(--text-muted)" />
            </a>
          </div>
        )}
        {created.la_error && (
          <div style={{ marginTop: 14, padding: "9px 13px", borderRadius: 10, background: "var(--danger-bg)",
            border: "1px solid var(--danger-border)", fontSize: 12, color: "var(--danger)" }}>
            <strong>Log Analyzer integration failed:</strong> {created.la_error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Shared kebab menu items (used by card + row) ─────────────────── */
type ActKind = "regen" | "uninstall" | "delete" | "toggle-la";
function NodeMenuItems({ node, canManage, laIntegration, copiedId, onCopyId, onAct }: {
  node: Node; canManage: boolean; laIntegration: boolean; copiedId: boolean;
  onCopyId: () => void; onAct: (k: ActKind) => void;
}) {
  return (
    <>
      <Link to={`/nodes/${node.id}`} className="menu-item">
        <Icon d={Icons.settings} size={14} color="var(--text-muted)" /> Manage
      </Link>
      <button onClick={onCopyId} className="menu-item">
        <Icon d={copiedId ? Icons.check : Icons.copy} size={14} color={copiedId ? "var(--ok)" : "var(--text-muted)"} />
        {copiedId ? "Copied!" : "Copy node ID"}
      </button>
      {canManage && (
        <>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
          <button onClick={() => onAct("regen")} className="menu-item">
            <Icon d={Icons.refresh} size={14} color="var(--text-muted)" /> Regenerate token
          </button>
          {laIntegration && (
            <button onClick={() => onAct("toggle-la")} className="menu-item">
              <Icon d={Icons.search} size={14} color={node.la_enabled ? "var(--info)" : "var(--text-muted)"} />
              {node.la_enabled ? "Disable Log Analyzer" : "Enable Log Analyzer"}
            </button>
          )}
          <button onClick={() => onAct("uninstall")} className="menu-item">
            <Icon d={Icons.offline} size={14} color="var(--text-muted)" /> Uninstall agent
          </button>
          <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
          <button onClick={() => onAct("delete")} className="menu-item menu-item-danger">
            <Icon d={Icons.trash} size={14} color="var(--danger)" /> Delete node
          </button>
        </>
      )}
    </>
  );
}

/* Kebab trigger + PORTAL dropdown. Rendered into document.body and positioned
   from the button's rect so the card's overflow:hidden (and the table's
   overflow) can never clip it. Flips above the button when space is tight. */
function ActionsMenu({ node, canManage, laIntegration, onAct }: {
  node: Node; canManage: boolean; laIntegration: boolean; onAct: (k: ActKind, n: Node) => void;
}) {
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const right = window.innerWidth - r.right;
    const spaceBelow = window.innerHeight - r.bottom;
    setCoords(spaceBelow < 300 ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copyId = () => { copyToClipboard(String(node.id)).then(() => { setCopiedId(true); setTimeout(() => setCopiedId(false), 1600); }); };

  return (
    <>
      <button ref={btnRef} className="icon-btn" aria-label="Actions" aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : openMenu(); }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open && coords && createPortal(
        <div ref={menuRef} role="menu" className="menu animate-fade-up"
          style={{ position: "fixed", right: coords.right, zIndex: 1000, minWidth: 188, maxHeight: "min(70vh, 360px)", overflowY: "auto",
            ...(coords.top != null ? { top: coords.top } : {}), ...(coords.bottom != null ? { bottom: coords.bottom } : {}) }}
          onClick={(e) => e.stopPropagation()}>
          <NodeMenuItems node={node} canManage={canManage} laIntegration={laIntegration} copiedId={copiedId}
            onCopyId={copyId} onAct={(k) => { setOpen(false); onAct(k, node); }} />
        </div>, document.body)}
    </>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Grid card
═══════════════════════════════════════════════════════════════════════ */
function NodeCard({ node, pots, canManage, laIntegration, selectMode, selected, onSelect, onAct }: {
  node: Node; pots: PotStat; canManage: boolean; laIntegration: boolean;
  selectMode: boolean; selected: boolean; onSelect: (id: number) => void; onAct: (k: ActKind, n: Node) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  const online  = node.online;
  const initial = (node.name ?? "?").charAt(0).toUpperCase();
  const si = statusInfo(node);
  const up = fmtUptime(node.uptime_secs);

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMove}
      onClick={selectMode ? () => onSelect(node.id) : undefined}
      className={`card-interactive ${online ? "ring-online" : ""}`}
      style={{
        padding: 0, overflow: "hidden", display: "flex", flexDirection: "column",
        borderLeft: `3px solid ${online ? "var(--ok)" : "var(--border-2)"}`,
        cursor: selectMode ? "pointer" : undefined,
        boxShadow: selected ? "0 0 0 2px var(--accent)" : undefined,
      }}
    >
      <div style={{ padding: "18px 20px 12px", flex: 1, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {selectMode && (
            <input type="checkbox" checked={selected} onChange={() => onSelect(node.id)} onClick={e => e.stopPropagation()}
              style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }} />
          )}
          <div className={online ? "glow-amber" : ""} style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0, display: "grid", placeItems: "center",
            fontWeight: 800, fontSize: 21, letterSpacing: "-0.02em",
            background: online ? "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)" : "var(--bg-2)",
            color: online ? "#1C0A00" : "var(--text-muted)",
          }}>
            {initial}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 800, fontSize: 15.5, color: "var(--text)", marginBottom: 7,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.name}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className={si.chip} style={{ paddingLeft: 8, ...si.style }}>
                <span className={`status-dot ${si.dot}`} /> {si.label}
              </span>
              <span className="chip" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>#{node.display_order}</span>
            </div>
          </div>

          {!selectMode && (
            <div style={{ marginLeft: -4 }}>
              <ActionsMenu node={node} canManage={canManage} laIntegration={laIntegration} onAct={onAct} />
            </div>
          )}
        </div>

        {/* Host + honeypots */}
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11 }}>
          {pots.total > 0 && (
            <span className={pots.running > 0 ? "chip chip-green" : "chip"} style={{ fontWeight: 700, fontSize: 10.5 }}>
              <Icon d={Icons.honeypot} size={11} color={pots.running > 0 ? "var(--ok)" : "var(--text-muted)"} />
              {pots.running}/{pots.total} pot{pots.total === 1 ? "" : "s"}
            </span>
          )}
          {node.ip_address && (
            <span className="chip" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, fontSize: 10.5 }}>
              <Icon d={Icons.globe} size={10} color="var(--text-muted)" /> {node.ip_address}
            </span>
          )}
          {node.os && <span className="chip" style={{ fontSize: 10.5 }}>{node.os}/{node.arch}</span>}
          {node.la_enabled && (
            <a href={node.la_workspace_url || undefined} target="_blank" rel="noreferrer"
              title={`Streaming logs to "${node.la_workspace_name || "workspace"}"`}
              onClick={(e) => e.stopPropagation()} className="chip"
              style={{ background: "var(--info-bg)", color: "var(--info)", border: "1px solid var(--info-border)",
                textDecoration: "none", fontWeight: 700, fontSize: 10.5 }}>
              <Icon d={Icons.search} size={10} color="var(--info)" sw={2.4} /> Log Analyzer
            </a>
          )}
        </div>

        {/* Perf bars */}
        {online && (node.cpu_pct !== undefined || node.mem_pct !== undefined) && (
          <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
            <MiniBar label="CPU" value={node.cpu_pct ?? 0} color="#F59E0B" />
            <MiniBar label="MEM" value={node.mem_pct ?? 0} color="#3B82F6" />
            <MiniBar label="DISK" value={node.disk_pct ?? 0} color="#22C55E" />
          </div>
        )}

        {/* Meta row */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed var(--border)",
          display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--text-faint)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon d={Icons.heart} size={12} color={online ? "var(--ok)" : "var(--text-faint)"} sw={2.2} />
            <span>Seen <strong style={{ color: "var(--text-muted)", fontWeight: 700 }}>{relTime(node.last_heartbeat)}</strong></span>
          </span>
          {up && online && (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Icon d={Icons.clock} size={12} color="var(--text-faint)" sw={2.2} />
              <span>Up <strong style={{ color: "var(--text-muted)", fontWeight: 700 }}>{up}</strong></span>
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "10px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-2)" }}>
        <Link to={`/nodes/${node.id}`} className="btn btn-sm btn-primary shine" style={{ gap: 6 }} onClick={e => e.stopPropagation()}>
          Manage <Icon d={Icons.arrow} size={13} color="#1C0A00" />
        </Link>
        <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "monospace" }}>ID {node.id}</span>
      </div>
    </div>
  );
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 50 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color }}>{value.toFixed(0)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "var(--bg-2)" }}>
        <div style={{ height: 4, borderRadius: 2, background: color, width: `${Math.min(value, 100)}%`, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Table row
═══════════════════════════════════════════════════════════════════════ */
function NodeRow({ node, pots, canManage, laIntegration, selectMode, selected, onSelect, onAct }: {
  node: Node; pots: PotStat; canManage: boolean; laIntegration: boolean;
  selectMode: boolean; selected: boolean; onSelect: (id: number) => void; onAct: (k: ActKind, n: Node) => void;
}) {
  const online = node.online;
  const si = statusInfo(node);

  return (
    <tr className="tr" onClick={selectMode ? () => onSelect(node.id) : undefined} style={selectMode ? { cursor: "pointer" } : undefined}>
      {selectMode && (
        <td className="td" style={{ width: 36 }}>
          <input type="checkbox" checked={selected} onChange={() => onSelect(node.id)} onClick={e => e.stopPropagation()}
            style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }} />
        </td>
      )}
      <td className="td">
        <Link to={`/nodes/${node.id}`} onClick={selectMode ? (e) => { e.preventDefault(); onSelect(node.id); } : undefined}
          style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: "grid", placeItems: "center",
            fontWeight: 800, fontSize: 14, letterSpacing: "-0.02em",
            background: online ? "linear-gradient(135deg, #FCD34D, #F59E0B)" : "var(--bg-2)",
            color: online ? "#1C0A00" : "var(--text-muted)" }}>
            {(node.name ?? "?").charAt(0).toUpperCase()}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 700, color: "var(--text)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
            <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "monospace" }}>#{node.display_order} · ID {node.id}</span>
          </span>
        </Link>
      </td>
      <td className="td">
        <span className={si.chip} style={{ paddingLeft: 8, ...si.style }}><span className={`status-dot ${si.dot}`} /> {si.label}</span>
      </td>
      <td className="td" style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {node.ip_address
          ? <span style={{ fontFamily: "ui-monospace, monospace" }}>{node.ip_address}{node.os ? ` · ${node.os}/${node.arch}` : ""}</span>
          : <span style={{ color: "var(--text-faint)" }}>—</span>}
      </td>
      <td className="td">
        {pots.total > 0
          ? <span className={pots.running > 0 ? "chip chip-green" : "chip"} style={{ fontWeight: 700, fontSize: 11 }}>
              <Icon d={Icons.honeypot} size={11} color={pots.running > 0 ? "var(--ok)" : "var(--text-muted)"} /> {pots.running}/{pots.total}
            </span>
          : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>}
      </td>
      <td className="td" style={{ minWidth: 130 }}>
        {online
          ? <div style={{ display: "flex", gap: 8 }}>
              <MiniBar label="C" value={node.cpu_pct ?? 0} color="#F59E0B" />
              <MiniBar label="M" value={node.mem_pct ?? 0} color="#3B82F6" />
              <MiniBar label="D" value={node.disk_pct ?? 0} color="#22C55E" />
            </div>
          : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>}
      </td>
      <td className="td" style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{relTime(node.last_heartbeat)}</td>
      <td className="td" style={{ textAlign: "right", width: 48 }} onClick={e => e.stopPropagation()}>
        <ActionsMenu node={node} canManage={canManage} laIntegration={laIntegration} onAct={onAct} />
      </td>
    </tr>
  );
}

/* ── Modal shell (focus-managed, ESC + backdrop close) ───────────── */
function Modal({ onClose, width = 460, title, children }: { onClose: () => void; width?: number; title?: string; children: React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", h);
    panelRef.current?.focus();
    return () => { window.removeEventListener("keydown", h); prevFocus?.focus?.(); };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={panelRef} className="modal animate-fade-up" style={{ maxWidth: width }}
        role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={e => e.stopPropagation()}>{children}</div>
    </div>,
    document.body,
  );
}

/* ════════════════════════════════════════════════════════════════════
   Page
═══════════════════════════════════════════════════════════════════════ */
type Filter = "all" | "online" | "offline";
type Sort   = "recent" | "name" | "status" | "load" | "pots";
type View   = "grid" | "table";
type Pending = { kind: ActKind; node?: Node; bulk?: number[] } | null;

export default function NodesPage() {
  const qc = useQueryClient();
  const canManage = useAuthStore((s) => s.hasPerm("nodes.manage"));

  const [name,       setName]       = useState("");
  const [created,    setCreated]    = useState<CreatedNode | null>(null);
  const [rotated,    setRotated]    = useState(false);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [sort,       setSort]       = useState<Sort>("recent");
  const [query,      setQuery]      = useState("");
  const [adding,     setAdding]     = useState(false);
  const [recordLogs, setRecordLogs] = useState(true);
  const [view,       setView]       = useState<View>(() => (localStorage.getItem("nodes-view") as View) || "grid");
  const [selectMode, setSelectMode] = useState(false);
  const [selected,   setSelected]   = useState<Set<number>>(new Set());
  const [pending,    setPending]    = useState<Pending>(null);
  const [delWorkspace, setDelWorkspace] = useState(false);
  const [toast,      setToast]      = useState<string | null>(null);

  useEffect(() => { localStorage.setItem("nodes-view", view); }, [view]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const { data: nodes, isLoading, isFetching } = useQuery<Node[]>({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data ?? [],
    refetchInterval: 5000,
  });
  const { data: deployments } = useQuery<Deployment[]>({
    queryKey: ["deployments"],
    queryFn: async () => (await api.get("/deployments")).data ?? [],
    refetchInterval: 8000,
  });
  const { data: laInfo } = useQuery<LAInfo>({
    queryKey: ["integrations", "log-analyzer"],
    queryFn: async () => (await api.get("/integrations/log-analyzer")).data,
    staleTime: 60_000,
  });
  const laEnabled = laInfo?.enabled === true;

  /* per-node honeypot counts */
  const potsByNode = useMemo(() => {
    const m = new Map<number, PotStat>();
    for (const d of deployments ?? []) {
      const cur = m.get(d.node_id) ?? { total: 0, running: 0 };
      cur.total += 1;
      if (d.status === "running") cur.running += 1;
      m.set(d.node_id, cur);
    }
    return m;
  }, [deployments]);
  const potsFor = (id: number): PotStat => potsByNode.get(id) ?? { total: 0, running: 0 };

  /* ── Mutations ── */
  const create = useMutation({
    mutationFn: async (n: string) => (await api.post("/nodes", {
      name: n, record_logs: laEnabled && recordLogs, la_workspace_name: n,
    })).data as CreatedNode,
    onSuccess: (data) => {
      setRotated(false); setCreated(data); setName(""); setAdding(false);
      qc.setQueryData<Node[]>(["nodes"], (old) => [
        ...(old ?? []),
        { id: data.id, name: data.name, online: false, last_heartbeat: null, display_order: (old?.length ?? 0) + 1,
          la_enabled: data.la_enabled, la_workspace_id: data.la_workspace_id,
          la_workspace_name: data.la_workspace_name, la_workspace_url: data.la_workspace_url },
      ]);
    },
  });
  // Deleting/uninstalling a node cascades its deployments server-side, so refresh
  // the shared ["deployments"] query (also used by the Dashboard) too.
  const refreshFleet = () => { qc.invalidateQueries({ queryKey: ["nodes"] }); qc.invalidateQueries({ queryKey: ["deployments"] }); };
  const del = useMutation({
    mutationFn: async ({ id, deleteWorkspace }: { id: number; deleteWorkspace: boolean }) =>
      api.delete(`/nodes/${id}${deleteWorkspace ? "?delete_workspace=true" : ""}`),
    onSuccess: () => { refreshFleet(); setToast("Node deleted"); },
    onError: () => setToast("Failed to delete node"),
  });
  const bulkDel = useMutation({
    mutationFn: async (ids: number[]) => {
      const res = await Promise.allSettled(ids.map(id => api.delete(`/nodes/${id}`)));
      return res.filter(r => r.status === "fulfilled").length;
    },
    onSuccess: (okCount, ids) => {
      setSelected(new Set()); setSelectMode(false);
      const failed = ids.length - okCount;
      setToast(failed > 0 ? `Deleted ${okCount} · ${failed} failed` : `Deleted ${okCount} node${okCount === 1 ? "" : "s"}`);
    },
    onError: () => setToast("Bulk delete failed"),
    onSettled: refreshFleet,
  });
  const regen = useMutation({
    mutationFn: async (node: Node) => ({ node, data: (await api.post(`/nodes/${node.id}/regenerate-token`)).data as { id: number; token: string } }),
    onSuccess: ({ node, data }) => {
      setRotated(true);
      setCreated({ id: node.id, name: node.name, token: data.token, la_enabled: node.la_enabled,
        la_workspace_id: node.la_workspace_id, la_workspace_name: node.la_workspace_name, la_workspace_url: node.la_workspace_url });
    },
    onError: () => setToast("Failed to regenerate token"),
  });
  const uninstall = useMutation({
    mutationFn: async (id: number) => api.post(`/nodes/${id}/uninstall`),
    onSuccess: () => { refreshFleet(); setToast("Agent uninstalled & node removed"); },
    onError: () => setToast("Uninstall failed"),
  });
  const toggleLA = useMutation({
    mutationFn: async (node: Node) => node.la_enabled
      ? api.delete(`/nodes/${node.id}/log-analyzer`)
      : api.put(`/nodes/${node.id}/log-analyzer`, { workspace_name: node.name }),
    onSuccess: (_d, node) => { qc.invalidateQueries({ queryKey: ["nodes"] }); setToast(node.la_enabled ? "Log Analyzer disabled" : "Log Analyzer enabled"); },
    onError: () => setToast("Log Analyzer update failed"),
  });

  /* ── Derived ── */
  const allNodes: Node[] = nodes ?? [];
  const online   = allNodes.filter(n =>  n.online);
  const offline  = allNodes.filter(n => !n.online);
  const totalPots   = (deployments ?? []).length;
  const runningPots = (deployments ?? []).filter(d => d.status === "running").length;
  const avgCpu = online.length ? online.reduce((s, n) => s + (n.cpu_pct ?? 0), 0) / online.length : 0;
  const avgMem = online.length ? online.reduce((s, n) => s + (n.mem_pct ?? 0), 0) / online.length : 0;

  const visible = useMemo(() => {
    let list = filter === "online" ? online : filter === "offline" ? offline : allNodes;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(n => n.name.toLowerCase().includes(q) || (n.ip_address ?? "").includes(q) || (n.hostname ?? "").toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === "name")        sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "status") sorted.sort((a, b) => Number(b.online) - Number(a.online));
    else if (sort === "load")   sorted.sort((a, b) => (b.cpu_pct ?? 0) - (a.cpu_pct ?? 0));
    else if (sort === "pots")   sorted.sort((a, b) => potsFor(b.id).total - potsFor(a.id).total);
    else                        sorted.sort((a, b) => {
      const ta = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
      const tb = b.last_heartbeat ? new Date(b.last_heartbeat).getTime() : 0;
      return tb - ta;
    });
    return sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allNodes, filter, query, online, offline, sort, potsByNode]);

  /* ── Selection helpers (always scoped to what's on screen) ── */
  const selectedVisible = useMemo(() => visible.filter(n => selected.has(n.id)), [visible, selected]);
  const toggleSel = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisibleSelected = visible.length > 0 && visible.every(n => selected.has(n.id));
  const toggleSelectAll = () => setSelected(s => {
    if (allVisibleSelected) { const n = new Set(s); visible.forEach(v => n.delete(v.id)); return n; }
    return new Set([...s, ...visible.map(v => v.id)]);
  });

  /* ── Action dispatch ── */
  const onAct = (k: ActKind, node: Node) => {
    if (k === "toggle-la") { toggleLA.mutate(node); return; }
    if (k === "delete") setDelWorkspace(false);
    setPending({ kind: k, node });
  };
  const confirmPending = () => {
    if (!pending) return;
    if (pending.kind === "delete" && pending.bulk) { bulkDel.mutate(pending.bulk); }
    else if (pending.kind === "delete" && pending.node) { del.mutate({ id: pending.node.id, deleteWorkspace: delWorkspace }); }
    else if (pending.kind === "regen" && pending.node)   { regen.mutate(pending.node); }
    else if (pending.kind === "uninstall" && pending.node) { uninstall.mutate(pending.node.id); }
    setPending(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }} className="animate-fade-up">

      {/* ── Header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="page-label">Fleet</p>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            Node Manager
            <span style={{
              fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999,
              background: "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(217,119,6,0.10))",
              color: "var(--accent)", border: "1px solid var(--warn-border)",
              letterSpacing: "0.05em", textTransform: "uppercase",
            }}>{allNodes.length} {allNodes.length === 1 ? "node" : "nodes"}</span>
            <span className="status-dot status-dot-green" title="Live" style={{ width: 7, height: 7, opacity: isFetching ? 1 : 0, transition: "opacity .2s" }} />
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.6, maxWidth: 540 }}>
            Register servers and deploy honeypots. Each node runs the HoneyBee agent and reports heartbeats every 30 seconds.
          </p>
        </div>

        {canManage && (
          <button onClick={() => setAdding(v => !v)} className="btn btn-primary shine" style={{ gap: 6 }}>
            <Icon d={adding ? Icons.close : Icons.plus} size={14} color="#1C0A00" />
            {adding ? "Cancel" : "Add Node"}
          </button>
        )}
      </div>

      {/* ── Fleet stat tiles ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <FleetTile color="#F59E0B" label="Total nodes"  value={allNodes.length} icon={Icons.server} />
        <FleetTile color="#22C55E" label="Online"       value={online.length}   icon={Icons.online} pulse />
        <FleetTile color="#94A3B8" label="Offline"      value={offline.length}  icon={Icons.offline} />
        <FleetTile color="#7C3AED" label="Honeypots"    value={totalPots}       icon={Icons.honeypot} />
        <FleetTile color="#10B981" label="Running pots" value={runningPots}     icon={Icons.play} />
        <FleetTile color="#3B82F6" label="Avg load"     value={avgCpu}          icon={Icons.cpu} suffix="%" sub={`MEM ${avgMem.toFixed(0)}%`} />
      </div>

      {/* ── Install banner ── */}
      {created && <InstallBanner created={created} rotated={rotated} onClose={() => setCreated(null)} />}

      {/* ── Add Node form ── */}
      {adding && canManage && (
        <div className="card-elevated animate-fade-up" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div className="glow-amber" style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", flexShrink: 0,
              background: "linear-gradient(135deg,#FCD34D,#D97706)" }}>
              <Icon d={Icons.server} size={20} color="#1C0A00" sw={2} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 800, fontSize: 14.5, color: "var(--text)", marginBottom: 3 }}>Register New Node</p>
              <p style={{ fontSize: 12.5, color: "var(--accent)", marginBottom: 14, lineHeight: 1.55 }}>
                Give the server a memorable name. You'll get a one-time install command to run on it.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input className="input" placeholder="e.g. prod-server-01, lab-honeypot" value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && name.trim() && create.mutate(name.trim())}
                  style={{ flex: "1 1 240px" }} autoFocus />
                <button className="btn btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate(name.trim())}>
                  {create.isPending ? "Creating…" : <>Create <Icon d={Icons.arrow} size={13} color="#1C0A00" /></>}
                </button>
              </div>

              {laEnabled && (
                <label style={{ marginTop: 12, padding: "12px 14px", borderRadius: 12,
                  border: `1.5px solid ${recordLogs ? "var(--info-border)" : "var(--border)"}`,
                  background: recordLogs ? "var(--info-bg)" : "var(--bg-2)",
                  display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, display: "grid", placeItems: "center",
                    background: recordLogs ? "linear-gradient(135deg, #60A5FA, #2563EB)" : "var(--border)", transition: "background 0.15s" }}>
                    <Icon d={Icons.search} size={16} color={recordLogs ? "#FFFFFF" : "var(--text-faint)"} sw={2.2} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 800, fontSize: 13.5, color: "var(--text)" }}>Record logs in Log Analyzer</p>
                    <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>
                      Auto-creates a workspace named <strong>{name || "<node name>"}</strong> and streams every event for search, filters &amp; alerts.
                    </p>
                  </div>
                  <span className="toggle" aria-checked={recordLogs} role="switch" style={{ flexShrink: 0 }}>
                    <input type="checkbox" checked={recordLogs} aria-label="Record logs in Log Analyzer"
                      onChange={e => setRecordLogs(e.target.checked)}
                      onFocus={e => { const p = e.currentTarget.parentElement as HTMLElement; if (p) p.style.boxShadow = "0 0 0 3px rgba(245,158,11,0.35)"; }}
                      onBlur={e => { const p = e.currentTarget.parentElement as HTMLElement; if (p) p.style.boxShadow = "none"; }}
                      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", margin: 0 }} />
                  </span>
                </label>
              )}

              {create.isError && (
                <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon d={Icons.warn} size={12} color="var(--danger)" /> {(create.error as any)?.response?.data?.error ?? "Failed to create node."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 190 }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <Icon d={Icons.search} size={14} color="var(--text-faint)" />
          </div>
          <input className="input" placeholder="Search name, IP, hostname…" value={query}
            onChange={e => setQuery(e.target.value)} style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }} />
          {query && (
            <button onClick={() => setQuery("")} aria-label="Clear search"
              style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "var(--bg-2)",
                border: "none", cursor: "pointer", width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center" }}>
              <Icon d={Icons.close} size={11} color="var(--text-muted)" />
            </button>
          )}
        </div>

        {/* Filter */}
        <div className="segmented">
          {([
            { key: "all", label: `All ${allNodes.length}` },
            { key: "online", label: `Online ${online.length}` },
            { key: "offline", label: `Offline ${offline.length}` },
          ] as const).map(f => (
            <button key={f.key} className={filter === f.key ? "is-active" : ""} aria-selected={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <select className="input" value={sort} onChange={e => setSort(e.target.value as Sort)} style={{ width: 168, paddingRight: 30 }}>
          <option value="recent">Sort: Recent activity</option>
          <option value="name">Sort: Name (A–Z)</option>
          <option value="status">Sort: Status</option>
          <option value="load">Sort: CPU load</option>
          <option value="pots">Sort: Honeypots</option>
        </select>

        {/* View toggle */}
        <div className="segmented" title="View">
          {([["grid", Icons.deploy], ["table", Icons.clipboard]] as const).map(([v, ic]) => (
            <button key={v} className={view === v ? "is-active" : ""} aria-selected={view === v} onClick={() => setView(v)}
              style={{ padding: "6px 10px" }} aria-label={`${v} view`} title={`${v[0].toUpperCase()}${v.slice(1)} view`}>
              <Icon d={ic} size={14} color="currentColor" />
            </button>
          ))}
        </div>

        {/* Select mode */}
        {canManage && allNodes.length > 0 && (
          <button className={`btn btn-sm ${selectMode ? "btn-primary" : "btn-secondary"}`}
            onClick={() => { setSelectMode(v => !v); setSelected(new Set()); }} style={{ gap: 5 }}>
            <Icon d={Icons.check} size={13} color={selectMode ? "#1C0A00" : "var(--text-muted)"} /> Select
          </button>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {selectMode && selectedVisible.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          borderColor: "var(--warn-border)" }}>
          <span style={{ fontWeight: 800, color: "var(--text)", fontSize: 13 }}>{selectedVisible.length} selected</span>
          <button className="btn btn-xs btn-secondary" onClick={toggleSelectAll}>{allVisibleSelected ? "Clear visible" : "Select all visible"}</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-danger" onClick={() => setPending({ kind: "delete", bulk: selectedVisible.map(n => n.id) })} disabled={bulkDel.isPending}>
            <Icon d={Icons.trash} size={13} color="var(--danger)" /> Delete {selectedVisible.length}
          </button>
        </div>
      )}

      {/* ── Content ── */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="card" style={{ padding: 18, display: "flex", gap: 14 }}>
              <div className="skeleton" style={{ width: 52, height: 52, borderRadius: 14 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="skeleton" style={{ height: 14, width: "60%" }} />
                <div className="skeleton" style={{ height: 10, width: "40%" }} />
                <div className="skeleton" style={{ height: 10, width: "30%", marginTop: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: "72px 24px", textAlign: "center", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, opacity: 0.05, pointerEvents: "none" }}>
            <Icon d={Icons.honeycomb} size={300} color="var(--accent)" style={{ position: "absolute", top: -40, right: -60 }} />
          </div>
          <div style={{ marginBottom: 14, display: "flex", justifyContent: "center", animation: "float-slow 4s ease-in-out infinite" }}>
            <Icon d={query ? Icons.search : Icons.server} size={44} color="var(--accent)" sw={1.6} />
          </div>
          <p style={{ fontWeight: 800, fontSize: 17, color: "var(--text)", marginBottom: 6 }}>
            {query ? `No nodes match "${query}"`
                   : allNodes.length === 0 ? "No nodes registered yet"
                   : filter === "online" ? "No nodes are online"
                   : filter === "offline" ? "All nodes are online" : "No nodes registered yet"}
          </p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 380, margin: "0 auto 22px" }}>
            {query ? "Try clearing the search or switching the filter."
                   : allNodes.length === 0 ? "Register your first server to start deploying honeypots."
                   : "Switch the filter to view all nodes."}
          </p>
          {!query && allNodes.length === 0 && canManage && (
            <button onClick={() => setAdding(true)} className="btn btn-primary shine" style={{ display: "inline-flex" }}>
              <Icon d={Icons.plus} size={14} color="#1C0A00" /> Add First Node
            </button>
          )}
        </div>
      ) : view === "grid" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {visible.map(n => (
            <NodeCard key={n.id} node={n} pots={potsFor(n.id)} canManage={canManage} laIntegration={laEnabled}
              selectMode={selectMode} selected={selected.has(n.id)} onSelect={toggleSel} onAct={onAct} />
          ))}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  {selectMode && <th className="th" style={{ width: 36 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll}
                      style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }} />
                  </th>}
                  <th className="th">Node</th>
                  <th className="th">Status</th>
                  <th className="th">Host</th>
                  <th className="th">Honeypots</th>
                  <th className="th">Load</th>
                  <th className="th">Last seen</th>
                  <th className="th" style={{ textAlign: "right" }}></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(n => (
                  <NodeRow key={n.id} node={n} pots={potsFor(n.id)} canManage={canManage} laIntegration={laEnabled}
                    selectMode={selectMode} selected={selected.has(n.id)} onSelect={toggleSel} onAct={onAct} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Confirm modals ── */}
      {pending?.kind === "delete" && (
        <Modal onClose={() => setPending(null)} title={pending.bulk ? "Delete nodes" : "Delete node"}>
          <div className="card-header">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--danger-bg)" }}>
                <Icon d={Icons.trash} size={16} color="var(--danger)" />
              </div>
              <p className="section-title">{pending.bulk ? `Delete ${pending.bulk.length} nodes` : "Delete node"}</p>
            </div>
            <button className="icon-btn" onClick={() => setPending(null)}><Icon d={Icons.close} size={14} /></button>
          </div>
          <div style={{ padding: "16px 20px" }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {pending.bulk
                ? <>Permanently delete <strong style={{ color: "var(--text)" }}>{pending.bulk.length}</strong> selected node{pending.bulk.length === 1 ? "" : "s"}? The agent stops reporting; deployed honeypots are orphaned. Log Analyzer workspaces are kept.</>
                : <>Permanently delete <strong style={{ color: "var(--text)" }}>{pending.node?.name}</strong>? This removes the node and its registration. The agent on the server keeps running until uninstalled.</>}
            </p>
            {!pending.bulk && pending.node?.la_enabled && pending.node?.la_workspace_id && (
              <label style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 12px", borderRadius: 10,
                background: delWorkspace ? "var(--danger-bg)" : "var(--bg-2)",
                border: `1px solid ${delWorkspace ? "var(--danger-border)" : "var(--border)"}`, transition: "background .15s, border-color .15s" }}>
                <input type="checkbox" checked={delWorkspace} onChange={e => setDelWorkspace(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: "var(--danger)", cursor: "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 12.5, color: delWorkspace ? "var(--danger)" : "var(--text)", fontWeight: 600 }}>
                  Also delete Log Analyzer workspace
                  <span style={{ color: "var(--text-faint)", fontWeight: 500 }}> ({pending.node.la_workspace_name || pending.node.la_workspace_id})</span>
                </span>
              </label>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px", borderTop: "1px solid var(--border)" }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setPending(null)}>Cancel</button>
            <button className="btn btn-danger btn-sm" onClick={confirmPending}>
              <Icon d={Icons.trash} size={13} color="var(--danger)" /> {pending.bulk ? `Delete ${pending.bulk.length}` : "Delete node"}
            </button>
          </div>
        </Modal>
      )}

      {pending?.kind === "regen" && pending.node && (
        <ConfirmCard icon={Icons.refresh} iconColor="var(--accent)" iconBg="var(--warn-bg)" title="Regenerate token"
          body={<>Issue a new install token for <strong style={{ color: "var(--text)" }}>{pending.node.name}</strong> and invalidate the current one. You'll get a fresh install command. Re-run it on the server if you reinstall the agent.</>}
          confirmLabel="Regenerate" confirmClass="btn-primary" confirmIconColor="#1C0A00"
          onClose={() => setPending(null)} onConfirm={confirmPending} />
      )}

      {pending?.kind === "uninstall" && pending.node && (
        <ConfirmCard icon={Icons.offline} iconColor="var(--danger)" iconBg="var(--danger-bg)" title="Uninstall agent"
          body={<>Send an uninstall signal to <strong style={{ color: "var(--text)" }}>{pending.node.name}</strong>. The agent removes itself from the server, stops all honeypots, and the node is removed from HoneyBee. This cannot be undone.</>}
          confirmLabel="Uninstall agent" confirmClass="btn-danger" confirmIconColor="var(--danger)" confirmIcon={Icons.offline}
          onClose={() => setPending(null)} onConfirm={confirmPending} />
      )}

      {/* ── Toast ── */}
      {toast && createPortal(
        <div className="animate-fade-up" role="status" aria-live="polite" aria-atomic="true" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 60,
          background: "var(--elevated)", border: "1px solid var(--border-2)", borderRadius: 999, boxShadow: "var(--shadow-lg)",
          padding: "10px 18px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          <Icon d={Icons.check} size={15} color="var(--ok)" /> {toast}
        </div>, document.body)}
    </div>
  );
}

/* ── Confirm card (regen / uninstall) ────────────────────────────── */
function ConfirmCard({ icon, iconColor, iconBg, title, body, confirmLabel, confirmClass, confirmIcon, confirmIconColor, onClose, onConfirm }: {
  icon: string; iconColor: string; iconBg: string; title: string; body: React.ReactNode;
  confirmLabel: string; confirmClass: string; confirmIcon?: string; confirmIconColor: string;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal onClose={onClose} title={title}>
      <div className="card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: iconBg }}>
            <Icon d={icon} size={16} color={iconColor} />
          </div>
          <p className="section-title">{title}</p>
        </div>
        <button className="icon-btn" onClick={onClose}><Icon d={Icons.close} size={14} /></button>
      </div>
      <div style={{ padding: "16px 20px" }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{body}</p>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px", borderTop: "1px solid var(--border)" }}>
        <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
        <button className={`btn btn-sm ${confirmClass}`} onClick={onConfirm}>
          {confirmIcon && <Icon d={confirmIcon} size={13} color={confirmIconColor} />} {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ── Fleet stat tile ─────────────────────────────────────────────── */
function FleetTile({ color, label, value, icon, pulse, suffix, sub }: {
  color: string; label: string; value: number; icon: string; pulse?: boolean; suffix?: string; sub?: string;
}) {
  return (
    <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
        background: `${color}1A`, color, animation: pulse && value > 0 ? "pulse-glow 2.4s ease-out infinite" : undefined }}>
        <Icon d={icon} size={18} color={color} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1, minWidth: 0 }}>
        <span className="stat-number-sm">{suffix ? value.toFixed(0) : value}{suffix}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em", marginTop: 3, whiteSpace: "nowrap" }}>
          {label}{sub ? ` · ${sub}` : ""}
        </span>
      </div>
    </div>
  );
}
