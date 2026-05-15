import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import api from "../api/client";
import { copyToClipboard } from "../hooks/useCopy";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

/* ── Icons ─────────────────────────────────────── */
const Ico = ({ d, size = 16, color = "currentColor", sw = 2 }: { d: string; size?: number; color?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const I = {
  back:    "M19 12H5M12 5l-7 7 7 7",
  play:    "M5 3l14 9-14 9V3z",
  stop:    "M18 6H6v12h12z",
  restart: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  trash:   "M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6",
  logs:    "M4 4h16v2H4zM4 9h12v2H4zM4 14h8v2H4z",
  deploy:  "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  chevron: "M9 18l6-6-6-6",
  warn:    "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  clock:   "M12 8v4l3 3M12 22a10 10 0 110-20 10 10 0 010 20z",
  copy:    "M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414A1 1 0 0120 8.414V15a2 2 0 01-2 2h-2",
  close:   "M18 6L6 18M6 6l12 12",
  check:   "M20 6L9 17l-5-5",
  shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  install: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 12l-4 4-4-4M12 3v13",
  honey:   "M5 8h14l-1 11a3 3 0 01-3 3H9a3 3 0 01-3-3L5 8zM5 8V6a2 2 0 012-2h10a2 2 0 012 2v2M9 12h6M9 16h6",
  bee:     "M12 2a4 4 0 014 4v1h-8V6a4 4 0 014-4zM4 11h16M4 15h16M8 7v14a4 4 0 008 0V7",
  linux:   "M12 2a5 5 0 00-5 5v3a4 4 0 01-1.5 3.1l-1.2 1A2 2 0 003 16v.5A1.5 1.5 0 004.5 18h15a1.5 1.5 0 001.5-1.5V16a2 2 0 00-1.3-1.9l-1.2-1A4 4 0 0117 10V7a5 5 0 00-5-5z",
  windows: "M3 5l8-1v8H3V5zM13 4l8-1v9h-8V4zM3 13h8v8l-8-1v-7zM13 13h8v9l-8-1v-8z",
};

/* ── Status config ─────────────────────────────── */
const STATUS: Record<string, { bg: string; color: string; border: string; label: string; dot: string }> = {
  running:    { bg: "rgba(34,197,94,0.1)",    color: "#16A34A", border: "rgba(34,197,94,0.3)",    label: "Running",    dot: "#22C55E" },
  failed:     { bg: "rgba(239,68,68,0.1)",    color: "#DC2626", border: "rgba(239,68,68,0.3)",    label: "Failed",     dot: "#EF4444" },
  pending:    { bg: "rgba(245,158,11,0.1)",   color: "#B45309", border: "rgba(245,158,11,0.3)",   label: "Pending",    dot: "#F59E0B" },
  installing: { bg: "rgba(59,130,246,0.1)",   color: "#1D4ED8", border: "rgba(59,130,246,0.3)",   label: "Installing", dot: "#3B82F6" },
  stopped:    { bg: "rgba(100,116,139,0.08)", color: "#64748B", border: "rgba(100,116,139,0.2)",  label: "Stopped",    dot: "#94A3B8" },
  removed:    { bg: "rgba(100,116,139,0.05)", color: "#94A3B8", border: "rgba(100,116,139,0.12)", label: "Removed",    dot: "#CBD5E1" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.stopped;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 99, fontSize: 11.5, fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.dot,
        animation: status === "running" ? "pulse-green 2s infinite" : (status === "pending" || status === "installing") ? "pulse-green 1.2s infinite" : "none",
      }} />
      {s.label}
    </span>
  );
}

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

/* ── Deploy Modal ──────────────────────────────── */
function DeployModal({
  nodeId, catalog, deployments, onClose, onSuccess,
}: {
  nodeId: string; catalog: any; deployments: any[];
  onClose: () => void; onSuccess: (depId: number) => void;
}) {
  const qc = useQueryClient();
  const [hpType, setHpType] = useState(() => catalog?.pots?.[0]?.id ?? "cowrie");

  // Predict next per-node sequential ID for the chosen type.
  const predictedID = (() => {
    const prefix = `${hpType}-`;
    let max = 0;
    for (const d of deployments ?? []) {
      if (typeof d?.pot_id === "string" && d.pot_id.startsWith(prefix)) {
        const n = parseInt(d.pot_id.slice(prefix.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }
    return `${prefix}${max + 1}`;
  })();

  const deploy = useMutation({
    mutationFn: async () =>
      // Server auto-assigns pot_id when omitted (per-node sequential).
      (await api.post(`/nodes/${nodeId}/deployments`, { honeypot_type: hpType, auto_start: true, config: {} })).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["node", nodeId] });
      if (res?.deployment_id) { onSuccess(res.deployment_id); onClose(); }
      else onClose();
    },
  });

  const selected = (catalog?.pots ?? []).find((p: any) => p.id === hpType);

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)", padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#FFFFFF", borderRadius: 20, width: "100%", maxWidth: 480,
        boxShadow: "0 32px 96px rgba(15,23,42,0.28)", border: "1px solid rgba(15,23,42,0.06)",
        overflow: "hidden",
      }}>
        <div style={{ height: 4, background: "linear-gradient(90deg,#FCD34D,#F59E0B,#D97706)" }} />
        <div style={{
          padding: "18px 22px", borderBottom: "1px solid rgba(15,23,42,0.07)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(245,158,11,0.06)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Ico d={I.honey} size={22} color="#D97706" sw={1.8} />
            <div>
              <p style={{ fontWeight: 800, fontSize: 15, color: "#0F172A" }}>Deploy a Honeypot</p>
              <p style={{ fontSize: 12, color: "#B45309", fontWeight: 600 }}>Pick a type — instance ID is assigned automatically</p>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center",
          }}>
            <Ico d={I.close} size={15} color="#94A3B8" />
          </button>
        </div>

        <div style={{ padding: "22px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ fontSize: 11.5, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Honeypot Type
              </label>
              <select
                className="input"
                value={hpType}
                onChange={e => setHpType(e.target.value)}
                style={{ width: "100%" }}
              >
                {(catalog?.pots ?? []).map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.id})</option>
                ))}
              </select>
              {selected?.description && (
                <p style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 6, lineHeight: 1.5 }}>
                  {selected.description}
                </p>
              )}
            </div>

            {/* Auto-assigned instance ID preview */}
            <div style={{
              padding: "12px 14px", borderRadius: 11,
              background: "linear-gradient(135deg, rgba(252,211,77,0.12), rgba(245,158,11,0.06))",
              border: "1px solid rgba(245,158,11,0.28)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                  Instance ID (auto)
                </p>
                <code style={{ fontSize: 14, fontWeight: 800, color: "#0F172A", fontFamily: "ui-monospace, monospace" }}>
                  {predictedID}
                </code>
              </div>
              <span style={{ fontSize: 11, color: "#B45309", fontWeight: 600, maxWidth: 170, textAlign: "right", lineHeight: 1.4 }}>
                Sequential per node · per type
              </span>
            </div>
          </div>

          {deploy.isError && (
            <div style={{
              marginTop: 14, padding: "10px 14px", borderRadius: 9, fontSize: 13,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#DC2626",
            }}>
              {(() => {
                const e: any = deploy.error;
                const msg = e?.response?.data?.error || e?.message || "Deployment failed.";
                return msg;
              })()}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <button
              onClick={() => deploy.mutate()}
              disabled={deploy.isPending}
              className="btn btn-primary"
              style={{ flex: 1 }}
            >
              {deploy.isPending ? "Deploying…" : "Deploy Honeypot →"}
            </button>
            <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Page ──────────────────────────────────────── */
export default function NodeDetailPage() {
  const { id }   = useParams();
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const [tab,              setTab]              = useState<"deployments" | "metrics" | "install" | "uninstall" | "danger">("deployments");
  const [activeDeployID,   setActiveDeployID]   = useState<number | null>(null);
  const [showDeployModal,  setShowDeployModal]  = useState(false);
  const [confirmUninstall, setConfirmUninstall] = useState(false);
  const [copied,           setCopied]           = useState<string | null>(null);
  const [pendingAction,    setPendingAction]    = useState<string | null>(null);
  const [actionToast,      setActionToast]      = useState<{ kind: "queued" | "sent" | "error"; msg: string } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["node", id],
    queryFn: async () => (await api.get(`/nodes/${id}`)).data,
    refetchInterval: 5000,
  });
  const { data: catalog } = useQuery({
    queryKey: ["potstore"],
    queryFn: async () => (await api.get("/potstore")).data,
  });

  const activeDep = (data?.deployments ?? []).find((d: any) => d.id === activeDeployID);
  const depDone   = activeDep && ["running", "failed", "stopped", "removed"].includes(activeDep.status);

  const { data: installLogs } = useQuery({
    queryKey: ["deploy-logs", activeDeployID],
    queryFn: async () => (await api.get(`/deployments/${activeDeployID}/logs?limit=500`)).data as any[],
    enabled: !!activeDeployID,
    refetchInterval: activeDeployID ? 2000 : false,
  });

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [installLogs]);

  const action = useMutation({
    mutationFn: async (p: { depID: number; act: string }) =>
      (await api.post(`/deployments/${p.depID}/${p.act}`)).data,
    onMutate: (p) => {
      setPendingAction(`${p.depID}:${p.act}`);
      // Optimistically flip the status so the badge changes immediately.
      const optimistic: Record<string, string> = {
        start: "installing", stop: "stopped", restart: "installing", remove: "removed",
      };
      const next = optimistic[p.act];
      if (next) {
        qc.setQueryData(["node", id], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            deployments: (old.deployments ?? []).map((d: any) =>
              d.id === p.depID ? { ...d, status: next } : d
            ),
          };
        });
      }
    },
    onSettled: () => { setPendingAction(null); qc.invalidateQueries({ queryKey: ["node", id] }); },
    onSuccess: (res: any, vars) => {
      const verb = { start: "Start", stop: "Stop", restart: "Restart", remove: "Remove" }[vars.act] || vars.act;
      if (res?.delivered) {
        setActionToast({ kind: "sent", msg: `${verb} command sent to node.` });
      } else {
        setActionToast({ kind: "queued", msg: `${verb} queued — node is offline. It will run when the agent reconnects.` });
      }
      window.setTimeout(() => setActionToast(null), 5000);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || err?.message || "Action failed.";
      setActionToast({ kind: "error", msg });
      window.setTimeout(() => setActionToast(null), 6000);
    },
  });
  const uninstall = useMutation({
    mutationFn: async () => (await api.post(`/nodes/${id}/uninstall`)).data,
    onSuccess: () => navigate("/nodes"),
  });

  const copyText = (text: string, key: string) =>
    copyToClipboard(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 2200); });

  if (isLoading) return (
    <div style={{ textAlign: "center", padding: "80px 0" }}>
      <div style={{ marginBottom: 12, opacity: 0.4, display: "flex", justifyContent: "center" }}>
        <Ico d={I.honey} size={36} color="#94A3B8" sw={1.6} />
      </div>
      <p style={{ color: "#94A3B8", fontWeight: 600 }}>Loading node…</p>
    </div>
  );
  if (!data) return (
    <div style={{ textAlign: "center", padding: "80px 0", color: "#EF4444" }}>Node not found.</div>
  );

  const node    = data.node;
  const deps: any[] = data.deployments ?? [];
  const online  = node.online;
  const base    = window.location.origin;

  const runningCount = deps.filter((d: any) => d.status === "running").length;
  // Node agent is offline but some honeypots are still running independently
  const agentOfflineButPotsRunning = !online && runningCount > 0;
  const activeCount  = deps.filter((d: any) => d.status !== "removed").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }} className="animate-fade-up">

      {actionToast && (
        <div
          role="status"
          style={{
            position: "fixed", top: 20, right: 20, zIndex: 9999,
            minWidth: 300, maxWidth: 420,
            padding: "14px 16px 14px 16px",
            borderRadius: 14,
            background: actionToast.kind === "error"
              ? "linear-gradient(135deg, rgba(30,8,8,0.97) 0%, rgba(60,10,10,0.97) 100%)"
              : actionToast.kind === "queued"
              ? "linear-gradient(135deg, rgba(30,22,5,0.97) 0%, rgba(60,38,5,0.97) 100%)"
              : "linear-gradient(135deg, rgba(5,25,18,0.97) 0%, rgba(8,42,28,0.97) 100%)",
            border: `1px solid ${
              actionToast.kind === "error" ? "rgba(239,68,68,0.45)"
              : actionToast.kind === "queued" ? "rgba(245,158,11,0.45)"
              : "rgba(16,185,129,0.45)"}`,
            boxShadow: `0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px ${
              actionToast.kind === "error" ? "rgba(239,68,68,0.1)"
              : actionToast.kind === "queued" ? "rgba(245,158,11,0.1)"
              : "rgba(16,185,129,0.1)"}`,
            backdropFilter: "blur(16px)",
            display: "flex", alignItems: "flex-start", gap: 12,
            animation: "toast-slide-in 0.25s cubic-bezier(0.34,1.56,0.64,1)",
          }}
        >
          {/* Left accent bar */}
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: 4,
            borderRadius: "14px 0 0 14px",
            background: actionToast.kind === "error" ? "#EF4444"
              : actionToast.kind === "queued" ? "#F59E0B"
              : "#10B981",
          }} />

          {/* Icon */}
          <div style={{
            flexShrink: 0, width: 32, height: 32, borderRadius: 8,
            display: "flex", alignItems: "center", justifyContent: "center",
            marginLeft: 8,
            background: actionToast.kind === "error" ? "rgba(239,68,68,0.18)"
              : actionToast.kind === "queued" ? "rgba(245,158,11,0.18)"
              : "rgba(16,185,129,0.18)",
          }}>
            <Ico
              d={actionToast.kind === "error" ? I.close : actionToast.kind === "queued" ? I.clock : I.check}
              size={16}
              color={actionToast.kind === "error" ? "#EF4444" : actionToast.kind === "queued" ? "#F59E0B" : "#10B981"}
              sw={2.5}
            />
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
              color: actionToast.kind === "error" ? "#EF4444"
                : actionToast.kind === "queued" ? "#F59E0B"
                : "#10B981",
              marginBottom: 3,
            }}>
              {actionToast.kind === "error" ? "Error" : actionToast.kind === "queued" ? "Queued" : "Success"}
            </div>
            <div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 500, lineHeight: 1.45 }}>
              {actionToast.msg}
            </div>
          </div>

          {/* X close button */}
          <button
            onClick={() => setActionToast(null)}
            style={{
              flexShrink: 0, background: "none", border: "none", cursor: "pointer",
              padding: 4, borderRadius: 6, color: "#64748B",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#F8FAFC"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#64748B"; (e.currentTarget as HTMLButtonElement).style.background = "none"; }}
            aria-label="Dismiss"
          >
            <Ico d={I.close} size={14} color="currentColor" sw={2.5} />
          </button>
        </div>
      )}

      {showDeployModal && (
        <DeployModal
          nodeId={id!}
          catalog={catalog}
          deployments={data?.deployments ?? []}
          onClose={() => setShowDeployModal(false)}
          onSuccess={(depId) => { setActiveDeployID(depId); setTab("deployments"); }}
        />
      )}

      {/* ── Breadcrumb ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#94A3B8" }}>
        <Link
          to="/nodes"
          style={{ display: "flex", alignItems: "center", gap: 5, color: "#64748B", textDecoration: "none", fontWeight: 600 }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#B45309"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#64748B"}
        >
          <Ico d={I.back} size={14} /> Node Manager
        </Link>
        <Ico d={I.chevron} size={13} color="#CBD5E1" />
        <span style={{ color: "#0F172A", fontWeight: 700 }}>{node.name}</span>
      </div>

      {/* ── Hero ── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{
          height: 5,
          background: online
            ? "linear-gradient(90deg,#22C55E 0%,#16A34A 50%,#15803D 100%)"
            : "linear-gradient(90deg,#94A3B8,#CBD5E1)",
        }} />
        <div style={{ padding: "22px 26px", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>

          {/* Left: avatar + info */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20, flex: 1, minWidth: 0 }}>
            <div style={{
              width: 64, height: 64, borderRadius: 18, display: "grid", placeItems: "center",
              fontWeight: 900, fontSize: 26, flexShrink: 0,
              background: online
                ? "linear-gradient(135deg,#FCD34D 0%,#F59E0B 100%)"
                : "linear-gradient(135deg,#E2E8F0 0%,#CBD5E1 100%)",
              color: online ? "#1C0A00" : "#64748B",
              boxShadow: online ? "0 6px 22px rgba(245,158,11,0.36)" : "0 2px 8px rgba(0,0,0,0.07)",
            }}>
              {(node.name ?? "?").charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Name + status row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 22, fontWeight: 900, color: "#0F172A", margin: 0, letterSpacing: "-0.02em" }}>
                  {node.name}
                </h1>
                {/* Online badge */}
                <div title={agentOfflineButPotsRunning ? "Agent disconnected — honeypots still running" : online ? "Node agent connected" : "Node agent disconnected"} style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 99,
                  background: online ? "rgba(34,197,94,0.12)" : agentOfflineButPotsRunning ? "rgba(245,158,11,0.14)" : "rgba(100,116,139,0.1)",
                  border: `1.5px solid ${online ? "rgba(34,197,94,0.35)" : agentOfflineButPotsRunning ? "rgba(245,158,11,0.4)" : "rgba(100,116,139,0.22)"}`,
                }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: online ? "#22C55E" : agentOfflineButPotsRunning ? "#F59E0B" : "#94A3B8",
                    animation: online ? "pulse-green 2s infinite" : "none",
                    boxShadow: online ? "0 0 0 2px rgba(34,197,94,0.2)" : "none",
                    display: "inline-block", flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: online ? "#16A34A" : agentOfflineButPotsRunning ? "#B45309" : "#64748B" }}>
                    {online ? "Online" : agentOfflineButPotsRunning ? "Agent Offline" : "Offline"}
                  </span>
                </div>
                {agentOfflineButPotsRunning && (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 99,
                    background: "rgba(34,197,94,0.08)", border: "1.5px solid rgba(34,197,94,0.28)",
                    fontSize: 12, fontWeight: 700, color: "#16A34A",
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", animation: "pulse-green 2s infinite", display: "inline-block" }} />
                    {runningCount} honeypot{runningCount !== 1 ? "s" : ""} running
                  </div>
                )}
              </div>

              {/* Info grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
                gap: 8,
              }}>
                {/* Node ID */}
                <div style={{
                  padding: "9px 13px", borderRadius: 10,
                  background: "rgba(15,23,42,0.03)", border: "1px solid rgba(15,23,42,0.08)",
                }}>
                  <p style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.09em", margin: "0 0 4px" }}>
                    Node ID
                  </p>
                  <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13.5, fontWeight: 800, color: "#0F172A", margin: 0 }}>
                    {node.id}
                  </p>
                </div>

                {/* Last Heartbeat */}
                <div style={{
                  padding: "9px 13px", borderRadius: 10,
                  background: online ? "rgba(239,68,68,0.04)" : "rgba(15,23,42,0.03)",
                  border: `1px solid ${online ? "rgba(239,68,68,0.15)" : "rgba(15,23,42,0.08)"}`,
                }}>
                  <p style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.09em", margin: "0 0 5px" }}>
                    Last Heartbeat
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                      background: online ? "#EF4444" : "#94A3B8",
                      display: "inline-block",
                      animation: online ? "heartbeat 1.4s ease-in-out infinite" : "hb-offline 2s ease-in-out infinite",
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: online ? "#DC2626" : "#64748B" }}>
                      {relTime(node.last_heartbeat)}
                    </span>
                  </div>
                </div>

                {/* IP Address */}
                {node.ip_address && (
                  <div style={{
                    padding: "9px 13px", borderRadius: 10,
                    background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.14)",
                  }}>
                    <p style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.09em", margin: "0 0 4px" }}>
                      IP Address
                    </p>
                    <p style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, fontWeight: 800, color: "#1D4ED8", margin: 0 }}>
                      {node.ip_address}
                    </p>
                  </div>
                )}

                {/* OS / Architecture */}
                {node.os && (
                  <div style={{
                    padding: "9px 13px", borderRadius: 10,
                    background: "rgba(245,158,11,0.04)", border: "1px solid rgba(245,158,11,0.14)",
                  }}>
                    <p style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.09em", margin: "0 0 5px" }}>
                      Platform
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Ico d={node.os.toLowerCase() === "windows" ? I.windows : I.linux} size={13} color="#D97706" />
                      <span style={{ fontSize: 12.5, fontWeight: 800, color: "#92400E" }}>
                        <span style={{ textTransform: "capitalize" }}>{node.os}</span>
                        <span style={{ color: "#D97706", margin: "0 3px" }}>·</span>
                        <span style={{ fontFamily: "ui-monospace, monospace" }}>{node.arch}</span>
                      </span>
                    </div>
                  </div>
                )}

                {/* Hostname */}
                {node.hostname && (
                  <div style={{
                    padding: "9px 13px", borderRadius: 10,
                    background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.14)",
                  }}>
                    <p style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.09em", margin: "0 0 4px" }}>
                      Hostname
                    </p>
                    <p style={{ fontSize: 13, fontWeight: 800, color: "#5B21B6", margin: 0 }}>
                      {node.hostname}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: stats + deploy button */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* Mini stats */}
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 22, fontWeight: 900, color: "#0F172A", lineHeight: 1 }}>{activeCount}</p>
                <p style={{ fontSize: 10.5, color: "#94A3B8", fontWeight: 600, marginTop: 2 }}>Deployments</p>
              </div>
              <div style={{ width: 1, background: "rgba(15,23,42,0.08)" }} />
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 22, fontWeight: 900, color: runningCount > 0 ? "#16A34A" : "#94A3B8", lineHeight: 1 }}>{runningCount}</p>
                <p style={{ fontSize: 10.5, color: "#94A3B8", fontWeight: 600, marginTop: 2 }}>Running</p>
              </div>
            </div>

            <button
              onClick={() => setShowDeployModal(true)}
              className="btn btn-primary"
              style={{ gap: 8, padding: "10px 20px" }}
            >
              <Ico d={I.deploy} size={15} color="#1C0A00" />
              Deploy Honeypot
            </button>
          </div>
        </div>
      </div>

      {/* ── Live log (shown after deploy) ── */}
      {activeDeployID && (
        <div className="card animate-fade-up" style={{ overflow: "hidden" }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 18px", borderBottom: "1px solid rgba(15,23,42,0.07)",
            background: "#EEF2F6",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center",
                background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)",
              }}>
                <Ico d={I.logs} size={13} color="#D97706" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
                {activeDep?.pot_id ?? `Deployment #${activeDeployID}`} — Live Log
              </span>
              {activeDep && <StatusBadge status={activeDep.status} />}
              {!depDone && (
                <span style={{ fontSize: 11, fontWeight: 700, color: "#F59E0B", display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B", animation: "pulse-green 1.2s infinite" }} />
                  Live
                </span>
              )}
            </div>
            <button
              onClick={() => setActiveDeployID(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: "4px 8px", borderRadius: 6 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#475569"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#94A3B8"}
            >
              <Ico d={I.close} size={15} color="currentColor" />
            </button>
          </div>
          <div style={{
            height: 280, overflowY: "auto", padding: "14px 16px", background: "#EEF2F6",
            border: "1px solid rgba(15,23,42,0.07)",
            fontFamily: "ui-monospace, 'Cascadia Code', 'SF Mono', monospace", fontSize: 12.5, lineHeight: 1.75,
          }}>
            {(installLogs ?? []).length === 0 ? (
              <span style={{ color: "#94A3B8" }}>⏳ Waiting for logs…</span>
            ) : (installLogs ?? []).map((entry: any) => {
              let line = entry.data;
              try { line = JSON.parse(entry.data)?.line ?? entry.data; } catch { /* raw */ }
              const ts = new Date(entry.logged_at).toLocaleTimeString();
              const t  = entry.log_type ?? "";
              const color = t.includes("error")    ? "#DC2626"
                          : t.includes("warning")  ? "#D97706"
                          : t.includes("complete") ? "#16A34A"
                          : t.includes("start")    ? "#2563EB"
                          : "#475569";
              return (
                <div key={entry.id} style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
                  <span style={{ color: "#334155", minWidth: 72, flexShrink: 0, fontSize: 11 }}>{ts}</span>
                  <span style={{ color }}>{line}</span>
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 2, borderBottom: "2px solid rgba(15,23,42,0.07)" }}>
        {([
          { key: "deployments", label: `Deployments`, count: deps.length },
          { key: "metrics",     label: "Performance",          count: null },
          { key: "install",     label: "Install / Reinstall",  count: null },
          { key: "uninstall",   label: "Uninstall Agent",      count: null },
          { key: "danger",      label: "Danger Zone",          count: null },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer",
            background: "none", border: "none",
            color: tab === t.key ? "#B45309" : "#64748B",
            borderBottom: `2px solid ${tab === t.key ? "#F59E0B" : "transparent"}`,
            marginBottom: -2,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {t.label}
            {t.count !== null && (
              <span style={{
                padding: "1px 7px", borderRadius: 99, fontSize: 11, fontWeight: 800,
                background: tab === t.key ? "rgba(245,158,11,0.2)" : "rgba(15,23,42,0.06)",
                color: tab === t.key ? "#92400E" : "#94A3B8",
              }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── DEPLOYMENTS tab ── */}
      {tab === "deployments" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {deps.length === 0 ? (
            <div className="card" style={{ padding: "56px 24px", textAlign: "center" }}>
              <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
                <Ico d={I.honey} size={36} color="#F59E0B" sw={1.6} />
              </div>
              <p style={{ fontWeight: 800, fontSize: 15, color: "#0F172A", marginBottom: 6 }}>No deployments yet</p>
              <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>
                Deploy your first honeypot on this node.
              </p>
              <button onClick={() => setShowDeployModal(true)} className="btn btn-primary" style={{ display: "inline-flex" }}>
                <Ico d={I.deploy} size={14} color="#1C0A00" /> Deploy Honeypot
              </button>
            </div>
          ) : deps.map((d: any) => {
            const s = STATUS[d.status] ?? STATUS.stopped;
            const isActive = activeDeployID === d.id;
            return (
              <div key={d.id} className="card" style={{
                padding: 0, overflow: "hidden",
                borderLeft: `3px solid ${s.dot}`,
              }}>
                {/* Card header */}
                <div style={{ padding: "14px 18px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
                      background: `${s.bg}`, border: `1.5px solid ${s.border}`,
                    }}>
                      <Ico d={I.deploy} size={16} color={s.color} />
                    </div>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 800, fontSize: 14.5, color: "#0F172A" }}>{d.pot_id}</span>
                        <StatusBadge status={d.status} />
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
                        <span style={{
                          fontSize: 11.5, color: "#94A3B8",
                          background: "rgba(15,23,42,0.04)", padding: "1px 7px", borderRadius: 5,
                          border: "1px solid rgba(15,23,42,0.07)", fontWeight: 600,
                        }}>{d.honeypot_type}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ height: 1, background: "rgba(15,23,42,0.06)", margin: "0 18px" }} />

                {/* Actions */}
                {(() => {
                  const busy    = pendingAction?.startsWith(`${d.id}:`);
                  const busyAct = pendingAction?.split(":")[1];

                  const Spinner = ({ color }: { color: string }) => (
                    <span style={{
                      width: 11, height: 11, borderRadius: "50%", flexShrink: 0,
                      border: `2px solid ${color}44`, borderTopColor: color,
                      animation: "spin 0.65s linear infinite", display: "inline-block",
                    }} />
                  );

                  return (
                    <div style={{ padding: "10px 18px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      {/* Logs */}
                      <button
                        onClick={() => setActiveDeployID(isActive ? null : d.id)}
                        style={{
                          padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer",
                          background: isActive ? "rgba(245,158,11,0.15)" : "#EEF2F6",
                          border: `1.5px solid ${isActive ? "rgba(245,158,11,0.4)" : "rgba(15,23,42,0.12)"}`,
                          color: isActive ? "#B45309" : "#64748B",
                          display: "flex", alignItems: "center", gap: 5,
                        }}
                      >
                        <Ico d={I.logs} size={12} color="currentColor" /> {isActive ? "Hide Logs" : "Logs"}
                      </button>

                      <div style={{ flex: 1 }} />

                      {d.status !== "running" && d.status !== "removed" && (() => {
                        const isThis = busy && busyAct === "start";
                        return (
                          <button
                            onClick={() => action.mutate({ depID: d.id, act: "start" })}
                            disabled={!!busy}
                            style={{
                              padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                              cursor: busy ? "default" : "pointer",
                              background: isThis ? "rgba(34,197,94,0.14)" : busy ? "rgba(15,23,42,0.03)" : "rgba(34,197,94,0.08)",
                              border: `1.5px solid ${isThis ? "rgba(34,197,94,0.4)" : busy ? "rgba(15,23,42,0.07)" : "rgba(34,197,94,0.25)"}`,
                              color: isThis ? "#16A34A" : busy ? "#CBD5E1" : "#16A34A",
                              display: "flex", alignItems: "center", gap: 5,
                              opacity: busy && !isThis ? 0.4 : 1, transition: "opacity 0.2s",
                            }}
                          >
                            {isThis ? <><Spinner color="#16A34A" /> Starting…</> : <><Ico d={I.play} size={11} color="currentColor" /> Start</>}
                          </button>
                        );
                      })()}

                      {d.status === "running" && (() => {
                        const isStop    = busy && busyAct === "stop";
                        const isRestart = busy && busyAct === "restart";
                        return (
                          <>
                            <button
                              onClick={() => action.mutate({ depID: d.id, act: "stop" })}
                              disabled={!!busy}
                              style={{
                                padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                                cursor: busy ? "default" : "pointer",
                                background: isStop ? "rgba(100,116,139,0.14)" : busy ? "rgba(15,23,42,0.03)" : "rgba(100,116,139,0.08)",
                                border: `1.5px solid ${isStop ? "rgba(100,116,139,0.35)" : busy ? "rgba(15,23,42,0.07)" : "rgba(100,116,139,0.2)"}`,
                                color: isStop ? "#475569" : busy ? "#CBD5E1" : "#64748B",
                                display: "flex", alignItems: "center", gap: 5,
                                opacity: busy && !isStop ? 0.4 : 1, transition: "opacity 0.2s",
                              }}
                            >
                              {isStop ? <><Spinner color="#64748B" /> Stopping…</> : <><Ico d={I.stop} size={11} color="currentColor" /> Stop</>}
                            </button>
                            <button
                              onClick={() => action.mutate({ depID: d.id, act: "restart" })}
                              disabled={!!busy}
                              style={{
                                padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                                cursor: busy ? "default" : "pointer",
                                background: isRestart ? "rgba(245,158,11,0.14)" : busy ? "rgba(15,23,42,0.03)" : "rgba(245,158,11,0.08)",
                                border: `1.5px solid ${isRestart ? "rgba(245,158,11,0.4)" : busy ? "rgba(15,23,42,0.07)" : "rgba(245,158,11,0.25)"}`,
                                color: isRestart ? "#B45309" : busy ? "#CBD5E1" : "#B45309",
                                display: "flex", alignItems: "center", gap: 5,
                                opacity: busy && !isRestart ? 0.4 : 1, transition: "opacity 0.2s",
                              }}
                            >
                              {isRestart ? <><Spinner color="#B45309" /> Restarting…</> : <><Ico d={I.restart} size={11} color="currentColor" /> Restart</>}
                            </button>
                          </>
                        );
                      })()}

                      {d.status !== "removed" && (() => {
                        const isThis = busy && busyAct === "remove";
                        return (
                          <button
                            onClick={() => action.mutate({ depID: d.id, act: "remove" })}
                            disabled={!!busy}
                            style={{
                              padding: "5px 10px", borderRadius: 7, fontSize: 12, fontWeight: 700,
                              cursor: busy ? "default" : "pointer",
                              background: isThis ? "rgba(239,68,68,0.14)" : busy ? "rgba(15,23,42,0.03)" : "rgba(254,242,242,0.8)",
                              border: `1.5px solid ${isThis ? "rgba(239,68,68,0.4)" : busy ? "rgba(15,23,42,0.07)" : "rgba(239,68,68,0.2)"}`,
                              color: isThis ? "#EF4444" : busy ? "#CBD5E1" : "#EF4444",
                              display: "flex", alignItems: "center", gap: 5,
                              opacity: busy && !isThis ? 0.4 : 1, transition: "opacity 0.2s",
                            }}
                            onMouseEnter={e => { if (!busy) (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.12)"; }}
                            onMouseLeave={e => { if (!busy) (e.currentTarget as HTMLElement).style.background = "rgba(254,242,242,0.8)"; }}
                          >
                            {isThis ? <><Spinner color="#EF4444" /> Removing…</> : <><Ico d={I.trash} size={11} color="currentColor" /> Remove</>}
                          </button>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* ── METRICS tab ── */}
      {tab === "metrics" && <NodeMetricsPanel nodeId={id!} online={online} />}

      {/* ── INSTALL tab ── */}
      {tab === "install" && (
        <div className="card" style={{ padding: "24px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.1)", display: "grid", placeItems: "center", border: "1.5px solid rgba(245,158,11,0.25)" }}>
              <Ico d={I.install} size={18} color="#F59E0B" />
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0F172A" }}>Install Agent</h3>
          </div>
          <p style={{ fontSize: 13, color: "#64748B", marginBottom: 22, lineHeight: 1.6 }}>
            Run one of these commands as <strong>root / admin</strong> on the target machine. The agent will connect back and appear online within seconds.
          </p>

          {(["linux", "windows"] as const).map(plat => {
            const cmd = plat === "linux"
              ? `curl -fsSL "${base}/api/v1/nodes/${id}/install?token=YOUR_TOKEN" | bash`
              : `irm "${base}/api/v1/nodes/${id}/install?platform=windows&token=YOUR_TOKEN" | iex`;
            const key = `install-${plat}`;
            return (
              <div key={plat} style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 7, display: "flex", alignItems: "center", gap: 6 }}>
                  <Ico d={plat === "linux" ? I.linux : I.windows} size={14} color="#64748B" />
                  {plat === "linux" ? "Linux / macOS" : "Windows — PowerShell (Admin)"}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <code style={{
                    flex: 1, padding: "11px 14px", borderRadius: 9, fontSize: 12, fontFamily: "monospace",
                    background: "#E2E8F0", color: "#475569", wordBreak: "break-all", lineHeight: 1.65,
                    border: "1px solid rgba(15,23,42,0.08)",
                  }}>
                    <span style={{ color: "#B45309" }}>{cmd.split(" ")[0]}</span>
                    {" " + cmd.slice(cmd.indexOf(" ") + 1)}
                  </code>
                  <button
                    onClick={() => copyText(cmd, key)}
                    style={{
                      padding: "11px 16px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      background: copied === key ? "#F59E0B" : "#EEF2F6",
                      border: "1.5px solid rgba(15,23,42,0.12)",
                      color: copied === key ? "#1C0A00" : "#64748B",
                      display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
                    }}
                  >
                    {copied === key
                      ? <><Ico d={I.check} size={13} color="#1C0A00" /> Copied</>
                      : <><Ico d={I.copy}  size={13} color="#64748B" /> Copy</>}
                  </button>
                </div>
              </div>
            );
          })}

          <div style={{
            padding: "12px 16px", borderRadius: 10, marginTop: 8,
            background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.25)",
            fontSize: 12.5, color: "#92400E", lineHeight: 1.6,
          }}>
            <strong>Note:</strong> Replace <code style={{ background: "rgba(245,158,11,0.15)", padding: "1px 5px", borderRadius: 4 }}>YOUR_TOKEN</code> with the token shown when this node was registered. Lost it? Delete the node and re-register.
          </div>
        </div>
      )}

      {/* ── UNINSTALL tab ── */}
      {tab === "uninstall" && (
        <div className="card" style={{ padding: "24px 26px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(100,116,139,0.08)", display: "grid", placeItems: "center", border: "1.5px solid rgba(100,116,139,0.2)" }}>
              <Ico d={I.trash} size={18} color="#64748B" />
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0F172A" }}>Uninstall Agent</h3>
          </div>
          <p style={{ fontSize: 13, color: "#64748B", marginBottom: 22, lineHeight: 1.6 }}>
            Run one of these commands as <strong>root / admin</strong> on the target machine to stop the scheduled task/service, remove the binary, and wipe local data. This <em>does not</em> delete the node from the dashboard — use <strong>Danger Zone</strong> for that.
          </p>

          {(["linux", "windows"] as const).map(plat => {
            const cmd = plat === "linux"
              ? `curl -fsSL "${base}/api/v1/nodes/${id}/uninstall" | sudo bash`
              : `irm "${base}/api/v1/nodes/${id}/uninstall?platform=windows" | iex`;
            const key = `uninstall-${plat}`;
            return (
              <div key={plat} style={{ marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 7, display: "flex", alignItems: "center", gap: 6 }}>
                  <Ico d={plat === "linux" ? I.linux : I.windows} size={14} color="#64748B" />
                  {plat === "linux" ? "Linux / macOS" : "Windows — PowerShell (Admin)"}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <code style={{
                    flex: 1, padding: "11px 14px", borderRadius: 9, fontSize: 12, fontFamily: "monospace",
                    background: "#E2E8F0", color: "#475569", wordBreak: "break-all", lineHeight: 1.65,
                    border: "1px solid rgba(15,23,42,0.08)",
                  }}>
                    <span style={{ color: "#B45309" }}>{cmd.split(" ")[0]}</span>
                    {" " + cmd.slice(cmd.indexOf(" ") + 1)}
                  </code>
                  <button
                    onClick={() => copyText(cmd, key)}
                    style={{
                      padding: "11px 16px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer",
                      background: copied === key ? "#F59E0B" : "#EEF2F6",
                      border: "1.5px solid rgba(15,23,42,0.12)",
                      color: copied === key ? "#1C0A00" : "#64748B",
                      display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
                    }}
                  >
                    {copied === key
                      ? <><Ico d={I.check} size={13} color="#1C0A00" /> Copied</>
                      : <><Ico d={I.copy}  size={13} color="#64748B" /> Copy</>}
                  </button>
                </div>
              </div>
            );
          })}

          <div style={{
            padding: "12px 16px", borderRadius: 10, marginTop: 8,
            background: "rgba(100,116,139,0.06)", border: "1px solid rgba(100,116,139,0.2)",
            fontSize: 12.5, color: "#475569", lineHeight: 1.6,
          }}>
            <strong>What it removes:</strong> the scheduled task / systemd service, the <code>hb-node</code> binary, and the local <code>HoneyBeeNode/</code> data folder (including any installed honeypots). Server-side deployment history is preserved.
          </div>
        </div>
      )}

      {/* ── DANGER ZONE tab ── */}
      {tab === "danger" && (
        <div className="card" style={{ padding: "24px 26px", borderColor: "rgba(239,68,68,0.25)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(239,68,68,0.08)", display: "grid", placeItems: "center", border: "1.5px solid rgba(239,68,68,0.2)" }}>
              <Ico d={I.warn} size={18} color="#DC2626" />
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#DC2626" }}>Danger Zone</h3>
          </div>

          {/* What will happen — always visible */}
          <div style={{
            padding: "16px 18px", borderRadius: 12, marginBottom: 20,
            background: "rgba(254,242,242,0.6)", border: "1px solid rgba(239,68,68,0.2)",
          }}>
            <p style={{ fontSize: 12.5, fontWeight: 800, color: "#991B1B", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              What will happen when you delete this node:
            </p>
            <ul style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "#7F1D1D", lineHeight: 1.55 }}>
              <li>A <strong>remote uninstall command</strong> is sent to the agent on the machine — it will stop the service and remove itself.</li>
              <li>All <strong>{runningCount > 0 ? `${runningCount} running honeypot${runningCount !== 1 ? "s" : ""}` : "running honeypots"}</strong> on this node will be <strong>stopped</strong> and their containers removed.</li>
              <li>The node record and all <strong>{deps.length} deployment{deps.length !== 1 ? "s" : ""}</strong> will be <strong>permanently deleted</strong> from the dashboard.</li>
              <li>Captured <strong>event logs and audit history</strong> for this node will be deleted.</li>
              <li>This action <strong>cannot be undone</strong>. To re-use the machine, you would need to register a new node and re-deploy honeypots.</li>
            </ul>
            {!online && (
              <div style={{
                marginTop: 12, padding: "10px 12px", borderRadius: 8,
                background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
                fontSize: 12.5, color: "#92400E", display: "flex", alignItems: "flex-start", gap: 8,
              }}>
                <Ico d={I.warn} size={14} color="#D97706" />
                <span><strong>Node is currently offline.</strong> The remote uninstall command may not be delivered. The agent and any honeypots on the machine will continue running until the machine is reachable or manually cleaned up.</span>
              </div>
            )}
          </div>

          {!confirmUninstall ? (
            <button onClick={() => setConfirmUninstall(true)} className="btn btn-danger" style={{ display: "inline-flex", gap: 7 }}>
              <Ico d={I.trash} size={14} color="#FFFFFF" /> Uninstall agent &amp; delete node
            </button>
          ) : (
            <div style={{
              padding: "20px 22px", borderRadius: 14,
              background: "#FEF2F2", border: "1.5px solid #FECACA",
            }}>
              <p style={{ fontWeight: 800, color: "#DC2626", fontSize: 14, marginBottom: 6 }}>Are you absolutely sure?</p>
              <p style={{ fontSize: 13, color: "#B91C1C", marginBottom: 18, lineHeight: 1.55 }}>
                Node <strong>{node.name}</strong> and all <strong>{deps.length} deployment(s)</strong> will be permanently deleted.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  className="btn btn-danger"
                  disabled={uninstall.isPending}
                  onClick={() => uninstall.mutate()}
                >
                  {uninstall.isPending ? "Removing…" : "Yes, uninstall & delete"}
                </button>
                <button className="btn btn-secondary" onClick={() => setConfirmUninstall(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Node Metrics Panel ───────────────────────────── */
function NodeMetricsPanel({ nodeId, online }: { nodeId: string; online: boolean }) {
  const [hours, setHours] = useState(1);
  const [refreshInterval, setRefreshInterval] = useState(0); // 0 = manual

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["node-metrics", nodeId, hours],
    queryFn: async () => (await api.get(`/nodes/${nodeId}/metrics?hours=${hours}`)).data,
    // Auto-refresh always reads from the DB — works whether the node is online or not
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    refetchOnWindowFocus: false,
  });

  const [isCommandPending, setIsCommandPending] = useState(false);

  const handleManualRefresh = async () => {
    if (!online) {
      // Node is offline — just pull latest DB records
      refetch();
      return;
    }
    setIsCommandPending(true);
    try {
      await api.post(`/nodes/${nodeId}/command`, { command: "request_heartbeat", payload: {} });
      // Wait 1.5 s so the node has time to push metrics back before we pull from DB
      setTimeout(() => {
        refetch().finally(() => setIsCommandPending(false));
      }, 1500);
    } catch {
      refetch().finally(() => setIsCommandPending(false));
    }
  };

  const history: any[] = data?.history ?? [];
  const latest = data?.latest;

  function fmtTime(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="space-y-4 animate-fade-up">
      {/* Current stats */}
      <div className="card p-5">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.1)", display: "grid", placeItems: "center", border: "1.5px solid rgba(245,158,11,0.25)" }}>
              <Ico d={I.shield} size={18} color="#F59E0B" />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 800, color: "#0F172A", margin: 0 }}>Performance Metrics</h3>
              <p style={{ fontSize: 12, color: "#94A3B8", margin: 0 }}>
                {online ? "Real-time monitoring" : "Last known values"}
              </p>
            </div>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", padding: 4,
            background: "#F8FAFC", border: "1px solid #E2E8F0",
            borderRadius: 12, gap: 4,
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.02)"
          }}>
            <select
              className="input"
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              style={{ 
                padding: "6px 26px 6px 12px", fontSize: 12.5, minWidth: 120, height: 30, 
                background: "transparent", border: "none", boxShadow: "none", color: "#475569", fontWeight: 600
              }}
            >
              <option value={0}>Manual Refresh</option>
              <option value={60000}>Every 1 min</option>
              <option value={300000}>Every 5 mins</option>
              <option value={900000}>Every 15 mins</option>
            </select>
            
            <div style={{ width: 1, height: 16, background: "#CBD5E1", margin: "0 2px" }} />
            
            <select
              className="input"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              style={{ 
                padding: "6px 26px 6px 12px", fontSize: 12.5, minWidth: 110, height: 30, 
                background: "transparent", border: "none", boxShadow: "none", color: "#475569", fontWeight: 600
              }}
            >
              <option value={1}>Last 1 hour</option>
              <option value={6}>Last 6 hours</option>
              <option value={24}>Last 24 hours</option>
              <option value={168}>Last 7 days</option>
            </select>
            
            <button
              onClick={handleManualRefresh}
              disabled={isFetching || isCommandPending}
              style={{
                padding: "0 14px", height: 30, borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                background: "#FFFFFF", border: "1px solid #E2E8F0",
                color: (isFetching || isCommandPending) ? "#94A3B8" : "#0F172A",
                cursor: (isFetching || isCommandPending) ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 6,
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ 
                animation: (isFetching || isCommandPending) ? "spin 1s linear infinite" : "none",
                display: "inline-flex"
              }}>
                <Ico d={I.restart} size={13} color={(isFetching || isCommandPending) ? "#94A3B8" : "#B45309"} />
              </span>
              {(isFetching || isCommandPending) ? "Refreshing…" : "Refresh"}
            </button>
            {refreshInterval > 0 && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "0 10px", height: 30,
                borderRadius: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)",
                fontSize: 11.5, fontWeight: 700, color: "#16A34A",
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22C55E", animation: "pulse-green 2s infinite" }} />
                Auto
              </div>
            )}
          </div>
        </div>

        {/* Current values */}
        {latest && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 16 }}>
            <MetricGauge label="CPU" value={latest.cpu_pct} color="#F59E0B" />
            <MetricGauge label="Memory" value={latest.mem_pct} color="#3B82F6" />
            <MetricGauge label="Disk" value={latest.disk_pct} color="#10B981" />
            <div style={{ padding: 12, borderRadius: 10, background: "#F8FAFC", border: "1px solid rgba(15,23,42,0.07)", textAlign: "center" }}>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Uptime</p>
              <p style={{ fontSize: 18, fontWeight: 900, color: "#0F172A" }}>{formatUptime(latest.uptime_secs)}</p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div style={{ height: 200, display: "grid", placeItems: "center" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", border: "3px solid #F59E0B", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>
            No metrics data available yet. Metrics are recorded with each heartbeat.
          </div>
        ) : (
          <div style={{ height: 280, position: "relative" }}>
            {isFetching && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(255,255,255,0.55)", borderRadius: 8,
              }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", border: "3px solid #F59E0B", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="diskGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="recorded_at" tickFormatter={fmtTime} tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94A3B8" tickFormatter={(v: number) => `${v}%`} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} formatter={(v: any) => `${Number(v).toFixed(1)}%`} labelFormatter={(label: any) => fmtTime(String(label))} />
                <Legend />
                <Area type="monotone" dataKey="cpu_pct" stroke="#F59E0B" strokeWidth={2} fill="url(#cpuGrad)" name="CPU %" />
                <Area type="monotone" dataKey="mem_pct" stroke="#3B82F6" strokeWidth={2} fill="url(#memGrad)" name="Memory %" />
                <Area type="monotone" dataKey="disk_pct" stroke="#10B981" strokeWidth={2} fill="url(#diskGrad)" name="Disk %" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricGauge({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.min(value, 100);
  return (
    <div style={{ padding: 12, borderRadius: 10, background: "#F8FAFC", border: "1px solid rgba(15,23,42,0.07)", textAlign: "center" }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 900, color, marginBottom: 6 }}>{pct.toFixed(1)}%</p>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(15,23,42,0.06)" }}>
        <div style={{ height: 5, borderRadius: 3, background: color, width: `${pct}%`, transition: "width 0.5s ease" }} />
      </div>
    </div>
  );
}

function formatUptime(secs: number): string {
  if (!secs || secs <= 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

