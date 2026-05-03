import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

/* ── Icons ─────────────────────────────────────── */
const Ico = ({ d, size = 16, color = "currentColor", sw = 2 }: { d: string; size?: number; color?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const I = {
  plus:   "M12 5v14M5 12h14",
  trash:  "M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6",
  search: "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z",
  arrow:  "M5 12h14M12 5l7 7-7 7",
  copy:   "M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414A1 1 0 0120 8.414V15a2 2 0 01-2 2h-2",
  clock:  "M12 8v4l3 3M12 22a10 10 0 110-20 10 10 0 010 20z",
  key:    "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  warn:   "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  close:  "M18 6L6 18M6 6l12 12",
  server: "M20 17H4a2 2 0 01-2-2V5a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2zM8 21h8M12 17v4",
  signal: "M1 6l7 7 4-4 9 9M1 1l4 4",
  check:  "M20 6L9 17l-5-5",
};

/* ── Helpers ────────────────────────────────────── */
type CreatedNode = { node_id: number; name: string; token: string };
type Node        = { id: number; name: string; online: boolean; last_seen: string | null };

function relTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

/* ── Install Banner ─────────────────────────────── */
function InstallBanner({ created, onClose }: { created: CreatedNode; onClose: () => void }) {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [copied,   setCopied]   = useState<string | null>(null);
  const base = window.location.origin;
  const cmd  = platform === "linux"
    ? `curl -fsSL "${base}/api/v1/nodes/${created.node_id}/install?token=${created.token}" | bash`
    : `irm "${base}/api/v1/nodes/${created.node_id}/install?platform=windows&token=${created.token}" | iex`;

  const copy = (text: string, key: string) =>
    navigator.clipboard.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2200); });

  return (
    <div className="animate-fade-up" style={{
      borderRadius: 18, overflow: "hidden",
      border: "1.5px solid rgba(245,158,11,0.35)",
      background: "linear-gradient(135deg, rgba(252,211,77,0.08) 0%, #FFFFFF 60%)",
      boxShadow: "0 4px 24px rgba(245,158,11,0.14)",
    }}>
      <div style={{ height: 4, background: "linear-gradient(90deg, #FCD34D, #F59E0B, #D97706)" }} />
      <div style={{ padding: "20px 24px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center",
              background: "linear-gradient(135deg,#FCD34D,#D97706)", fontSize: 20,
              boxShadow: "0 4px 12px rgba(245,158,11,0.3)",
            }}>🎉</div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 15, color: "#0F172A" }}>
                Node <span style={{ color: "#B45309" }}>{created.name}</span> registered!
              </p>
              <p style={{ fontSize: 12.5, color: "#64748B", marginTop: 2 }}>
                Run the install command on your target server to bring it online.
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "rgba(15,23,42,0.05)", border: "none", cursor: "pointer",
            width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center",
          }}>
            <Ico d={I.close} size={14} color="#94A3B8" />
          </button>
        </div>

        {/* Two columns: token + command */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

          {/* Token */}
          <div style={{
            padding: "14px 16px", borderRadius: 12,
            background: "#0F172A", border: "1px solid rgba(255,255,255,0.07)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "#64748B", display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <Ico d={I.key} size={11} color="#F59E0B" /> Token
              </p>
              <button onClick={() => copy(created.token, "token")} style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: copied === "token" ? "#F59E0B" : "rgba(255,255,255,0.08)",
                border: `1px solid ${copied === "token" ? "#D97706" : "rgba(255,255,255,0.12)"}`,
                color: copied === "token" ? "#1C0A00" : "#94A3B8",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {copied === "token" ? <Ico d={I.check} size={11} color="#1C0A00" /> : <Ico d={I.copy} size={11} color="#94A3B8" />}
                {copied === "token" ? "Copied" : "Copy"}
              </button>
            </div>
            <code style={{ fontSize: 11, color: "#FCD34D", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.6 }}>
              {created.token}
            </code>
            <p style={{ fontSize: 10.5, color: "#EF4444", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
              <Ico d={I.warn} size={10} color="#EF4444" /> Shown once — save it now.
            </p>
          </div>

          {/* Command */}
          <div style={{
            padding: "14px 16px", borderRadius: 12,
            background: "#0F172A", border: "1px solid rgba(255,255,255,0.07)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {(["linux", "windows"] as const).map(p => (
                  <button key={p} onClick={() => setPlatform(p)} style={{
                    padding: "2px 10px", borderRadius: 99, fontSize: 10.5, fontWeight: 700, cursor: "pointer",
                    background: platform === p ? "#F59E0B" : "rgba(255,255,255,0.08)",
                    border: `1px solid ${platform === p ? "#D97706" : "rgba(255,255,255,0.12)"}`,
                    color: platform === p ? "#1C0A00" : "#64748B",
                  }}>{p === "linux" ? "🐧 Linux" : "🪟 Windows"}</button>
                ))}
              </div>
              <button onClick={() => copy(cmd, "cmd")} style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                background: copied === "cmd" ? "#F59E0B" : "rgba(255,255,255,0.08)",
                border: `1px solid ${copied === "cmd" ? "#D97706" : "rgba(255,255,255,0.12)"}`,
                color: copied === "cmd" ? "#1C0A00" : "#94A3B8",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {copied === "cmd" ? <Ico d={I.check} size={11} color="#1C0A00" /> : <Ico d={I.copy} size={11} color="#94A3B8" />}
                {copied === "cmd" ? "Copied" : "Copy"}
              </button>
            </div>
            <code style={{ fontSize: 11, color: "#94A3B8", fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.6 }}>
              <span style={{ color: "#FCD34D" }}>{cmd.split(" ")[0]}</span>
              {" " + cmd.slice(cmd.indexOf(" ") + 1)}
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Node Card ─────────────────────────────────── */
function NodeCard({ node, onDelete }: { node: Node; onDelete: (id: number) => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const online  = node.online;
  const initial = (node.name ?? "?").charAt(0).toUpperCase();

  return (
    <div className="card card-hover" style={{
      padding: 0, overflow: "hidden", display: "flex", flexDirection: "column",
      borderLeft: `3px solid ${online ? "#22C55E" : "#CBD5E1"}`,
    }}>

      <div style={{ padding: "18px 20px 14px", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>

          {/* Avatar */}
          <div style={{
            width: 50, height: 50, borderRadius: 14, flexShrink: 0,
            display: "grid", placeItems: "center",
            fontWeight: 900, fontSize: 20, letterSpacing: "-0.02em",
            background: online
              ? "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)"
              : "linear-gradient(135deg, #E2E8F0 0%, #CBD5E1 100%)",
            color: online ? "#1C0A00" : "#64748B",
            boxShadow: online ? "0 4px 14px rgba(245,158,11,0.28)" : "none",
          }}>
            {initial}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              fontWeight: 800, fontSize: 15.5, color: "#0F172A", marginBottom: 6,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {node.name}
            </p>

            {/* Status + meta row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 99,
                background: online ? "rgba(34,197,94,0.1)" : "rgba(100,116,139,0.1)",
                border: `1px solid ${online ? "rgba(34,197,94,0.3)" : "rgba(100,116,139,0.2)"}`,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: online ? "#22C55E" : "#94A3B8",
                  animation: online ? "pulse-green 2s infinite" : "none",
                }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: online ? "#16A34A" : "#64748B" }}>
                  {online ? "Online" : "Offline"}
                </span>
              </div>

              <span style={{
                fontSize: 11, fontFamily: "monospace", color: "#CBD5E1",
                background: "rgba(15,23,42,0.04)", padding: "2px 7px", borderRadius: 6,
                border: "1px solid rgba(15,23,42,0.07)",
              }}>#{node.id}</span>

              <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#94A3B8" }}>
                <Ico d={I.clock} size={11} color="#CBD5E1" />
                {relTime(node.last_seen)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid rgba(15,23,42,0.06)", padding: "10px 20px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(248,250,252,0.7)",
      }}>
        {confirmDelete ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
            <span style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600, flex: 1 }}>
              Delete <strong>{node.name}</strong>?
            </span>
            <button onClick={() => onDelete(node.id)} style={{
              padding: "5px 14px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: "#DC2626", border: "none", color: "#FFFFFF",
            }}>Delete</button>
            <button onClick={() => setConfirmDelete(false)} style={{
              padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: "#F8FAFC", border: "1px solid rgba(15,23,42,0.12)", color: "#64748B",
            }}>Cancel</button>
          </div>
        ) : (
          <>
            <Link
              to={`/nodes/${node.id}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700,
                padding: "6px 16px", borderRadius: 9,
                background: "linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.06))",
                border: "1.5px solid rgba(245,158,11,0.3)",
                color: "#B45309", textDecoration: "none",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.2)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "linear-gradient(135deg,rgba(245,158,11,0.12),rgba(245,158,11,0.06))"; }}
            >
              Manage <Ico d={I.arrow} size={13} color="#B45309" />
            </Link>
            <button
              onClick={() => setConfirmDelete(true)}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "6px 8px",
                borderRadius: 7, color: "#CBD5E1", display: "flex", alignItems: "center",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#EF4444"; (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.07)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#CBD5E1"; (e.currentTarget as HTMLElement).style.background = "none"; }}
            >
              <Ico d={I.trash} size={15} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Page ─────────────────────────────────────────── */
export default function NodesPage() {
  const qc = useQueryClient();
  const [name,    setName]    = useState("");
  const [created, setCreated] = useState<CreatedNode | null>(null);
  const [filter,  setFilter]  = useState<"all" | "online" | "offline">("all");
  const [query,   setQuery]   = useState("");
  const [adding,  setAdding]  = useState(false);

  const { data: nodes, isLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    refetchInterval: 5000,
  });
  const create = useMutation({
    mutationFn: async (n: string) => (await api.post("/nodes", { name: n })).data as CreatedNode,
    onSuccess: (data) => {
      setCreated(data); setName(""); setAdding(false);
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
  });
  const del = useMutation({
    mutationFn: async (id: number) => api.delete(`/nodes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nodes"] }),
  });

  const allNodes: Node[] = nodes ?? [];
  const online   = allNodes.filter(n =>  n.online);
  const offline  = allNodes.filter(n => !n.online);

  const visible = useMemo(() => {
    const list = filter === "online" ? online : filter === "offline" ? offline : allNodes;
    if (!query.trim()) return list;
    return list.filter(n => n.name.toLowerCase().includes(query.toLowerCase()));
  }, [allNodes, filter, query, online, offline]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }} className="animate-fade-up">

      {/* ── Header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="page-label">Fleet</p>
          <h1 className="page-title">Node Manager</h1>
          <p style={{ fontSize: 13.5, color: "#64748B", marginTop: 5, lineHeight: 1.65 }}>
            Register servers and deploy honeypots. Each node runs the HoneyBee agent.
          </p>
        </div>

        {/* Stat pills */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {[
            { label: "Total",   value: allNodes.length, bg: "rgba(245,158,11,0.1)",  color: "#B45309", border: "rgba(245,158,11,0.25)" },
            { label: "Online",  value: online.length,   bg: "rgba(34,197,94,0.1)",   color: "#16A34A", border: "rgba(34,197,94,0.25)"  },
            { label: "Offline", value: offline.length,  bg: "rgba(100,116,139,0.1)", color: "#64748B", border: "rgba(100,116,139,0.2)" },
          ].map(s => (
            <div key={s.label} style={{
              padding: "7px 14px", borderRadius: 99, fontWeight: 700,
              background: s.bg, border: `1.5px solid ${s.border}`, color: s.color,
              display: "flex", alignItems: "center", gap: 8, fontSize: 13,
            }}>
              <span style={{ fontSize: 17, fontWeight: 900 }}>{s.value}</span>
              <span style={{ opacity: 0.8 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Install banner ── */}
      {created && <InstallBanner created={created} onClose={() => setCreated(null)} />}

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>

        {/* Search */}
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
          <div style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <Ico d={I.search} size={14} color="#94A3B8" />
          </div>
          <input
            className="input"
            placeholder="Search nodes…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            style={{ paddingLeft: 34, width: "100%", boxSizing: "border-box" }}
          />
        </div>

        {/* Filter tabs */}
        <div style={{
          display: "flex", borderRadius: 10, overflow: "hidden",
          border: "1.5px solid rgba(15,23,42,0.1)", background: "#F8FAFC",
        }}>
          {([ { key: "all", label: "All", count: allNodes.length }, { key: "online", label: "Online", count: online.length }, { key: "offline", label: "Offline", count: offline.length } ] as const).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", border: "none",
              background: filter === f.key ? "rgba(245,158,11,0.15)" : "transparent",
              color: filter === f.key ? "#B45309" : "#94A3B8",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {f.label}
              <span style={{
                padding: "1px 6px", borderRadius: 99, fontSize: 10.5, fontWeight: 800,
                background: filter === f.key ? "rgba(245,158,11,0.25)" : "rgba(15,23,42,0.06)",
                color: filter === f.key ? "#92400E" : "#94A3B8",
              }}>{f.count}</span>
            </button>
          ))}
        </div>

        {/* Add Node */}
        <button
          onClick={() => setAdding(v => !v)}
          className="btn btn-primary"
          style={{ marginLeft: "auto", gap: 6 }}
        >
          <Ico d={adding ? I.close : I.plus} size={14} color="#1C0A00" />
          {adding ? "Cancel" : "Add Node"}
        </button>
      </div>

      {/* ── Add Node form ── */}
      {adding && (
        <div className="card animate-fade-up" style={{ padding: "20px 22px", borderColor: "rgba(245,158,11,0.3)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11, display: "grid", placeItems: "center", flexShrink: 0,
              background: "linear-gradient(135deg,#FCD34D,#D97706)", fontSize: 20,
            }}>🖥️</div>
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 800, fontSize: 14.5, color: "#0F172A", marginBottom: 3 }}>Register New Node</p>
              <p style={{ fontSize: 12.5, color: "#64748B", marginBottom: 14, lineHeight: 1.55 }}>
                Give the server a name. You'll get a one-time install command to run on it.
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
                <button
                  className="btn btn-primary"
                  disabled={!name.trim() || create.isPending}
                  onClick={() => create.mutate(name.trim())}
                >
                  {create.isPending ? "Creating…" : "Create →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Grid / Empty ── */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.4 }}>🐝</div>
          <p style={{ color: "#94A3B8", fontWeight: 600 }}>Loading nodes…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: "64px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{query ? "🔍" : "🐝"}</div>
          <p style={{ fontWeight: 800, fontSize: 16, color: "#0F172A", marginBottom: 6 }}>
            {query ? `No nodes match "${query}"` : "No nodes yet"}
          </p>
          <p style={{ fontSize: 13, color: "#64748B", marginBottom: 22, maxWidth: 320, margin: "0 auto 22px" }}>
            {query
              ? "Try clearing the search or switching the filter."
              : "Register your first server to start deploying honeypots."}
          </p>
          {!query && (
            <button onClick={() => setAdding(true)} className="btn btn-primary" style={{ display: "inline-flex" }}>
              <Ico d={I.plus} size={14} color="#1C0A00" /> Add First Node
            </button>
          )}
        </div>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 14,
        }}>
          {visible.map(n => (
            <NodeCard key={n.id} node={n} onDelete={id => del.mutate(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
