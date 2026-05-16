import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { Icon, Icons } from "../components/Icons";
import { copyToClipboard } from "../hooks/useCopy";

/* ─────────────────────────────────────────────────────────────────────
   Node Manager — modern, interactive rebuild
   - Premium "tilt+sheen" cards with mouse-tracked highlight
   - Animated conic-ring border on online nodes
   - Inline action menu (Manage / Copy ID / Delete) with confirm
   - Live filter chips, search, and sort modes (recent / online / name)
   - Rich, animated empty + loading states
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
  id: number; name: string; online: boolean; last_heartbeat: string | null; display_order: number;
  ip_address?: string; os?: string; arch?: string; hostname?: string;
  cpu_pct?: number; mem_pct?: number; disk_pct?: number; uptime_secs?: number;
  la_enabled?: boolean;
  la_workspace_id?: string;
  la_workspace_name?: string;
  la_workspace_url?: string;
};
type LAInfo = { enabled: boolean; public_url: string };

function relTime(iso: string | null): string {
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

/* ──────────────────────────────────────────────────────────────────
   Install banner — shown after a new node is created
   (keeps the proven dual-pane token + command card)
────────────────────────────────────────────────────────────────── */
function InstallBanner({ created, onClose }: { created: CreatedNode; onClose: () => void }) {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [copied,   setCopied]   = useState<string | null>(null);
  const base = window.location.origin;
  const cmd  = platform === "linux"
    ? `curl -fsSL "${base}/api/v1/nodes/${created.id}/install?token=${created.token}" | bash`
    : `irm "${base}/api/v1/nodes/${created.id}/install?platform=windows&token=${created.token}" | iex`;

  const copy = (text: string, key: string) =>
    copyToClipboard(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2200); });

  return (
    <div className="animate-fade-up shine" style={{
      borderRadius: 18, overflow: "hidden", position: "relative",
      border: "1.5px solid rgba(245,158,11,0.4)",
      background: "linear-gradient(135deg, rgba(252,211,77,0.10) 0%, #FFFFFF 60%)",
      boxShadow: "0 4px 24px rgba(245,158,11,0.16)",
    }}>
      <div style={{ height: 4, background: "linear-gradient(90deg, #FCD34D, #F59E0B, #D97706, #F59E0B, #FCD34D)",
                   backgroundSize: "200% 100%", animation: "shimmer 4s linear infinite" }} />
      <div style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="glow-amber" style={{
              width: 44, height: 44, borderRadius: 13, display: "grid", placeItems: "center",
              background: "linear-gradient(135deg,#FCD34D,#D97706)",
            }}>
              <Icon d={Icons.spark} size={20} color="#1C0A00" sw={2.2} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 15.5, color: "#0F172A" }}>
                Node <span style={{ color: "#B45309" }}>{created.name}</span> registered
              </p>
              <p style={{ fontSize: 12.5, color: "#64748B", marginTop: 2 }}>
                Run the install command on your target server to bring it online.
              </p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon d={Icons.close} size={14} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {/* Token */}
          <div style={{ padding: "14px 16px", borderRadius: 12, background: "#E2E8F0", border: "1px solid rgba(15,23,42,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "#64748B", display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <Icon d={Icons.key} size={11} color="#F59E0B" /> Token
              </p>
              <button onClick={() => copy(created.token, "token")} style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: copied === "token" ? "#F59E0B" : "rgba(15,23,42,0.06)",
                border: `1px solid ${copied === "token" ? "#D97706" : "rgba(15,23,42,0.12)"}`,
                color: copied === "token" ? "#1C0A00" : "#64748B",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {copied === "token" ? <Icon d={Icons.check} size={11} color="#1C0A00" /> : <Icon d={Icons.copy} size={11} color="#64748B" />}
                {copied === "token" ? "Copied" : "Copy"}
              </button>
            </div>
            <code style={{ fontSize: 11, color: "#92400E", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.6 }}>
              {created.token}
            </code>
            <p style={{ fontSize: 10.5, color: "#DC2626", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
              <Icon d={Icons.warn} size={10} color="#DC2626" /> Shown once — save it now.
            </p>
          </div>

          {/* Command */}
          <div style={{ padding: "14px 16px", borderRadius: 12, background: "#E2E8F0", border: "1px solid rgba(15,23,42,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {(["linux", "windows"] as const).map(p => (
                  <button key={p} onClick={() => setPlatform(p)} style={{
                    padding: "3px 11px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, cursor: "pointer",
                    background: platform === p ? "#F59E0B" : "rgba(15,23,42,0.06)",
                    border: `1px solid ${platform === p ? "#D97706" : "rgba(15,23,42,0.12)"}`,
                    color: platform === p ? "#1C0A00" : "#64748B",
                    display: "inline-flex", alignItems: "center", gap: 4, textTransform: "capitalize",
                  }}>{p}</button>
                ))}
              </div>
              <button onClick={() => copy(cmd, "cmd")} style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: copied === "cmd" ? "#F59E0B" : "rgba(15,23,42,0.06)",
                border: `1px solid ${copied === "cmd" ? "#D97706" : "rgba(15,23,42,0.12)"}`,
                color: copied === "cmd" ? "#1C0A00" : "#64748B",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {copied === "cmd" ? <Icon d={Icons.check} size={11} color="#1C0A00" /> : <Icon d={Icons.copy} size={11} color="#64748B" />}
                {copied === "cmd" ? "Copied" : "Copy"}
              </button>
            </div>
            <code style={{ fontSize: 11, color: "#475569", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.6 }}>
              <span style={{ color: "#B45309" }}>{cmd.split(" ")[0]}</span>{" " + cmd.slice(cmd.indexOf(" ") + 1)}
            </code>
          </div>
        </div>

        {/* LogAnalyzer integration callout — only when LA was provisioned at creation */}
        {created.la_enabled && created.la_workspace_url && (
          <div style={{
            marginTop: 16, padding: "12px 14px", borderRadius: 12,
            background: "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(59,130,246,0.04))",
            border: "1px solid rgba(59,130,246,0.30)",
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              display: "grid", placeItems: "center",
              background: "linear-gradient(135deg, #60A5FA, #2563EB)",
            }}>
              <Icon d={Icons.search} size={16} color="#FFFFFF" sw={2.2} />
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ fontWeight: 800, fontSize: 13, color: "#1E3A8A", marginBottom: 2 }}>
                Log Analyzer workspace ready
              </p>
              <p style={{ fontSize: 11.5, color: "#475569" }}>
                Every event & log from <strong>{created.name}</strong> now streams into
                workspace <code style={{ fontFamily: "monospace", color: "#1E40AF" }}>{created.la_workspace_name}</code>.
              </p>
            </div>
            <a href={created.la_workspace_url} target="_blank" rel="noreferrer" style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: "#2563EB", color: "#FFFFFF", textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 5,
            }}>
              Open <Icon d={Icons.arrow} size={12} color="#FFFFFF" />
            </a>
          </div>
        )}
        {created.la_error && (
          <div style={{
            marginTop: 16, padding: "10px 14px", borderRadius: 10,
            background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.25)",
            fontSize: 12, color: "#991B1B",
          }}>
            <strong>Log Analyzer integration failed:</strong> {created.la_error}
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Modern Node Card — interactive, with mouse-tracked sheen
────────────────────────────────────────────────────────────────── */
function NodeCard({ node, onDelete }: { node: Node; onDelete: (id: number, deleteWorkspace: boolean) => void }) {
  const [confirmDelete,    setConfirmDelete]    = useState(false);
  const [deleteWorkspace,  setDeleteWorkspace]  = useState(false);
  const [menuOpen,         setMenuOpen]         = useState(false);
  const [copiedId,         setCopiedId]         = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const online  = node.online;
  const initial = (node.name ?? "?").charAt(0).toUpperCase();

  /* Mouse-tracked CSS variables for the radial sheen highlight */
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  const copyId = () => {
    navigator.clipboard.writeText(String(node.id))
      .then(() => { setCopiedId(true); setTimeout(() => setCopiedId(false), 1600); });
  };

  /* Close menu on outside click */
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Element)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMove}
      className={`card-interactive ${online ? "ring-online" : ""}`}
      style={{
        padding: 0, overflow: "hidden", display: "flex", flexDirection: "column",
        borderLeft: `3px solid ${online ? "#22C55E" : "#CBD5E1"}`,
      }}
    >
      {/* ── Top: avatar + name + status ── */}
      <div style={{ padding: "18px 20px 12px", flex: 1, position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {/* Avatar with halo */}
          <div className={online ? "glow-amber" : ""} style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            display: "grid", placeItems: "center",
            fontWeight: 900, fontSize: 21, letterSpacing: "-0.02em",
            background: online
              ? "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)"
              : "linear-gradient(135deg, #E2E8F0 0%, #CBD5E1 100%)",
            color: online ? "#1C0A00" : "#64748B",
          }}>
            {initial}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontWeight: 800, fontSize: 15.5, color: "#0F172A", marginBottom: 7,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {node.name}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className={online ? "chip chip-green" : "chip chip-slate"} style={{ paddingLeft: 8 }}>
                <span className={`status-dot ${online ? "status-dot-green" : "status-dot-slate"}`} />
                {online ? "Online" : "Offline"}
              </span>
              <span className="chip" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                #{node.display_order}
              </span>
              {node.la_enabled && (
                <a
                  href={node.la_workspace_url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  title={`Streaming logs to "${node.la_workspace_name || "workspace"}" in Log Analyzer`}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 800,
                    background: "linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.10))",
                    color: "#1E40AF", border: "1px solid rgba(37,99,235,0.30)",
                    textDecoration: "none", letterSpacing: "0.04em",
                  }}
                >
                  <Icon d={Icons.search} size={10} color="#1E40AF" sw={2.4} />
                  Log Analyzer
                </a>
              )}
            </div>
          </div>

          {/* Kebab menu */}
          <button
            className="icon-btn"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v); }}
            aria-label="Actions"
            style={{ marginLeft: -4 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
            </svg>
          </button>

          {menuOpen && (
            <div
              className="animate-fade-up"
              style={{
                position: "absolute", top: 50, right: 14, zIndex: 20,
                background: "#FFFFFF", borderRadius: 12, minWidth: 170,
                border: "1px solid rgba(15,23,42,0.08)",
                boxShadow: "0 10px 30px rgba(15,23,42,0.14), 0 1px 2px rgba(15,23,42,0.05)",
                padding: 5,
              }}
              onClick={e => e.stopPropagation()}
            >
              <Link to={`/nodes/${node.id}`} style={menuItemStyle()}>
                <Icon d={Icons.arrow} size={14} color="#64748B" /> Manage
              </Link>
              <button onClick={copyId} style={menuItemStyle()}>
                <Icon d={copiedId ? Icons.check : Icons.copy} size={14} color={copiedId ? "#16A34A" : "#64748B"} />
                {copiedId ? "Copied!" : "Copy node ID"}
              </button>
              <div style={{ height: 1, background: "rgba(15,23,42,0.06)", margin: "4px 6px" }} />
              <button onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                      style={menuItemStyle("#DC2626")}>
                <Icon d={Icons.trash} size={14} color="#DC2626" /> Delete node
              </button>
            </div>
          )}
        </div>

        {/* ── IP + OS info row ── */}
        {(node.ip_address || node.os) && (
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, fontSize: 11 }}>
            {node.ip_address && (
              <span className="chip" style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600, fontSize: 10.5 }}>
                <Icon d={Icons.globe} size={10} color="#64748B" /> {node.ip_address}
              </span>
            )}
            {node.os && (
              <span className="chip" style={{ fontSize: 10.5 }}>
                {node.os}/{node.arch}
              </span>
            )}
            {node.hostname && (
              <span className="chip" style={{ fontSize: 10.5 }}>
                {node.hostname}
              </span>
            )}
          </div>
        )}

        {/* ── Performance mini-bars ── */}
        {online && (node.cpu_pct !== undefined || node.mem_pct !== undefined) && (
          <div style={{ marginTop: 10, display: "flex", gap: 12 }}>
            <MiniBar label="CPU" value={node.cpu_pct ?? 0} color="#F59E0B" />
            <MiniBar label="MEM" value={node.mem_pct ?? 0} color="#3B82F6" />
            <MiniBar label="DISK" value={node.disk_pct ?? 0} color="#10B981" />
          </div>
        )}

        {/* ── Bottom meta row — last heartbeat ── */}
        <div style={{
          marginTop: 14, paddingTop: 10, borderTop: "1px dashed rgba(15,23,42,0.08)",
          display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#94A3B8",
        }}>
          <Icon d={Icons.heart} size={12} color={online ? "#22C55E" : "#CBD5E1"} sw={2.2} />
          <span>Last seen <strong style={{ color: "#475569", fontWeight: 700 }}>{relTime(node.last_heartbeat)}</strong></span>
        </div>
      </div>

      {/* ── Footer: primary action / delete confirm ── */}
      <div style={{
        borderTop: "1px solid rgba(15,23,42,0.06)", padding: "10px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(248,250,252,0.7)",
      }}>
        {confirmDelete ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <span style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>
              Delete <strong>{node.name}</strong>?
            </span>

            {/* LogAnalyzer workspace opt-out — only shown when the node has one */}
            {node.la_enabled && node.la_workspace_id && (
              <label style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                padding: "7px 10px", borderRadius: 8, fontSize: 11.5,
                background: deleteWorkspace
                  ? "rgba(220,38,38,0.06)"
                  : "rgba(59,130,246,0.05)",
                border: `1px solid ${deleteWorkspace ? "rgba(220,38,38,0.25)" : "rgba(59,130,246,0.2)"}`,
                transition: "background 0.15s, border-color 0.15s",
              }}>
                <input
                  type="checkbox"
                  checked={deleteWorkspace}
                  onChange={e => setDeleteWorkspace(e.target.checked)}
                  style={{ accentColor: "#DC2626", width: 14, height: 14, cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ color: deleteWorkspace ? "#991B1B" : "#1E40AF", fontWeight: 700 }}>
                  Also delete LogAnalyzer workspace
                </span>
                <span style={{ color: "#64748B", fontSize: 10.5, marginLeft: 2 }}>
                  ({node.la_workspace_name || node.la_workspace_id})
                </span>
              </label>
            )}

            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onDelete(node.id, deleteWorkspace)} style={{
                padding: "5px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: "#DC2626", border: "none", color: "#FFFFFF",
              }}>Delete</button>
              <button onClick={() => { setConfirmDelete(false); setDeleteWorkspace(false); }} style={{
                padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: "#EEF2F6", border: "1px solid rgba(15,23,42,0.12)", color: "#64748B",
              }}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <Link
              to={`/nodes/${node.id}`}
              className="shine"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
                padding: "7px 16px", borderRadius: 9,
                background: "linear-gradient(135deg,rgba(245,158,11,0.14),rgba(245,158,11,0.06))",
                border: "1.5px solid rgba(245,158,11,0.32)",
                color: "#B45309", textDecoration: "none",
                transition: "background 0.15s, transform 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={e => {
                const t = e.currentTarget as HTMLElement;
                t.style.background = "linear-gradient(135deg,rgba(245,158,11,0.22),rgba(245,158,11,0.10))";
                t.style.boxShadow = "0 6px 14px rgba(245,158,11,0.18)";
                t.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={e => {
                const t = e.currentTarget as HTMLElement;
                t.style.background = "linear-gradient(135deg,rgba(245,158,11,0.14),rgba(245,158,11,0.06))";
                t.style.boxShadow = "none";
                t.style.transform = "translateY(0)";
              }}
            >
              Manage <Icon d={Icons.arrow} size={13} color="#B45309" />
            </Link>

            <span style={{ fontSize: 11, color: "#CBD5E1", fontFamily: "monospace" }}>
              ID {node.id}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function MiniBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 50 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, color }}>{value.toFixed(0)}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "rgba(15,23,42,0.06)" }}>
        <div style={{ height: 4, borderRadius: 2, background: color, width: `${Math.min(value, 100)}%`, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

const menuItemStyle = (color = "#0F172A"): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", borderRadius: 8,
  width: "100%", border: "none", background: "transparent",
  fontSize: 13, fontWeight: 600, color, cursor: "pointer", textDecoration: "none",
});

/* ──────────────────────────────────────────────────────────────────
   Page
────────────────────────────────────────────────────────────────── */
type Filter = "all" | "online" | "offline";
type Sort   = "recent" | "name" | "status";

export default function NodesPage() {
  const qc = useQueryClient();
  const [name,       setName]       = useState("");
  const [created,    setCreated]    = useState<CreatedNode | null>(null);
  const [filter,     setFilter]     = useState<Filter>("all");
  const [sort,       setSort]       = useState<Sort>("recent");
  const [query,      setQuery]      = useState("");
  const [adding,     setAdding]     = useState(false);
  const [recordLogs, setRecordLogs] = useState(true);

  const { data: nodes, isLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    refetchInterval: 5000,
  });
  // Discover whether the LogAnalyzer integration is wired up on the server.
  // We hide the toggle (and the badge link) entirely when it's disabled so
  // users aren't shown an option that would silently no-op.
  const { data: laInfo } = useQuery<LAInfo>({
    queryKey: ["integrations", "log-analyzer"],
    queryFn: async () => (await api.get("/integrations/log-analyzer")).data,
    staleTime: 60_000,
  });
  const laEnabled = laInfo?.enabled === true;

  const create = useMutation({
    mutationFn: async (n: string) => (await api.post("/nodes", {
      name: n,
      record_logs: laEnabled && recordLogs,
      la_workspace_name: n,
    })).data as CreatedNode,
    onSuccess: (data) => {
      setCreated(data); setName(""); setAdding(false);
      // Optimistically append the new node without disturbing existing entries.
      // The running refetchInterval will sync authoritative data within 5 s.
      qc.setQueryData<Node[]>(["nodes"], (old) => [
        ...(old ?? []),
        {
          id: data.id, name: data.name, online: false, last_heartbeat: null,
          display_order: (old?.length ?? 0) + 1,
          la_enabled: data.la_enabled,
          la_workspace_id: data.la_workspace_id,
          la_workspace_name: data.la_workspace_name,
          la_workspace_url: data.la_workspace_url,
        },
      ]);
    },
  });
  const del = useMutation({
    mutationFn: async ({ id, deleteWorkspace }: { id: number; deleteWorkspace: boolean }) =>
      api.delete(`/nodes/${id}${deleteWorkspace ? "?delete_workspace=true" : ""}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nodes"] }),
  });

  const allNodes: Node[] = nodes ?? [];
  const online   = allNodes.filter(n =>  n.online);
  const offline  = allNodes.filter(n => !n.online);

  const visible = useMemo(() => {
    let list = filter === "online" ? online : filter === "offline" ? offline : allNodes;
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(n => n.name.toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === "name")        sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "status") sorted.sort((a, b) => Number(b.online) - Number(a.online));
    else                        sorted.sort((a, b) => {
      const ta = a.last_heartbeat ? new Date(a.last_heartbeat).getTime() : 0;
      const tb = b.last_heartbeat ? new Date(b.last_heartbeat).getTime() : 0;
      return tb - ta;
    });
    return sorted;
  }, [allNodes, filter, query, online, offline, sort]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }} className="animate-fade-up">

      {/* ── Header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="page-label">Fleet</p>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            Node Manager
            <span style={{
              fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 99,
              background: "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(217,119,6,0.10))",
              color: "#B45309", border: "1px solid rgba(245,158,11,0.30)",
              letterSpacing: "0.05em", textTransform: "uppercase",
            }}>{allNodes.length} {allNodes.length === 1 ? "node" : "nodes"}</span>
          </h1>
          <p style={{ fontSize: 13.5, color: "#64748B", marginTop: 6, lineHeight: 1.6, maxWidth: 540 }}>
            Register servers and deploy honeypots. Each node runs the HoneyBee agent and reports
            heartbeats every 30 seconds.
          </p>
        </div>

        {/* Compact stat tiles */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatTile color="#F59E0B" label="Total"    value={allNodes.length} icon={Icons.server} />
          <StatTile color="#22C55E" label="Online"   value={online.length}   icon={Icons.online}  pulse />
          <StatTile color="#94A3B8" label="Offline"  value={offline.length}  icon={Icons.offline} />
        </div>
      </div>

      {/* ── Install banner ── */}
      {created && <InstallBanner created={created} onClose={() => setCreated(null)} />}

      {/* ── Toolbar ── */}
      <div className="card" style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
          <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <Icon d={Icons.search} size={14} color="#94A3B8" />
          </div>
          <input
            className="input"
            placeholder="Search nodes by name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 36, width: "100%", boxSizing: "border-box" }}
          />
          {query && (
            <button onClick={() => setQuery("")}
                    aria-label="Clear search"
                    style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                             background: "rgba(15,23,42,0.06)", border: "none", cursor: "pointer",
                             width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center" }}>
              <Icon d={Icons.close} size={11} color="#64748B" />
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div style={{
          display: "flex", borderRadius: 10, overflow: "hidden",
          border: "1.5px solid rgba(15,23,42,0.1)", background: "#EEF2F6",
        }}>
          {([
            { key: "all",     label: "All",     count: allNodes.length },
            { key: "online",  label: "Online",  count: online.length },
            { key: "offline", label: "Offline", count: offline.length },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "none",
              background: filter === f.key ? "rgba(245,158,11,0.15)" : "transparent",
              color: filter === f.key ? "#B45309" : "#94A3B8",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {f.label}
              <span style={{
                padding: "1px 7px", borderRadius: 99, fontSize: 10.5, fontWeight: 800,
                background: filter === f.key ? "rgba(245,158,11,0.25)" : "rgba(15,23,42,0.06)",
                color: filter === f.key ? "#92400E" : "#94A3B8",
              }}>{f.count}</span>
            </button>
          ))}
        </div>

        {/* Sort */}
        <select className="input" value={sort} onChange={e => setSort(e.target.value as Sort)}
                style={{ width: 170, paddingRight: 32 }}>
          <option value="recent">Sort: Recent activity</option>
          <option value="name">Sort: Name (A–Z)</option>
          <option value="status">Sort: Status (online first)</option>
        </select>

        {/* Add Node */}
        <button onClick={() => setAdding(v => !v)} className="btn btn-primary shine"
                style={{ marginLeft: "auto", gap: 6 }}>
          <Icon d={adding ? Icons.close : Icons.plus} size={14} color="#1C0A00" />
          {adding ? "Cancel" : "Add Node"}
        </button>
      </div>

      {/* ── Add Node form ── */}
      {adding && (
        <div className="card-elevated animate-fade-up" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div className="glow-amber" style={{
              width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", flexShrink: 0,
              background: "linear-gradient(135deg,#FCD34D,#D97706)",
            }}>
              <Icon d={Icons.server} size={20} color="#1C0A00" sw={2} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 800, fontSize: 14.5, color: "#0F172A", marginBottom: 3 }}>Register New Node</p>
              <p style={{ fontSize: 12.5, color: "#78350F", marginBottom: 14, lineHeight: 1.55 }}>
                Give the server a memorable name. You'll get a one-time install command to run on it.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  className="input"
                  placeholder="e.g. prod-server-01, lab-honeypot"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && name.trim() && create.mutate(name.trim())}
                  style={{ flex: "1 1 240px" }}
                  autoFocus
                />
                <button className="btn btn-primary"
                        disabled={!name.trim() || create.isPending}
                        onClick={() => create.mutate(name.trim())}>
                  {create.isPending ? "Creating…" : <>Create <Icon d={Icons.arrow} size={13} color="#1C0A00" /></>}
                </button>
              </div>

              {/* LogAnalyzer opt-in — only rendered when the integration is configured on the server. */}
              {laEnabled && (
                <label
                  style={{
                    marginTop: 12, padding: "12px 14px", borderRadius: 12,
                    border: `1.5px solid ${recordLogs ? "rgba(37,99,235,0.35)" : "rgba(15,23,42,0.08)"}`,
                    background: recordLogs
                      ? "linear-gradient(135deg, rgba(59,130,246,0.10), rgba(59,130,246,0.03))"
                      : "rgba(248,250,252,0.7)",
                    display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    display: "grid", placeItems: "center",
                    background: recordLogs ? "linear-gradient(135deg, #60A5FA, #2563EB)" : "#E2E8F0",
                    transition: "background 0.15s",
                  }}>
                    <Icon d={Icons.search} size={16} color={recordLogs ? "#FFFFFF" : "#94A3B8"} sw={2.2} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 800, fontSize: 13.5, color: "#0F172A" }}>
                      Record logs in Log Analyzer
                    </p>
                    <p style={{ fontSize: 11.5, color: "#64748B", marginTop: 2, lineHeight: 1.5 }}>
                      Auto-creates a workspace named <strong>{name || "<node name>"}</strong> and streams
                      every event from this node for search, filters & alerts.
                    </p>
                  </div>
                  {/* Custom toggle */}
                  <span style={{
                    position: "relative", width: 40, height: 22, borderRadius: 99,
                    background: recordLogs ? "#2563EB" : "#CBD5E1",
                    transition: "background 0.15s", flexShrink: 0,
                  }}>
                    <input
                      type="checkbox"
                      checked={recordLogs}
                      onChange={e => setRecordLogs(e.target.checked)}
                      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                    />
                    <span style={{
                      position: "absolute", top: 2, left: recordLogs ? 20 : 2,
                      width: 18, height: 18, borderRadius: "50%", background: "#FFFFFF",
                      boxShadow: "0 1px 3px rgba(15,23,42,0.25)", transition: "left 0.18s",
                    }} />
                  </span>
                </label>
              )}

              {create.isError && (
                <p style={{ fontSize: 12, color: "#DC2626", marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
                  <Icon d={Icons.warn} size={12} color="#DC2626" /> {(create.error as any)?.response?.data?.error ?? "Failed to create node."}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Grid / Empty / Loading ── */}
      {isLoading ? (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 14,
        }}>
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
            <Icon d={Icons.honeycomb} size={300} color="#F59E0B" style={{ position: "absolute", top: -40, right: -60 }} />
          </div>
          <div style={{ marginBottom: 14, display: "flex", justifyContent: "center", animation: "float-slow 4s ease-in-out infinite" }}>
            <Icon d={query ? Icons.search : Icons.server} size={44} color="#F59E0B" sw={1.6} />
          </div>
          <p style={{ fontWeight: 800, fontSize: 17, color: "#0F172A", marginBottom: 6 }}>
            {query ? `No nodes match "${query}"` : filter === "online" ? "No nodes are online" :
                     filter === "offline" ? "All nodes are online" : "No nodes registered yet"}
          </p>
          <p style={{ fontSize: 13, color: "#64748B", marginBottom: 22, maxWidth: 380, margin: "0 auto 22px" }}>
            {query ? "Try clearing the search or switching the filter."
                   : filter === "all" ? "Register your first server to start deploying honeypots."
                   : "Switch the filter to view all nodes."}
          </p>
          {!query && filter === "all" && (
            <button onClick={() => setAdding(true)} className="btn btn-primary shine" style={{ display: "inline-flex" }}>
              <Icon d={Icons.plus} size={14} color="#1C0A00" /> Add First Node
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 16,
        }}>
          {visible.map(n => (
            <NodeCard key={n.id} node={n} onDelete={(id, deleteWs) => del.mutate({ id, deleteWorkspace: deleteWs })} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Inline subcomponents
────────────────────────────────────────────────────────────────── */
function StatTile({ color, label, value, icon, pulse }: {
  color: string; label: string; value: number; icon: string; pulse?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 14px 10px 12px", borderRadius: 12,
      background: "#FFFFFF", border: "1px solid rgba(15,23,42,0.07)",
      boxShadow: "0 1px 2px rgba(15,23,42,0.04)", minWidth: 124,
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
        background: `${color}1A`, color,
        animation: pulse && value > 0 ? "pulse-glow 2.4s ease-out infinite" : undefined,
      }}>
        <Icon d={icon} size={16} color={color} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: "#0F172A", letterSpacing: "-0.03em" }}>{value}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
          {label}
        </span>
      </div>
    </div>
  );
}
