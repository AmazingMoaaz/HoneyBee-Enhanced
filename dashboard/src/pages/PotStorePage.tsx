import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";
import { useAuthStore } from "../stores/auth";
import { Icons, potIconPath } from "../components/Icons";

/* ── SVG Icon helper ─────────────────────────────── */
const Ico = ({ d, size = 20, color = "currentColor", sw = 2 }: { d: string; size?: number; color?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/* ── SVG paths (page-local shortcuts) ────────────── */
const P = {
  sync:    Icons.refresh,
  search:  Icons.search,
  deploy:  Icons.deploy,
  check:   Icons.check,
  close:   Icons.close,
  arrow:   Icons.arrow,
  link:    Icons.link,
  clock:   Icons.clock,
  warn:    Icons.warn,
  shield:  Icons.shield,
  event:   Icons.bolt,
  hash:    Icons.hash,
  honey:   Icons.honeypot,
};

/* ── Static enrichment from README ──────────────────
   Fills in rich data the API catalogue doesn't include:
   emoji, default ports, use-cases, event types.       */
type PotStatic = {
  icon: string;
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
    icon: Icons.cow,
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
    icon: Icons.wand,
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
    icon: Icons.spider,
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

/* Coming-soon enrichment (icon + colour + protocol summary) */
const COMING_SOON_META: Record<string, { icon: string; color: string; protocols: string }> = {
  dionaea:    { icon: Icons.fire,      color: "#EF4444", protocols: "FTP · HTTP · SMB · MySQL" },
  heralding:  { icon: Icons.megaphone, color: "#F97316", protocols: "SSH · FTP · HTTP · SMTP · Telnet · VNC" },
  elasticpot: { icon: Icons.searchPot, color: "#06B6D4", protocols: "HTTP (Elasticsearch)" },
  mailoney:   { icon: Icons.mail,      color: "#22C55E", protocols: "SMTP" },
  glastopf:   { icon: Icons.web,       color: "#8B5CF6", protocols: "HTTP · HTTPS" },
  kippo:      { icon: Icons.lock,      color: "#64748B", protocols: "SSH (legacy)" },
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
  icon: Icons.honeypot,
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
  const [success, setSuccess] = useState<{ nodeName: string; potID?: string } | null>(null);

  const { data: nodesData, isLoading: nodesLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
  });
  const nodes: any[] = nodesData ?? [];
  const online       = nodes.filter(n => n.online);

  // Predict next sequential ID for selected node (best-effort client-side).
  const selectedNode = nodes.find(n => String(n.id) === String(nodeId));

  const deploy = useMutation({
    mutationFn: async () =>
      (await api.post(`/nodes/${nodeId}/deployments`, {
        honeypot_type: pot.id, auto_start: true, config: {},
      })).data,
    onSuccess: (res) => {
      const node = nodes.find(n => String(n.id) === String(nodeId));
      setSuccess({ nodeName: node?.name ?? "node", potID: res?.pot_id });
    },
  });

  return createPortal(
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(15,23,42,0.62)", backdropFilter: "blur(8px)", padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#FFFFFF", borderRadius: 22, width: "100%", maxWidth: 500,
        boxShadow: "0 40px 100px rgba(15,23,42,0.32), 0 0 0 1px rgba(15,23,42,0.06)",
        overflow: "hidden", animation: "fade-up 0.28s cubic-bezier(.2,.8,.2,1) both",
      }}>
        {/* Accent stripe */}
        <div style={{ height: 4, background: `linear-gradient(90deg, ${meta.color} 0%, ${meta.color}88 100%)` }} />

        {/* Header */}
        <div style={{
          padding: "18px 22px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: `linear-gradient(135deg, ${meta.bg} 0%, rgba(255,255,255,0) 80%)`,
          borderBottom: "1px solid rgba(15,23,42,0.07)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#FFFFFF",
              boxShadow: `0 0 0 2px ${meta.border}, 0 6px 18px ${meta.bg}`,
            }}>
              <Ico d={meta.icon} size={26} color={meta.color} sw={1.8} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 900, color: "#0F172A", letterSpacing: "-0.02em" }}>Deploy {pot.name}</p>
              <p style={{ fontSize: 11.5, color: meta.textColor, fontWeight: 600, marginTop: 1 }}>{meta.label}</p>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 32, height: 32, borderRadius: 9, border: "1px solid rgba(15,23,42,0.08)",
            background: "#F8FAFC", cursor: "pointer", display: "grid", placeItems: "center",
            color: "#94A3B8",
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F1F5F9"; (e.currentTarget as HTMLElement).style.color = "#475569"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F8FAFC"; (e.currentTarget as HTMLElement).style.color = "#94A3B8"; }}
          >
            <Ico d={P.close} size={15} color="currentColor" />
          </button>
        </div>

        <div style={{ padding: "22px" }}>
          {success ? (
            /* ── Success state ── */
            <div style={{ textAlign: "center", padding: "12px 0 8px" }}>
              <div style={{
                width: 64, height: 64, borderRadius: "50%",
                background: "linear-gradient(135deg, rgba(34,197,94,0.15), rgba(34,197,94,0.06))",
                border: "2px solid rgba(34,197,94,0.35)",
                display: "grid", placeItems: "center", margin: "0 auto 16px",
              }}>
                <Ico d={P.check} size={30} color="#15803D" sw={2.5} />
              </div>
              <p style={{ fontSize: 17, fontWeight: 900, color: "#0F172A", marginBottom: 8, letterSpacing: "-0.02em" }}>
                Deployment queued!
              </p>
              <p style={{ fontSize: 13.5, color: "#64748B", marginBottom: 6, lineHeight: 1.65, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                <Ico d={meta.icon} size={16} color={meta.color} />
                <strong>{pot.name}</strong> is being installed on{" "}
                <strong>{success.nodeName}</strong>.
              </p>
              {success.potID && (
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px",
                  borderRadius: 8, background: meta.bg, border: `1px solid ${meta.border}`,
                  marginBottom: 20, fontSize: 13, fontWeight: 700, color: meta.textColor,
                }}>
                  <span style={{ fontSize: 11, opacity: 0.65, fontWeight: 600 }}>Instance</span>
                  <code style={{ fontFamily: "ui-monospace, monospace", color: meta.color }}>{success.potID}</code>
                </div>
              )}
              {!success.potID && <div style={{ marginBottom: 20 }} />}
              <p style={{ fontSize: 12, color: "#94A3B8", marginBottom: 22 }}>
                Track live logs in Node Manager →
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <a href={`/nodes/${nodeId}`} style={{
                  padding: "10px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700,
                  background: "linear-gradient(135deg,#FCD34D,#D97706)", color: "#1C0A00",
                  textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
                  boxShadow: "0 4px 14px rgba(245,158,11,0.35)",
                }}>
                  View Node <Ico d={P.arrow} size={13} color="#1C0A00" />
                </a>
                <button onClick={onClose} style={{
                  padding: "10px 20px", borderRadius: 10, fontSize: 13.5, fontWeight: 700,
                  background: "#F8FAFC", border: "1.5px solid rgba(15,23,42,0.12)",
                  color: "#64748B", cursor: "pointer",
                }}>Close</button>
              </div>
            </div>
          ) : (
            <>
              {/* Quick-facts: ports */}
              {Object.keys(meta.defaultPorts).length > 0 && (
                <div style={{
                  padding: "12px 16px", borderRadius: 12, marginBottom: 20,
                  background: meta.bg, border: `1px solid ${meta.border}`,
                  display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center",
                }}>
                  {Object.entries(meta.defaultPorts).map(([proto, port]) => (
                    <div key={proto} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: meta.textColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        {proto}
                      </span>
                      <span style={{ fontSize: 18, fontWeight: 900, color: meta.color, fontFamily: "monospace" }}>{port}</span>
                    </div>
                  ))}
                  <div style={{ width: 1, height: 24, background: meta.border, flexShrink: 0 }} />
                  <p style={{ fontSize: 11.5, color: meta.textColor, opacity: 0.85 }}>Default ports — overridable</p>
                </div>
              )}

              {/* Node select */}
              <div style={{ marginBottom: 18 }}>
                <label style={{
                  fontSize: 11, fontWeight: 700, color: "#64748B", display: "block",
                  marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.09em",
                }}>
                  Target Node <span style={{ color: "#EF4444" }}>*</span>
                </label>
                {nodesLoading ? (
                  <div style={{
                    padding: "12px 14px", borderRadius: 10, background: "#F8FAFC",
                    border: "1.5px solid rgba(15,23,42,0.08)", color: "#94A3B8", fontSize: 13,
                  }}>
                    Loading nodes…
                  </div>
                ) : online.length === 0 ? (
                  <div style={{
                    padding: "14px 16px", borderRadius: 10, fontSize: 13,
                    background: "rgba(239,68,68,0.06)", border: "1.5px solid rgba(239,68,68,0.2)",
                    color: "#DC2626", display: "flex", gap: 9, alignItems: "center",
                  }}>
                    <Ico d={P.warn} size={16} color="#DC2626" />
                    <span>No online nodes — <strong>start a node first</strong> to deploy.</span>
                  </div>
                ) : (
                  <select value={nodeId} onChange={e => setNodeId(e.target.value)} className="input">
                    <option value="">— Select a node —</option>
                    {online.map((n: any) => (
                      <option key={n.id} value={n.id}>{n.name}</option>
                    ))}
                  </select>
                )}
                {online.length > 0 && (
                  <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 5 }}>
                    {online.length} online · {nodes.length - online.length} offline
                    {selectedNode && <> · deploying to <strong style={{ color: "#475569" }}>{selectedNode.name}</strong></>}
                  </p>
                )}
              </div>

              {/* Instance ID — auto-assigned */}
              <div style={{ marginBottom: 22 }}>
                <label style={{
                  fontSize: 11, fontWeight: 700, color: "#64748B", display: "block",
                  marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.09em",
                }}>
                  Instance ID
                </label>
                <div style={{
                  padding: "13px 16px", borderRadius: 11,
                  background: "linear-gradient(135deg, rgba(252,211,77,0.14), rgba(245,158,11,0.04))",
                  border: "1.5px solid rgba(245,158,11,0.28)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Ico d={P.hash} size={18} color="#B45309" />
                    <div>
                      <p style={{ fontSize: 10, fontWeight: 700, color: "#92400E", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        Auto-assigned
                      </p>
                      <p style={{ fontSize: 13, color: "#64748B", fontFamily: "ui-monospace, monospace" }}>
                        <span style={{ color: "#B45309", fontWeight: 700 }}>{pot.id}</span>
                        <span style={{ color: "#94A3B8" }}>-1, -{pot.id}-2, …</span>
                      </p>
                    </div>
                  </div>
                  <span style={{
                    padding: "3px 10px", borderRadius: 99, fontSize: 10.5, fontWeight: 700,
                    background: "rgba(245,158,11,0.15)", color: "#92400E",
                    border: "1px solid rgba(245,158,11,0.3)",
                  }}>per node</span>
                </div>
                <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 5, lineHeight: 1.5 }}>
                  Sequential — no two {pot.name} instances share an ID on the same node.
                </p>
              </div>

              {deploy.isError && (
                <div style={{
                  padding: "11px 15px", borderRadius: 10, marginBottom: 18, fontSize: 13,
                  background: "rgba(239,68,68,0.07)", border: "1.5px solid rgba(239,68,68,0.2)",
                  color: "#DC2626", display: "flex", gap: 8, alignItems: "flex-start",
                }}>
                  <Ico d={P.warn} size={15} color="#DC2626" />
                  Deployment failed. Verify the node is reachable and online.
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => deploy.mutate()}
                  disabled={!nodeId || deploy.isPending}
                  className="btn btn-primary"
                  style={{ flex: 1, opacity: !nodeId ? 0.45 : 1 }}
                >
                  {deploy.isPending
                    ? "Deploying…"
                    : <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico d={meta.icon} size={15} color="currentColor" /> Deploy {pot.name}</span>
                  }
                </button>
                <button onClick={onClose} className="btn btn-secondary">Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
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

        {/* Header: icon + name + badges */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 12 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
            background: meta.bg, border: `1.5px solid ${meta.border}`,
            boxShadow: `0 4px 16px ${meta.bg}`,
          }}>
            <Ico d={meta.icon} size={28} color={meta.color} sw={1.8} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <p style={{ fontWeight: 900, fontSize: 17, color: "#0F172A" }}>{pot.name}</p>
              {pot.status === "stable" && (
                <span style={{
                  padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700,
                  background: "rgba(34,197,94,0.12)", color: "#15803D", border: "1px solid rgba(34,197,94,0.3)",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}>
                  <Ico d={P.check} size={10} color="#15803D" sw={3} /> Stable {pot.version}
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
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(15,23,42,0.65)", backdropFilter: "blur(8px)", padding: 16,
          }}
          onClick={e => { if (e.target === e.currentTarget) setInfoModal(false); }}
        >
          <div style={{
            background: "#FFFFFF", borderRadius: 22, width: "100%", maxWidth: 520,
            boxShadow: "0 40px 100px rgba(15,23,42,0.32), 0 0 0 1px rgba(15,23,42,0.06)",
            overflow: "hidden", animation: "fade-up 0.26s cubic-bezier(.2,.8,.2,1) both",
            display: "flex", flexDirection: "column", maxHeight: "85vh",
          }}>
            {/* Accent stripe */}
            <div style={{ height: 4, background: `linear-gradient(90deg, ${meta.color} 0%, ${meta.color}66 100%)`, flexShrink: 0 }} />

            {/* Modal header */}
            <div style={{
              padding: "18px 22px 16px", borderBottom: "1px solid rgba(15,23,42,0.07)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: `linear-gradient(135deg, ${meta.bg} 0%, rgba(255,255,255,0) 70%)`,
              flexShrink: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                <div style={{
                  width: 50, height: 50, borderRadius: 14, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "#FFFFFF",
                  boxShadow: `0 0 0 2px ${meta.border}, 0 6px 18px ${meta.bg}`,
                }}>
                  <Ico d={meta.icon} size={26} color={meta.color} sw={1.8} />
                </div>
                <div>
                  <p style={{ fontWeight: 900, fontSize: 16, color: "#0F172A", letterSpacing: "-0.02em" }}>{pot.name}</p>
                  <p style={{ fontSize: 11.5, color: meta.textColor, fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>{meta.label}</p>
                </div>
              </div>
              <button onClick={() => setInfoModal(false)} style={{
                width: 32, height: 32, borderRadius: 9, border: "1px solid rgba(15,23,42,0.08)",
                background: "#F8FAFC", cursor: "pointer", display: "grid", placeItems: "center",
                color: "#94A3B8", flexShrink: 0,
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F1F5F9"; (e.currentTarget as HTMLElement).style.color = "#475569"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F8FAFC"; (e.currentTarget as HTMLElement).style.color = "#94A3B8"; }}
              >
                <Ico d={P.close} size={15} color="currentColor" />
              </button>
            </div>

            {/* Tab bar */}
            <div style={{
              display: "flex", borderBottom: "1px solid rgba(15,23,42,0.08)",
              padding: "0 22px", flexShrink: 0, background: "#FAFAFA",
            }}>
              {(["features","events","usecases"] as const).map(tab => {
                const TAB_META: Record<string, { label: string; count: number; icon: string }> = {
                  features: { label: "Features", count: features.length, icon: P.check },
                  events:   { label: "Events",   count: meta.eventTypes.length, icon: P.event },
                  usecases: { label: "Use Cases", count: meta.useCases.length,  icon: P.shield },
                };
                const { label, count, icon } = TAB_META[tab];
                const active = infoTab === tab;
                return (
                  <button key={tab} onClick={() => setInfoTab(tab)} style={{
                    padding: "11px 14px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
                    background: "none", border: "none",
                    borderBottom: active ? `2.5px solid ${meta.color}` : "2.5px solid transparent",
                    color: active ? meta.color : "#94A3B8",
                    marginBottom: -1, display: "flex", alignItems: "center", gap: 6,
                    transition: "color 0.15s",
                  }}>
                    <Ico d={icon} size={12} color="currentColor" sw={2.5} />
                    {label}
                    <span style={{
                      padding: "1px 6px", borderRadius: 99, fontSize: 10, fontWeight: 800,
                      background: active ? `${meta.color}20` : "rgba(148,163,184,0.12)",
                      color: active ? meta.color : "#94A3B8",
                    }}>{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Modal body */}
            <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>
              {infoTab === "features" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {features.map((f: string) => (
                    <div key={f} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "9px 12px", borderRadius: 9,
                      background: "rgba(248,250,252,0.9)", border: "1px solid rgba(15,23,42,0.06)",
                    }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                        background: `${meta.color}18`, border: `1px solid ${meta.color}40`,
                        display: "grid", placeItems: "center", marginTop: 0.5,
                      }}>
                        <Ico d={P.check} size={11} color={meta.color} sw={2.5} />
                      </div>
                      <span style={{ fontSize: 13, color: "#334155", lineHeight: 1.55 }}>{f}</span>
                    </div>
                  ))}
                </div>
              )}
              {infoTab === "events" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {meta.eventTypes.map((ev, i) => (
                    <div key={ev.id} style={{
                      padding: "12px 14px", borderRadius: 11,
                      background: "#FAFAFA", border: "1px solid rgba(15,23,42,0.07)",
                      borderLeft: `3px solid ${meta.color}`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                        <span style={{
                          padding: "2px 7px", borderRadius: 6, fontSize: 10.5, fontWeight: 700,
                          background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
                          fontFamily: "ui-monospace, monospace",
                        }}>{ev.id}</span>
                        <span style={{
                          padding: "1px 6px", borderRadius: 99, fontSize: 9.5, fontWeight: 700,
                          background: "rgba(148,163,184,0.15)", color: "#64748B",
                        }}>#{i + 1}</span>
                      </div>
                      <p style={{ fontSize: 12.5, color: "#64748B", lineHeight: 1.55 }}>{ev.desc}</p>
                    </div>
                  ))}
                </div>
              )}
              {infoTab === "usecases" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {meta.useCases.map((u, i) => (
                    <div key={u} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "9px 12px", borderRadius: 9,
                      background: "rgba(248,250,252,0.9)", border: "1px solid rgba(15,23,42,0.06)",
                    }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                        background: `${meta.color}14`, border: `1px solid ${meta.color}35`,
                        display: "grid", placeItems: "center", marginTop: 0.5,
                        fontSize: 11, fontWeight: 900, color: meta.color,
                      }}>
                        {i + 1}
                      </div>
                      <span style={{ fontSize: 13, color: "#334155", lineHeight: 1.55 }}>{u}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div style={{
              padding: "14px 22px", borderTop: "1px solid rgba(15,23,42,0.07)",
              display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end",
              background: "#FAFAFA", flexShrink: 0,
            }}>
              <a href={pot.git_url} target="_blank" rel="noreferrer" style={{
                padding: "8px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
                border: "1.5px solid rgba(15,23,42,0.1)", color: "#64748B", background: "#F8FAFC",
                textDecoration: "none", display: "flex", alignItems: "center", gap: 6,
              }}>
                <Ico d={P.link} size={13} color="#94A3B8" /> Source
              </a>
              <button
                onClick={() => { setInfoModal(false); onDeploy(); }}
                style={{
                  padding: "9px 20px", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  border: `1.5px solid ${meta.border}`,
                  background: `linear-gradient(135deg, ${meta.color}30, ${meta.color}15)`,
                  color: meta.textColor,
                  display: "flex", alignItems: "center", gap: 7,
                }}
              >
                <Ico d={P.deploy} size={13} color={meta.textColor} />
                Deploy <Ico d={meta.icon} size={13} color={meta.textColor} />
              </button>
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
            Deploy <Ico d={meta.icon} size={14} color={meta.textColor} />
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
          width: 40, height: 40, borderRadius: 11, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: cs ? `${cs.color}12` : "rgba(148,163,184,0.1)",
          border: cs ? `1.5px solid ${cs.color}44` : "1.5px solid rgba(148,163,184,0.2)",
        }}>
          <Ico d={cs?.icon ?? Icons.honeypot} size={22} color={cs?.color ?? "#94A3B8"} sw={1.8} />
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
