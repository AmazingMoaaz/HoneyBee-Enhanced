import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";
import { useAuthStore } from "../stores/auth";

/* ── SVG Icon helper ─────────────────────────────── */
const Ico = ({ d, size = 20, color = "currentColor", sw = 2 }: { d: string; size?: number; color?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/* ── SVG paths ───────────────────────────────────── */
const P = {
  sync:    "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  search:  "M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z",
  deploy:  "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  check:   "M20 6L9 17l-5-5",
  close:   "M18 6L6 18M6 6l12 12",
  arrow:   "M5 12h14M12 5l7 7-7 7",
  link:    "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  clock:   "M12 8v4l3 3M12 22a10 10 0 110-20 10 10 0 010 20z",
  warn:    "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  shield:  "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  event:   "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
};

/* ── Static enrichment from README ──────────────────
   Fills in rich data the API catalogue doesn't include:
   emoji, default ports, use-cases, event types.       */
type PotStatic = {
  emoji: string;
  color: string;
  textColor: string;
  bg: string;
  border: string;
  label: string;
  features: string[];
  defaultPorts: Record<string, string | number>;
  useCases: string[];
  eventTypes: { id: string; desc: string }[];
};

const POT_STATIC: Record<string, PotStatic> = {
  cowrie: {
    emoji: "🐄",
    color: "#F59E0B", textColor: "#92400E", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)",
    label: "SSH / Telnet — The Swiss Army Knife of SSH Honeypots",
    features: [
      "SSH Honeypot — emulates OpenSSH server",
      "Telnet Honeypot — full fake Telnet service",
      "Command Logging — records every shell command",
      "File Download Tracking — captures malware samples",
      "Session Recording — full UML/TTY playback",
      "Custom Plugins — extend with Python hooks",
      "Python 3.7+ — lightweight, no heavy deps",
    ],
    defaultPorts: { SSH: 2222, Telnet: 2223 },
    useCases: [
      "Detect SSH brute-force attacks",
      "Monitor credential stuffing campaigns",
      "Track attacker TTPs in fake shell sessions",
      "Collect live malware samples via file-download traps",
      "Threat intelligence & research data collection",
    ],
    eventTypes: [
      { id: "cowrie.login.success",         desc: "Successful auth — username, password, IP, timestamp" },
      { id: "cowrie.login.failed",          desc: "Failed login attempt with credentials" },
      { id: "cowrie.command.input",         desc: "Command executed inside the fake shell" },
      { id: "cowrie.session.file_download", desc: "Malware / payload downloaded by attacker" },
      { id: "cowrie.session.closed",        desc: "Session terminated — duration and bytes" },
    ],
  },
  honnypotter: {
    emoji: "🪄",
    color: "#7C3AED", textColor: "#5B21B6", bg: "rgba(124,58,237,0.1)", border: "rgba(124,58,237,0.28)",
    label: "WordPress Login — The Silent Guardian of Web Applications",
    features: [
      "WordPress Emulation — full wp-login.php page replica",
      "Brute-Force Detection — burst tracking per IP",
      "Credential Logging — every username + password captured",
      "XML-RPC Support — traps system.multicall attacks",
      "Low Resource Usage — single PHP file, no framework",
      "No Database Required — runs completely standalone",
      "Plugin Mode — embed inside real WordPress install",
    ],
    defaultPorts: { HTTP: 8080, HTTPS: 443 },
    useCases: [
      "WordPress brute-force detection",
      "Credential stuffing & password spray monitoring",
      "Web application attack surface analysis",
      "XML-RPC API abuse detection",
      "Threat intelligence on web-targeting actors",
    ],
    eventTypes: [
      { id: "honnypotter.login.failed",        desc: "Failed wp-login — username, password, IP" },
      { id: "honnypotter.xmlrpc.attack",       desc: "XML-RPC call — method, credentials, IP" },
      { id: "honnypotter.bruteforce.detected", desc: "Burst detection — IP, attempt count, window" },
    ],
  },
  webtrap: {
    emoji: "🕸️",
    color: "#0EA5E9", textColor: "#075985", bg: "rgba(14,165,233,0.1)", border: "rgba(14,165,233,0.28)",
    label: "Web / HTTP Deception Traps",
    features: [
      "Configurable fake admin panels & login pages",
      "HTTP request fingerprinting — headers, UA, TLS",
      "Canary token & credential support",
      "File upload trap — webshell attempt capture",
      "Heuristic tagging — SQLi, XSS, RCE, LFI detection",
      "Session & IP tracking across requests",
      "Low resource usage — async Python, < 50 MB RAM",
    ],
    defaultPorts: { HTTP: 8088 },
    useCases: [
      "Fake admin panel & phishing capture",
      "REST / GraphQL API abuse detection",
      "Webshell upload attempt logging",
      "Sensitive file probing (.env, .git, config)",
      "SQLi / XSS / RCE / LFI payload tagging",
    ],
    eventTypes: [
      { id: "webtrap.request",     desc: "Full HTTP request — headers, body, heuristic tags" },
      { id: "webtrap.file_upload", desc: "Webshell or file upload attempt" },
      { id: "webtrap.canary_hit",  desc: "Canary credential used — source traced" },
    ],
  },
};

/* Coming-soon enrichment (emoji + colour + protocol summary) */
const COMING_SOON_META: Record<string, { emoji: string; color: string; protocols: string }> = {
  dionaea:    { emoji: "🦎", color: "#EF4444", protocols: "FTP · HTTP · SMB · MySQL" },
  heralding:  { emoji: "📢", color: "#F97316", protocols: "SSH · FTP · HTTP · SMTP · Telnet · VNC" },
  elasticpot: { emoji: "🔍", color: "#06B6D4", protocols: "HTTP (Elasticsearch)" },
  mailoney:   { emoji: "📧", color: "#22C55E", protocols: "SMTP" },
  glastopf:   { emoji: "🌐", color: "#8B5CF6", protocols: "HTTP · HTTPS" },
  kippo:      { emoji: "🔐", color: "#64748B", protocols: "SSH (legacy)" },
};

/* Static items present in the README roadmap but not yet in the API */
const EXTRA_COMING_SOON = [
  {
    id: "heralding",
    name: "Heralding",
    status: "planned",
    description: "Multi-protocol credential honeypot — captures login attempts across SSH, FTP, HTTP, SMTP, Telnet, and VNC in a single lightweight service.",
  },
  {
    id: "elasticpot",
    name: "Elasticpot",
    status: "planned",
    description: "Elasticsearch honeypot that mimics an unprotected search cluster, luring and logging search-engine-targeted scanners and data thieves.",
  },
  {
    id: "mailoney",
    name: "Mailoney",
    status: "planned",
    description: "SMTP honeypot for capturing email-based attacks, phishing probes, and spam-relay attempts against open mail relay exploits.",
  },
];

const META_DEFAULT: PotStatic = {
  emoji: "🍯",
  color: "#F59E0B", textColor: "#92400E", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)",
  label: "Honeypot",
  features: [],
  defaultPorts: {},
  useCases: [],
  eventTypes: [],
};

const LANG_COLOR: Record<string, { bg: string; color: string }> = {
  python: { bg: "rgba(59,130,246,0.1)",  color: "#1D4ED8" },
  php:    { bg: "rgba(124,58,237,0.1)",  color: "#6D28D9" },
  go:     { bg: "rgba(6,182,212,0.1)",   color: "#0E7490" },
  node:   { bg: "rgba(34,197,94,0.1)",   color: "#15803D" },
};

/* ── Deploy Modal ────────────────────────────────── */
function DeployModal({ pot, onClose }: { pot: any; onClose: () => void }) {
  const meta = POT_STATIC[pot.id] ?? META_DEFAULT;
  const [nodeId, setNodeId]   = useState("");
  const [instId, setInstId]   = useState(`${pot.id}-01`);
  const [success, setSuccess] = useState<{ nodeName: string } | null>(null);

  const { data: nodesData, isLoading: nodesLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
  });
  const nodes: any[] = nodesData ?? [];
  const online       = nodes.filter(n => n.online);

  const deploy = useMutation({
    mutationFn: async () =>
      (await api.post(`/nodes/${nodeId}/deployments`, {
        pot_id: instId, honeypot_type: pot.id, auto_start: true, config: {},
      })).data,
    onSuccess: () => {
      const node = nodes.find(n => String(n.id) === String(nodeId));
      setSuccess({ nodeName: node?.name ?? "node" });
    },
  });

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,23,42,0.6)", backdropFilter: "blur(6px)", padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#FFFFFF", borderRadius: 20, width: "100%", maxWidth: 520,
        boxShadow: "0 32px 96px rgba(15,23,42,0.28)", border: "1px solid rgba(15,23,42,0.06)",
        overflow: "hidden",
      }}>
        {/* Stripe */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${meta.color}, ${meta.color}88)` }} />

        {/* Header */}
        <div style={{
          padding: "18px 22px", borderBottom: "1px solid rgba(15,23,42,0.07)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: meta.bg,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0, fontSize: 24,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#FFFFFF", border: `2px solid ${meta.border}`,
            }}>{meta.emoji}</div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 800, color: "#0F172A" }}>Deploy {pot.name}</p>
              <p style={{ fontSize: 11.5, color: meta.textColor, fontWeight: 600, lineHeight: 1.4 }}>{meta.label}</p>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center",
          }}>
            <Ico d={P.close} size={16} color="#94A3B8" />
          </button>
        </div>

        <div style={{ padding: "20px 22px" }}>
          {success ? (
            /* Success */
            <div style={{ textAlign: "center", padding: "8px 0 16px" }}>
              <div style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "rgba(34,197,94,0.12)", border: "2px solid rgba(34,197,94,0.35)",
                display: "grid", placeItems: "center", margin: "0 auto 14px", fontSize: 26,
              }}>✓</div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "#0F172A", marginBottom: 6 }}>Deployment queued!</p>
              <p style={{ fontSize: 13, color: "#64748B", marginBottom: 20 }}>
                <strong>{meta.emoji} {pot.name}</strong> is being installed on <strong>{success.nodeName}</strong>.
                Track live logs in Node Manager.
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <a href={`/nodes/${nodeId}`} style={{
                  padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                  background: "linear-gradient(135deg,#FCD34D,#D97706)", color: "#1C0A00",
                  textDecoration: "none", display: "flex", alignItems: "center", gap: 5,
                }}>
                  View Node <Ico d={P.arrow} size={13} color="#1C0A00" />
                </a>
                <button onClick={onClose} style={{
                  padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                  background: "#F8FAFC", border: "1.5px solid rgba(15,23,42,0.12)", color: "#64748B", cursor: "pointer",
                }}>Close</button>
              </div>
            </div>
          ) : (
            <>
              {/* Quick-facts preview */}
              {Object.keys(meta.defaultPorts).length > 0 && (
                <div style={{
                  padding: "10px 14px", borderRadius: 10, marginBottom: 20,
                  background: meta.bg, border: `1px solid ${meta.border}`,
                  display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center",
                }}>
                  {Object.entries(meta.defaultPorts).map(([proto, port]) => (
                    <div key={proto} style={{ textAlign: "center" }}>
                      <p style={{ fontSize: 10, fontWeight: 700, color: meta.textColor, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 1 }}>
                        {proto}
                      </p>
                      <p style={{ fontSize: 16, fontWeight: 900, color: meta.color, fontFamily: "monospace" }}>{port}</p>
                    </div>
                  ))}
                  <div style={{ width: 1, height: 32, background: `${meta.border}` }} />
                  <p style={{ fontSize: 11.5, color: meta.textColor, lineHeight: 1.5 }}>
                    Default ports — override in config
                  </p>
                </div>
              )}

              {/* Node select */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6 }}>
                  Target Node <span style={{ color: "#EF4444" }}>*</span>
                </label>
                {nodesLoading ? (
                  <p style={{ fontSize: 13, color: "#94A3B8" }}>Loading nodes…</p>
                ) : online.length === 0 ? (
                  <div style={{
                    padding: "12px 14px", borderRadius: 10, fontSize: 13,
                    background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)",
                    color: "#DC2626", display: "flex", gap: 8, alignItems: "center",
                  }}>
                    <Ico d={P.warn} size={15} color="#DC2626" />
                    No online nodes. Start a node first.
                  </div>
                ) : (
                  <select value={nodeId} onChange={e => setNodeId(e.target.value)} style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 14,
                    border: "1.5px solid rgba(15,23,42,0.12)", background: "#F8FAFC", color: "#0F172A",
                    outline: "none", cursor: "pointer",
                  }}>
                    <option value="">— Select a node —</option>
                    {online.map((n: any) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                )}
                <p style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 4 }}>
                  Only online nodes shown. {nodes.length - online.length} offline.
                </p>
              </div>

              {/* Instance ID */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 6 }}>
                  Instance ID <span style={{ color: "#EF4444" }}>*</span>
                </label>
                <input
                  value={instId} onChange={e => setInstId(e.target.value)}
                  placeholder="e.g. cowrie-prod-01"
                  style={{
                    width: "100%", padding: "10px 14px", borderRadius: 10, fontSize: 14,
                    border: "1.5px solid rgba(15,23,42,0.12)", background: "#F8FAFC", color: "#0F172A",
                    outline: "none", boxSizing: "border-box",
                  }}
                />
                <p style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 4 }}>
                  Unique label. Multiple instances of the same honeypot can run on one node.
                </p>
              </div>

              {deploy.isError && (
                <div style={{
                  padding: "10px 14px", borderRadius: 9, marginBottom: 16, fontSize: 13,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#DC2626",
                }}>
                  Deployment failed. Verify the node is reachable and online.
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => deploy.mutate()}
                  disabled={!nodeId || !instId.trim() || deploy.isPending}
                  style={{
                    flex: 1, padding: "11px 0", borderRadius: 10, fontSize: 14, fontWeight: 700, border: "none",
                    background: !nodeId || !instId.trim()
                      ? "#F1F5F9"
                      : "linear-gradient(135deg,#FCD34D 0%,#F59E0B 50%,#D97706 100%)",
                    cursor: !nodeId || !instId.trim() ? "not-allowed" : "pointer",
                    color: !nodeId || !instId.trim() ? "#94A3B8" : "#1C0A00",
                    boxShadow: !nodeId ? "none" : "0 4px 14px rgba(245,158,11,0.35)",
                  }}
                >
                  {deploy.isPending ? "Deploying…" : `Deploy ${meta.emoji} ${pot.name}`}
                </button>
                <button onClick={onClose} style={{
                  padding: "11px 18px", borderRadius: 10, fontSize: 14, fontWeight: 700,
                  background: "#F8FAFC", border: "1.5px solid rgba(15,23,42,0.12)", color: "#64748B", cursor: "pointer",
                }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Pot Card ────────────────────────────────────── */
function PotCard({ pot, onDeploy }: { pot: any; onDeploy: () => void }) {
  const meta      = POT_STATIC[pot.id] ?? META_DEFAULT;
  const langSt    = LANG_COLOR[pot.language] ?? { bg: "rgba(100,116,139,0.1)", color: "#475569" };
  const [infoModal, setInfoModal] = useState(false);
  const [infoTab,   setInfoTab]   = useState<"features"|"events"|"usecases">("features");
  // Static features take priority; fall back to API data
  const features: string[] = (meta.features?.length ? meta.features : null) ?? pot.features ?? [];
  const protocols: string[] = pot.protocols ?? [];

  return (
    <div className="card card-hover" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Colored stripe */}
      <div style={{ height: 5, background: `linear-gradient(90deg, ${meta.color} 0%, ${meta.color}55 100%)` }} />

      <div style={{ padding: "18px 18px 14px", flex: 1, display: "flex", flexDirection: "column" }}>

        {/* Header: emoji + name + badges */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 12 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: 26,
            background: meta.bg, border: `1.5px solid ${meta.border}`,
            boxShadow: `0 4px 16px ${meta.bg}`,
          }}>
            {meta.emoji}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <p style={{ fontWeight: 900, fontSize: 17, color: "#0F172A" }}>{pot.name}</p>
              {pot.status === "stable" && (
                <span style={{
                  padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700,
                  background: "rgba(34,197,94,0.12)", color: "#15803D", border: "1px solid rgba(34,197,94,0.3)",
                }}>
                  ✓ Stable {pot.version}
                </span>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              <span style={{
                padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                background: langSt.bg, color: langSt.color,
              }}>{pot.language}</span>
              {protocols.map(pr => (
                <span key={pr} style={{
                  padding: "2px 8px", borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                  background: meta.bg, color: meta.textColor, border: `1px solid ${meta.border}`,
                }}>{pr.toUpperCase()}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Description */}
        <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.65, marginBottom: 14 }}>
          {pot.description}
        </p>

        {/* Default ports bar */}
        {Object.keys(meta.defaultPorts).length > 0 && (
          <div style={{
            display: "flex", gap: 16, alignItems: "center", marginBottom: 14,
            padding: "9px 12px", borderRadius: 10,
            background: "rgba(248,250,252,0.9)", border: "1px solid rgba(15,23,42,0.07)",
          }}>
            {Object.entries(meta.defaultPorts).map(([proto, port]) => (
              <div key={proto} style={{ textAlign: "center" }}>
                <p style={{ fontSize: 9.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 1 }}>
                  {proto}
                </p>
                <p style={{ fontSize: 15, fontWeight: 900, color: meta.color, fontFamily: "monospace" }}>{port}</p>
              </div>
            ))}
            <div style={{ width: 1, height: 28, background: "rgba(15,23,42,0.07)" }} />
            <p style={{ fontSize: 11.5, color: "#94A3B8", lineHeight: 1.4 }}>Default ports — configurable per deployment</p>
          </div>
        )}

      </div>

      {/* Info popup modal — rendered via portal to escape card's CSS transform stacking context */}
      {infoModal && createPortal(
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(15,23,42,0.55)", backdropFilter: "blur(6px)", padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setInfoModal(false); }}
        >
          <div style={{
            background: "#FFFFFF", borderRadius: 20, width: "100%", maxWidth: 480,
            boxShadow: "0 32px 96px rgba(15,23,42,0.28)", border: "1px solid rgba(15,23,42,0.06)",
            overflow: "hidden",
          }}>
            <div style={{ height: 4, background: `linear-gradient(90deg, ${meta.color}, ${meta.color}88)` }} />
            {/* Modal header */}
            <div style={{
              padding: "16px 20px", borderBottom: "1px solid rgba(15,23,42,0.07)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: meta.bg,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{meta.emoji}</span>
                <div>
                  <p style={{ fontWeight: 800, fontSize: 15, color: "#0F172A" }}>{pot.name}</p>
                  <p style={{ fontSize: 11.5, color: meta.textColor, fontWeight: 600 }}>{meta.label}</p>
                </div>
              </div>
              <button onClick={() => setInfoModal(false)} style={{
                background: "none", border: "none", cursor: "pointer",
                width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center",
              }}>
                <Ico d={P.close} size={16} color="#94A3B8" />
              </button>
            </div>
            {/* Tab bar */}
            <div style={{ display: "flex", borderBottom: "1px solid rgba(15,23,42,0.07)", padding: "0 20px" }}>
              {(["features","events","usecases"] as const).map(tab => {
                const labels: Record<string,string> = { features: "Features", events: "Events", usecases: "Use Cases" };
                const active = infoTab === tab;
                return (
                  <button key={tab} onClick={() => setInfoTab(tab)} style={{
                    padding: "10px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    background: "none", border: "none",
                    borderBottom: active ? `2px solid ${meta.color}` : "2px solid transparent",
                    color: active ? meta.color : "#94A3B8",
                    marginBottom: -1,
                  }}>
                    {labels[tab]}
                  </button>
                );
              })}
            </div>
            {/* Modal body */}
            <div style={{ padding: "20px", maxHeight: "40vh", overflowY: "auto" }}>
              {infoTab === "features" && features.map((f: string) => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                  <div style={{ marginTop: 1, flexShrink: 0 }}><Ico d={P.check} size={12} color={meta.color} /></div>
                  <span style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
              {infoTab === "events" && meta.eventTypes.map(ev => (
                <div key={ev.id} style={{ marginBottom: 12 }}>
                  <code style={{ fontSize: 11.5, color: meta.color, fontFamily: "monospace", fontWeight: 700 }}>{ev.id}</code>
                  <p style={{ fontSize: 12.5, color: "#64748B", marginTop: 3, lineHeight: 1.5 }}>{ev.desc}</p>
                </div>
              ))}
              {infoTab === "usecases" && meta.useCases.map(u => (
                <div key={u} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                  <div style={{ marginTop: 1, flexShrink: 0 }}><Ico d={P.shield} size={12} color={meta.color} /></div>
                  <span style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>{u}</span>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Card footer */}
      <div style={{
        borderTop: "1px solid rgba(15,23,42,0.06)", padding: "11px 18px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "rgba(248,250,252,0.6)",
      }}>
        <a
          href={pot.git_url} target="_blank" rel="noreferrer"
          style={{
            fontSize: 11.5, color: "#94A3B8", display: "flex", alignItems: "center", gap: 4,
            textDecoration: "none", fontWeight: 600,
          }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#64748B"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#94A3B8"}
        >
          <Ico d={P.link} size={12} color="#94A3B8" /> Source
        </a>
        {/* Info + Deploy buttons side by side */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => setInfoModal(true)}
            style={{
              padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: "rgba(248,250,252,0.9)",
              border: "1.5px solid rgba(15,23,42,0.1)", color: "#64748B",
              display: "flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = meta.bg; (e.currentTarget as HTMLElement).style.borderColor = meta.border; (e.currentTarget as HTMLElement).style.color = meta.textColor; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(248,250,252,0.9)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(15,23,42,0.1)"; (e.currentTarget as HTMLElement).style.color = "#64748B"; }}
          >
            <Ico d={P.event} size={13} color="currentColor" />
            Info
          </button>
          <button
            onClick={onDeploy}
            style={{
              padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: `linear-gradient(135deg, ${meta.color}22 0%, ${meta.color}11 100%)`,
              border: `1.5px solid ${meta.border}`, color: meta.textColor,
              display: "flex", alignItems: "center", gap: 7,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = meta.bg; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = `linear-gradient(135deg, ${meta.color}22 0%, ${meta.color}11 100%)`; }}
          >
            <Ico d={P.deploy} size={14} color={meta.textColor} />
            Deploy {meta.emoji}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Coming-Soon Card ────────────────────────────── */
function ComingSoonCard({ pot }: { pot: any }) {
  const cs = COMING_SOON_META[pot.id];
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, flexShrink: 0, fontSize: 20,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: cs ? `${cs.color}12` : "rgba(148,163,184,0.1)",
          border: cs ? `1.5px solid ${cs.color}44` : "1.5px solid rgba(148,163,184,0.2)",
        }}>
          {cs?.emoji ?? "🍯"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: "#64748B" }}>{pot.name}</p>
            <span style={{
              padding: "1px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700,
              background: "rgba(245,158,11,0.1)", color: "#B45309", border: "1px solid rgba(245,158,11,0.2)",
            }}>
              {pot.status === "planned" ? "Planned" : "In Development"}
            </span>
          </div>
          {cs?.protocols && (
            <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 2, fontWeight: 600 }}>{cs.protocols}</p>
          )}
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "#94A3B8", lineHeight: 1.55 }}>{pot.description}</p>
    </div>
  );
}

/* ── Page ────────────────────────────────────────── */
export default function PotStorePage() {
  const role = useAuthStore(s => s.role);
  const qc   = useQueryClient();
  const [deployTarget, setDeployTarget] = useState<any | null>(null);
  const [search, setSearch]             = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["potstore"],
    queryFn: async () => (await api.get("/potstore")).data,
    staleTime: 60_000,
  });
  const sync = useMutation({
    mutationFn: async () => (await api.post("/potstore/sync")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["potstore"] }),
  });

  const pots: any[]          = data?.pots ?? [];
  const apiComingSoon: any[] = data?.coming_soon ?? [];

  /* Merge API coming-soon with extra items from README roadmap not in API yet */
  const apiIds     = new Set(apiComingSoon.map((p: any) => p.id));
  const comingSoon = [
    ...apiComingSoon,
    ...EXTRA_COMING_SOON.filter(p => !apiIds.has(p.id)),
  ];

  const filtered = pots.filter(p =>
    !search.trim() ||
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.id.toLowerCase().includes(search.toLowerCase()) ||
    (p.protocols ?? []).some((pr: string) => pr.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }} className="animate-fade-up">

      {deployTarget && <DeployModal pot={deployTarget} onClose={() => setDeployTarget(null)} />}

      {/* ── Page header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="page-label">Honeypot Catalogue</p>
          <h1 className="page-title">HoneyBee Store</h1>
          <p style={{ fontSize: 13.5, color: "#64748B", marginTop: 5, maxWidth: 540, lineHeight: 1.65 }}>
            Browse and deploy production-ready honeypots — pre-configured, battle-tested, zero-config.
            Think of it as the <strong>App Store for honeypots</strong>.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{
            display: "flex", gap: 8, padding: "7px 14px", borderRadius: 99,
            background: "rgba(245,158,11,0.1)", border: "1.5px solid rgba(245,158,11,0.25)",
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#B45309" }}>{pots.length}</span>
            <span style={{ fontSize: 13, color: "#92400E", fontWeight: 600 }}>Available</span>
          </div>
          <div style={{
            display: "flex", gap: 8, padding: "7px 14px", borderRadius: 99,
            background: "rgba(100,116,139,0.08)", border: "1px solid rgba(100,116,139,0.15)",
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: "#475569" }}>{comingSoon.length}</span>
            <span style={{ fontSize: 13, color: "#64748B", fontWeight: 600 }}>On Roadmap</span>
          </div>
          {role === "admin" && (
            <button
              className="btn btn-secondary"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
              style={{ display: "flex", alignItems: "center", gap: 7 }}
            >
              <Ico d={P.sync} size={14} color="#64748B" />
              {sync.isPending ? "Syncing…" : "Sync Catalogue"}
            </button>
          )}
        </div>
      </div>

      {/* ── Search bar ── */}
      <div style={{ position: "relative", maxWidth: 380 }}>
        <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
          <Ico d={P.search} size={15} color="#94A3B8" />
        </div>
        <input
          className="input"
          placeholder="Search by name, type or protocol…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ paddingLeft: 38, width: "100%", boxSizing: "border-box" }}
        />
      </div>

      {/* ── Available pots ── */}
      {isLoading ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#94A3B8" }}>Loading catalogue…</div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>No pots match "{search}"</p>
          <p style={{ fontSize: 13, color: "#64748B" }}>Try a different keyword.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 16 }}>
          {filtered.map(p => (
            <PotCard key={p.id} pot={p} onDeploy={() => setDeployTarget(p)} />
          ))}
        </div>
      )}

      {/* ── Coming-soon roadmap ── */}
      {comingSoon.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <Ico d={P.clock} size={14} color="#94A3B8" />
            <p style={{ fontSize: 12, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              On the Roadmap
            </p>
            <div style={{ flex: 1, height: 1, background: "rgba(15,23,42,0.06)" }} />
            <span style={{ fontSize: 11, color: "#CBD5E1", fontWeight: 600 }}>{comingSoon.length} pots planned</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {comingSoon.map(p => (
              <ComingSoonCard key={p.id} pot={p} />
            ))}
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        {data?.last_updated && (
          <p style={{ fontSize: 11.5, color: "#CBD5E1" }}>Catalogue last synced {data.last_updated}</p>
        )}
        <a
          href="https://github.com/H0neyBe/honeybee_potstore"
          target="_blank" rel="noreferrer"
          style={{ fontSize: 11.5, color: "#CBD5E1", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#94A3B8"}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#CBD5E1"}
        >
          <Ico d={P.link} size={11} color="#CBD5E1" />
          github.com/H0neyBe/honeybee_potstore
        </a>
      </div>
    </div>
  );
}
