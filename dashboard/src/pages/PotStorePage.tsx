import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuthStore } from "../stores/auth";
import { Icons } from "../components/Icons";

/* ── SVG Icon helper ─────────────────────────────── */
const Ico = ({ d, size = 20, color = "currentColor", sw = 2 }: { d: string; size?: number; color?: string; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const P = {
  sync: Icons.refresh, search: Icons.search, deploy: Icons.deploy, check: Icons.check,
  close: Icons.close, arrow: Icons.arrow, link: Icons.link, clock: Icons.clock,
  warn: Icons.warn, shield: Icons.shield, event: Icons.bolt, hash: Icons.hash, honey: Icons.honeypot,
};

/* ── Static enrichment (icon/colour/use-cases the API doesn't carry) ── */
type PotStatic = {
  icon: string; color: string; textColor: string; bg: string; border: string; label: string;
  features: string[]; defaultPorts: Record<string, string | number>; useCases: string[];
  eventTypes: { id: string; desc: string }[];
};
const POT_STATIC: Record<string, PotStatic> = {
  cowrie: {
    icon: Icons.cow, color: "#F59E0B", textColor: "var(--accent)", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)",
    label: "SSH / Telnet — the Swiss-army knife of SSH honeypots",
    features: ["SSH honeypot — emulates OpenSSH", "Telnet honeypot — full fake service", "Command logging — every shell command", "File-download tracking — captures malware", "Session recording — full TTY playback", "Custom plugins — Python hooks", "Python 3.7+ — lightweight"],
    defaultPorts: { SSH: 2222, Telnet: 2223 },
    useCases: ["Detect SSH brute-force attacks", "Monitor credential stuffing", "Track attacker TTPs in fake shells", "Collect live malware samples", "Threat-intel research"],
    eventTypes: [
      { id: "cowrie.login.success", desc: "Successful auth — username, password, IP, timestamp" },
      { id: "cowrie.login.failed", desc: "Failed login attempt with credentials" },
      { id: "cowrie.command.input", desc: "Command executed inside the fake shell" },
      { id: "cowrie.session.file_download", desc: "Malware / payload downloaded by attacker" },
      { id: "cowrie.session.closed", desc: "Session terminated — duration and bytes" },
    ],
  },
  honnypotter: {
    icon: Icons.wand, color: "#7C3AED", textColor: "var(--violet)", bg: "rgba(124,58,237,0.1)", border: "rgba(124,58,237,0.28)",
    label: "WordPress login — silent guardian of web apps",
    features: ["WordPress emulation — wp-login.php replica", "Brute-force detection — per-IP bursts", "Credential logging — username + password", "XML-RPC support — traps multicall", "Low resource — single PHP file", "No database required", "Plugin mode — embed in real WP"],
    defaultPorts: { HTTP: 8080, HTTPS: 443 },
    useCases: ["WordPress brute-force detection", "Credential stuffing monitoring", "Web attack-surface analysis", "XML-RPC abuse detection", "Threat-intel on web actors"],
    eventTypes: [
      { id: "honnypotter.login.failed", desc: "Failed wp-login — username, password, IP" },
      { id: "honnypotter.xmlrpc.attack", desc: "XML-RPC call — method, credentials, IP" },
      { id: "honnypotter.bruteforce.detected", desc: "Burst detection — IP, attempt count, window" },
    ],
  },
  webtrap: {
    icon: Icons.spider, color: "#0EA5E9", textColor: "var(--info)", bg: "rgba(14,165,233,0.1)", border: "rgba(14,165,233,0.28)",
    label: "Web / HTTP deception traps",
    features: ["Fake admin panels & login pages", "HTTP fingerprinting — headers, UA, TLS", "Canary token & credential support", "File-upload trap — webshell capture", "Heuristic tagging — SQLi/XSS/RCE/LFI", "Session & IP tracking", "Async Python — < 50 MB RAM"],
    defaultPorts: { HTTP: 8088 },
    useCases: ["Fake admin panel capture", "REST / GraphQL abuse detection", "Webshell upload logging", "Sensitive file probing", "SQLi / XSS / RCE / LFI tagging"],
    eventTypes: [
      { id: "webtrap.request", desc: "Full HTTP request — headers, body, heuristic tags" },
      { id: "webtrap.file_upload", desc: "Webshell or file upload attempt" },
      { id: "webtrap.canary_hit", desc: "Canary credential used — source traced" },
    ],
  },
};
const META_DEFAULT: PotStatic = {
  icon: Icons.honeypot, color: "#F59E0B", textColor: "var(--accent)", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)",
  label: "Honeypot", features: [], defaultPorts: {}, useCases: [], eventTypes: [],
};

/* Category (pot.type) presentation — falls back gracefully for unknown types */
const TYPE_META: Record<string, { label: string; icon: string }> = {
  ssh: { label: "SSH / Telnet", icon: Icons.lock },
  telnet: { label: "Telnet", icon: Icons.lock },
  web: { label: "Web / HTTP", icon: Icons.web },
  http: { label: "Web / HTTP", icon: Icons.web },
  wordpress: { label: "WordPress", icon: Icons.wand },
  database: { label: "Database", icon: Icons.database },
  mail: { label: "Mail / SMTP", icon: Icons.mail },
  smtp: { label: "Mail / SMTP", icon: Icons.mail },
  ftp: { label: "FTP", icon: Icons.server },
  multi: { label: "Multi-protocol", icon: Icons.network },
  industrial: { label: "Industrial / ICS", icon: Icons.cpu },
};
const titleCase = (s: string) => (s || "other").replace(/[-_]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const typeLabel = (t?: string) => (t && TYPE_META[t]?.label) || titleCase(t || "Other");
const typeIcon = (t?: string) => (t && TYPE_META[t]?.icon) || Icons.honeypot;

const LANG_COLOR: Record<string, { bg: string; color: string }> = {
  python: { bg: "rgba(59,130,246,0.1)", color: "var(--info)" },
  php: { bg: "rgba(124,58,237,0.1)", color: "var(--violet)" },
  go: { bg: "rgba(6,182,212,0.1)", color: "var(--info)" },
  node: { bg: "rgba(34,197,94,0.1)", color: "var(--ok)" },
};

/* Coming-soon roadmap (the API does not return these) */
const COMING_SOON_META: Record<string, { icon: string; color: string; protocols: string }> = {
  dionaea: { icon: Icons.fire, color: "#EF4444", protocols: "FTP · HTTP · SMB · MySQL" },
  heralding: { icon: Icons.megaphone, color: "#F97316", protocols: "SSH · FTP · HTTP · SMTP · Telnet · VNC" },
  elasticpot: { icon: Icons.searchPot, color: "#06B6D4", protocols: "HTTP (Elasticsearch)" },
  mailoney: { icon: Icons.mail, color: "#22C55E", protocols: "SMTP" },
  glastopf: { icon: Icons.web, color: "#8B5CF6", protocols: "HTTP · HTTPS" },
  kippo: { icon: Icons.lock, color: "#94A3B8", protocols: "SSH (legacy)" },
};
const COMING_SOON = [
  { id: "dionaea", name: "Dionaea", status: "in development", description: "Multi-protocol malware-capture honeypot emulating FTP, HTTP, SMB and MySQL to trap and collect binary payloads." },
  { id: "heralding", name: "Heralding", status: "planned", description: "Multi-protocol credential honeypot capturing logins across SSH, FTP, HTTP, SMTP, Telnet and VNC in one service." },
  { id: "elasticpot", name: "Elasticpot", status: "planned", description: "Elasticsearch honeypot mimicking an unprotected cluster to lure and log search-engine-targeted scanners." },
  { id: "mailoney", name: "Mailoney", status: "planned", description: "SMTP honeypot for email-based attacks, phishing probes and open-relay abuse." },
  { id: "glastopf", name: "Glastopf", status: "planned", description: "Web-application honeypot emulating thousands of vulnerabilities to attract and classify web attacks." },
  { id: "kippo", name: "Kippo", status: "planned", description: "Classic SSH honeypot (the predecessor to Cowrie) for legacy brute-force research." },
];

/* ── Helpers on a pot entry ──────────────────────── */
const potPorts = (pot: any): Record<string, string | number> => {
  const api = pot?.default_ports;
  if (api && Object.keys(api).length) return api;
  return (POT_STATIC[pot?.id] ?? META_DEFAULT).defaultPorts;
};
const potProtocols = (pot: any): string[] => Object.keys(potPorts(pot));

/* ════════════════════════════════════════════════════════════════════
   Deploy modal
═══════════════════════════════════════════════════════════════════════ */
function DeployModal({ pot, onClose }: { pot: any; onClose: () => void }) {
  const meta = POT_STATIC[pot.id] ?? META_DEFAULT;
  const ports = potPorts(pot);
  const [nodeId, setNodeId] = useState("");
  const [success, setSuccess] = useState<{ nodeName: string; potID?: string } | null>(null);

  const { data: nodesData, isLoading: nodesLoading } = useQuery({ queryKey: ["nodes"], queryFn: async () => (await api.get("/nodes")).data });
  const nodes: any[] = nodesData ?? [];
  const online = nodes.filter(n => n.online);
  const selectedNode = nodes.find(n => String(n.id) === String(nodeId));
  const qc = useQueryClient();

  const deploy = useMutation({
    mutationFn: async () => (await api.post(`/nodes/${nodeId}/deployments`, { honeypot_type: pot.id, auto_start: true, config: {} })).data,
    onSuccess: (res) => {
      const node = nodes.find(n => String(n.id) === String(nodeId));
      setSuccess({ nodeName: node?.name ?? "node", potID: res?.pot_id });
      qc.invalidateQueries({ queryKey: ["deployments"] });
    },
  });

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal animate-fade-up" role="dialog" aria-modal="true" style={{ maxWidth: 500 }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${meta.color} 0%, ${meta.color}88 100%)` }} />
        <div style={{ padding: "18px 22px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: `linear-gradient(135deg, ${meta.bg} 0%, transparent 80%)`, borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, flexShrink: 0, display: "grid", placeItems: "center",
              background: "var(--surface)", boxShadow: `0 0 0 2px ${meta.border}, 0 6px 18px ${meta.bg}` }}>
              <Ico d={meta.icon} size={26} color={meta.color} sw={1.8} />
            </div>
            <div>
              <p style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" }}>Deploy {pot.name}</p>
              <p style={{ fontSize: 11.5, color: meta.textColor, fontWeight: 600, marginTop: 1 }}>{meta.label}</p>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn"><Ico d={P.close} size={15} color="currentColor" /></button>
        </div>

        <div style={{ padding: "22px" }}>
          {success ? (
            <div style={{ textAlign: "center", padding: "12px 0 8px" }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--ok-bg)", border: "2px solid var(--ok-border)",
                display: "grid", placeItems: "center", margin: "0 auto 16px" }}>
                <Ico d={P.check} size={30} color="var(--ok)" sw={2.5} />
              </div>
              <p style={{ fontSize: 17, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Deployment queued!</p>
              <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.65, display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
                <Ico d={meta.icon} size={16} color={meta.color} /> <strong>{pot.name}</strong> is being installed on <strong>{success.nodeName}</strong>.
              </p>
              {success.potID && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: 8,
                  background: meta.bg, border: `1px solid ${meta.border}`, marginBottom: 20, fontSize: 13, fontWeight: 700, color: meta.textColor }}>
                  <span style={{ fontSize: 11, opacity: 0.65, fontWeight: 600 }}>Instance</span>
                  <code style={{ fontFamily: "ui-monospace, monospace", color: meta.color }}>{success.potID}</code>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: success.potID ? 0 : 8 }}>
                <Link to={`/nodes/${nodeId}`} className="btn btn-primary" style={{ gap: 6 }}>View Node <Ico d={P.arrow} size={13} color="#1C0A00" /></Link>
                <button onClick={onClose} className="btn btn-secondary">Close</button>
              </div>
            </div>
          ) : (
            <>
              {Object.keys(ports).length > 0 && (
                <div style={{ padding: "12px 16px", borderRadius: 12, marginBottom: 20, background: meta.bg, border: `1px solid ${meta.border}`,
                  display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
                  {Object.entries(ports).map(([proto, port]) => (
                    <div key={proto} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: meta.textColor, textTransform: "uppercase", letterSpacing: "0.08em" }}>{proto}</span>
                      <span style={{ fontSize: 18, fontWeight: 800, color: meta.color, fontFamily: "monospace" }}>{port}</span>
                    </div>
                  ))}
                  <div style={{ width: 1, height: 24, background: meta.border, flexShrink: 0 }} />
                  <p style={{ fontSize: 11.5, color: meta.textColor, opacity: 0.85 }}>Default ports — overridable</p>
                </div>
              )}

              <div style={{ marginBottom: 18 }}>
                <label className="input-label">Target Node <span style={{ color: "var(--danger)" }}>*</span></label>
                {nodesLoading ? (
                  <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--bg-2)", border: "1.5px solid var(--border)", color: "var(--text-faint)", fontSize: 13 }}>Loading nodes…</div>
                ) : online.length === 0 ? (
                  <div style={{ padding: "14px 16px", borderRadius: 10, fontSize: 13, background: "var(--danger-bg)", border: "1.5px solid var(--danger-border)",
                    color: "var(--danger)", display: "flex", gap: 9, alignItems: "center" }}>
                    <Ico d={P.warn} size={16} color="var(--danger)" /> <span>No online nodes — <strong>start a node first</strong> to deploy.</span>
                  </div>
                ) : (
                  <select value={nodeId} onChange={e => setNodeId(e.target.value)} className="input">
                    <option value="">— Select a node —</option>
                    {online.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                )}
                {online.length > 0 && (
                  <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 5 }}>
                    {online.length} online · {nodes.length - online.length} offline
                    {selectedNode && <> · deploying to <strong style={{ color: "var(--text-muted)" }}>{selectedNode.name}</strong></>}
                  </p>
                )}
              </div>

              {deploy.isError && (
                <div style={{ padding: "11px 15px", borderRadius: 10, marginBottom: 18, fontSize: 13, background: "var(--danger-bg)",
                  border: "1.5px solid var(--danger-border)", color: "var(--danger)", display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <Ico d={P.warn} size={15} color="var(--danger)" /> Deployment failed. Verify the node is reachable and online.
                </div>
              )}

              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => deploy.mutate()} disabled={!nodeId || deploy.isPending} className="btn btn-primary" style={{ flex: 1, opacity: !nodeId ? 0.45 : 1 }}>
                  {deploy.isPending ? "Deploying…" : <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Ico d={meta.icon} size={15} color="currentColor" /> Deploy {pot.name}</span>}
                </button>
                <button onClick={onClose} className="btn btn-secondary">Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ════════════════════════════════════════════════════════════════════
   Info modal (features / events / use-cases)
═══════════════════════════════════════════════════════════════════════ */
function InfoModal({ pot, onClose, onDeploy }: { pot: any; onClose: () => void; onDeploy: () => void }) {
  const meta = POT_STATIC[pot.id] ?? META_DEFAULT;
  const [tab, setTab] = useState<"features" | "events" | "usecases">("features");
  const features: string[] = meta.features;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const TAB_META: Record<string, { label: string; count: number; icon: string }> = {
    features: { label: "Features", count: features.length, icon: P.check },
    events: { label: "Events", count: meta.eventTypes.length, icon: P.event },
    usecases: { label: "Use Cases", count: meta.useCases.length, icon: P.shield },
  };

  return createPortal(
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal animate-fade-up" role="dialog" aria-modal="true" style={{ maxWidth: 520, display: "flex", flexDirection: "column", maxHeight: "85vh" }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${meta.color} 0%, ${meta.color}66 100%)`, flexShrink: 0 }} />
        <div style={{ padding: "18px 22px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: `linear-gradient(135deg, ${meta.bg} 0%, transparent 70%)`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 50, height: 50, borderRadius: 14, flexShrink: 0, display: "grid", placeItems: "center",
              background: "var(--surface)", boxShadow: `0 0 0 2px ${meta.border}, 0 6px 18px ${meta.bg}` }}>
              <Ico d={meta.icon} size={26} color={meta.color} sw={1.8} />
            </div>
            <div>
              <p style={{ fontWeight: 800, fontSize: 16, color: "var(--text)", letterSpacing: "-0.02em" }}>{pot.name}</p>
              <p style={{ fontSize: 11.5, color: meta.textColor, fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>{meta.label}</p>
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" style={{ flexShrink: 0 }}><Ico d={P.close} size={15} color="currentColor" /></button>
        </div>

        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 22px", flexShrink: 0, background: "var(--bg-2)" }}>
          {(["features", "events", "usecases"] as const).map(t => {
            const { label, count, icon } = TAB_META[t];
            const active = tab === t;
            return (
              <button key={t} onClick={() => setTab(t)} style={{ padding: "11px 14px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: "none",
                border: "none", borderBottom: active ? `2.5px solid ${meta.color}` : "2.5px solid transparent", color: active ? meta.color : "var(--text-faint)",
                marginBottom: -1, display: "flex", alignItems: "center", gap: 6, transition: "color 0.15s" }}>
                <Ico d={icon} size={12} color="currentColor" sw={2.5} /> {label}
                <span style={{ padding: "1px 6px", borderRadius: 99, fontSize: 10, fontWeight: 800, background: active ? `${meta.color}20` : "rgba(148,163,184,0.12)", color: active ? meta.color : "var(--text-faint)" }}>{count}</span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>
          {tab === "features" && (features.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {features.map(f => (
                <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", borderRadius: 9, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, display: "grid", placeItems: "center", marginTop: 0.5 }}>
                    <Ico d={P.check} size={11} color={meta.color} sw={2.5} />
                  </div>
                  <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>{f}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize: 13, color: "var(--text-faint)" }}>No feature details listed for this honeypot.</p>)}
          {tab === "events" && (meta.eventTypes.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {meta.eventTypes.map((ev, i) => (
                <div key={ev.id} style={{ padding: "12px 14px", borderRadius: 11, background: "var(--bg-2)", border: "1px solid var(--border)", borderLeft: `3px solid ${meta.color}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ padding: "2px 7px", borderRadius: 6, fontSize: 10.5, fontWeight: 700, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`, fontFamily: "ui-monospace, monospace" }}>{ev.id}</span>
                    <span style={{ padding: "1px 6px", borderRadius: 99, fontSize: 9.5, fontWeight: 700, background: "rgba(148,163,184,0.15)", color: "var(--text-muted)" }}>#{i + 1}</span>
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>{ev.desc}</p>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize: 13, color: "var(--text-faint)" }}>Event schema not documented yet.</p>)}
          {tab === "usecases" && (meta.useCases.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {meta.useCases.map((u, i) => (
                <div key={u} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", borderRadius: 9, background: "var(--bg-2)", border: "1px solid var(--border)" }}>
                  <div style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, background: `${meta.color}14`, border: `1px solid ${meta.color}35`, display: "grid", placeItems: "center", marginTop: 0.5, fontSize: 11, fontWeight: 800, color: meta.color }}>{i + 1}</div>
                  <span style={{ fontSize: 13, color: "var(--text)", lineHeight: 1.55 }}>{u}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ fontSize: 13, color: "var(--text-faint)" }}>Use-cases not listed yet.</p>)}
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end", background: "var(--bg-2)", flexShrink: 0 }}>
          {pot.git_url && (
            <a href={pot.git_url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ gap: 6 }}><Ico d={P.link} size={13} color="var(--text-faint)" /> Source</a>
          )}
          <button onClick={() => { onClose(); onDeploy(); }} className="btn btn-primary btn-sm" style={{ gap: 7 }}>
            <Ico d={P.deploy} size={13} color="#1C0A00" /> Deploy
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ════════════════════════════════════════════════════════════════════
   Store product card
═══════════════════════════════════════════════════════════════════════ */
function StoreCard({ pot, fav, onFav, onDeploy, onInfo }: { pot: any; fav: boolean; onFav: () => void; onDeploy: () => void; onInfo: () => void }) {
  const meta = POT_STATIC[pot.id] ?? META_DEFAULT;
  const langSt = LANG_COLOR[pot.language] ?? { bg: "rgba(100,116,139,0.1)", color: "var(--text-muted)" };
  const protocols = potProtocols(pot);

  return (
    <div className="card card-hover" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* "product image" — tinted icon panel */}
      <div onClick={onInfo} title={`View ${pot.name} details`} style={{ position: "relative", height: 132, cursor: "pointer",
        display: "grid", placeItems: "center", borderBottom: "1px solid var(--border)",
        background: `linear-gradient(135deg, ${meta.bg} 0%, transparent 75%)` }}>
        <Ico d={meta.icon} size={54} color={meta.color} sw={1.6} />
        {/* category badge */}
        <span style={{ position: "absolute", top: 10, left: 10, display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 999,
          fontSize: 10.5, fontWeight: 700, background: "var(--surface)", border: `1px solid ${meta.border}`, color: meta.textColor }}>
          <Ico d={typeIcon(pot.type)} size={11} color={meta.color} /> {typeLabel(pot.type)}
        </span>
        {/* favorite */}
        <button onClick={e => { e.stopPropagation(); onFav(); }} title={fav ? "Remove from favorites" : "Add to favorites"}
          className="icon-btn" style={{ position: "absolute", top: 8, right: 8, width: 30, height: 30, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill={fav ? "var(--danger)" : "none"} stroke={fav ? "var(--danger)" : "var(--text-faint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={Icons.heart} /></svg>
        </button>
      </div>

      {/* body */}
      <div style={{ padding: "13px 15px 0", flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
          <p onClick={onInfo} style={{ fontWeight: 800, fontSize: 15, color: "var(--text)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pot.name}</p>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginBottom: 10, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {pot.description}
        </p>
        {/* protocol pills */}
        {protocols.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {protocols.slice(0, 4).map(pr => (
              <span key={pr} style={{ padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: meta.bg, color: meta.textColor, border: `1px solid ${meta.border}` }}>{pr.toUpperCase()}</span>
            ))}
          </div>
        )}
        {/* "price" line — open source + language */}
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8, paddingBottom: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 800, color: "var(--accent)" }}>Free</span>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>· open source</span>
          {pot.language && <span style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: langSt.bg, color: langSt.color, textTransform: "capitalize" }}>{pot.language}</span>}
        </div>
      </div>

      {/* CTA */}
      <div style={{ padding: "0 15px 14px", display: "flex", gap: 8 }}>
        <button onClick={onDeploy} className="btn btn-primary shine" style={{ flex: 1, gap: 7, justifyContent: "space-between", paddingLeft: 14, paddingRight: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><Ico d={P.deploy} size={14} color="#1C0A00" /> Deploy</span>
          <Ico d={P.arrow} size={14} color="#1C0A00" />
        </button>
        <button onClick={onInfo} className="icon-btn" title="Details" style={{ border: "1px solid var(--border-2)", width: 38, height: 38 }}>
          <Ico d={Icons.info} size={15} color="var(--text-muted)" />
        </button>
      </div>
    </div>
  );
}

/* ── Coming-soon card ────────────────────────────── */
function ComingSoonCard({ pot }: { pot: any }) {
  const cs = COMING_SOON_META[pot.id];
  return (
    <div className="card" style={{ padding: "16px 18px", opacity: 0.92 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: "grid", placeItems: "center",
          background: cs ? `${cs.color}12` : "rgba(148,163,184,0.1)", border: cs ? `1.5px solid ${cs.color}44` : "1.5px solid rgba(148,163,184,0.2)" }}>
          <Ico d={cs?.icon ?? Icons.honeypot} size={22} color={cs?.color ?? "var(--text-faint)"} sw={1.8} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <p style={{ fontWeight: 700, fontSize: 14, color: "var(--text-muted)" }}>{pot.name}</p>
            <span style={{ padding: "1px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: "var(--warn-bg)", color: "var(--accent)", border: "1px solid var(--warn-border)", textTransform: "capitalize" }}>{pot.status}</span>
          </div>
          {cs?.protocols && <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2, fontWeight: 600 }}>{cs.protocols}</p>}
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--text-faint)", lineHeight: 1.55 }}>{pot.description}</p>
    </div>
  );
}

/* ── Sidebar facet group (checkbox list) ─────────── */
function FacetGroup({ title, options, selected, onToggle }: { title: string; options: { key: string; label: string; count: number }[]; selected: Set<string>; onToggle: (k: string) => void }) {
  if (options.length === 0) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <p style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", marginBottom: 9 }}>{title}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {options.map(o => {
          const on = selected.has(o.key);
          return (
            <label key={o.key} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "4px 6px", borderRadius: 8 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-2)"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
              <input type="checkbox" checked={on} onChange={() => onToggle(o.key)} style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: on ? "var(--text)" : "var(--text-muted)", fontWeight: on ? 700 : 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
              <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{o.count}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
   Page
═══════════════════════════════════════════════════════════════════════ */
type Sort = "recommended" | "az" | "za" | "protocols";
const SORTS: { key: Sort; label: string }[] = [
  { key: "recommended", label: "Recommended" },
  { key: "az", label: "Name (A–Z)" },
  { key: "za", label: "Name (Z–A)" },
  { key: "protocols", label: "Most protocols" },
];

export default function PotStorePage() {
  const role = useAuthStore(s => s.role);
  const qc = useQueryClient();
  const [deployTarget, setDeployTarget] = useState<any | null>(null);
  const [infoTarget, setInfoTarget] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("recommended");
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [langs, setLangs] = useState<Set<string>>(new Set());
  const [protos, setProtos] = useState<Set<string>>(new Set());
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("hb-pot-favs") || "[]")); } catch { return new Set(); }
  });
  useEffect(() => { localStorage.setItem("hb-pot-favs", JSON.stringify([...favorites])); }, [favorites]);

  const { data, isLoading } = useQuery({ queryKey: ["potstore"], queryFn: async () => (await api.get("/potstore")).data, staleTime: 60_000 });
  const sync = useMutation({ mutationFn: async () => (await api.post("/potstore/sync")).data, onSuccess: () => qc.invalidateQueries({ queryKey: ["potstore"] }) });

  const pots: any[] = data?.pots ?? [];

  /* facets */
  const facet = (keyOf: (p: any) => string[]) => {
    const m = new Map<string, number>();
    pots.forEach(p => keyOf(p).forEach(k => { if (k) m.set(k, (m.get(k) ?? 0) + 1); }));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const catFacet = useMemo(() => facet(p => [p.type || "other"]).map(([k, c]) => ({ key: k, label: typeLabel(k), count: c })), [pots]);
  const langFacet = useMemo(() => facet(p => [p.language]).map(([k, c]) => ({ key: k, label: titleCase(k), count: c })), [pots]);
  const protoFacet = useMemo(() => facet(p => potProtocols(p).map(x => x.toLowerCase())).map(([k, c]) => ({ key: k, label: k.toUpperCase(), count: c })), [pots]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); setter(n);
  };
  const toggleFav = (id: string) => setFavorites(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const anyFilter = !!search.trim() || cats.size > 0 || langs.size > 0 || protos.size > 0 || favOnly;
  const clearAll = () => { setSearch(""); setCats(new Set()); setLangs(new Set()); setProtos(new Set()); setFavOnly(false); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = pots.filter(p => {
      if (favOnly && !favorites.has(p.id)) return false;
      if (cats.size && !cats.has(p.type || "other")) return false;
      if (langs.size && !langs.has(p.language)) return false;
      if (protos.size && !potProtocols(p).some(pr => protos.has(pr.toLowerCase()))) return false;
      if (q && !(p.name.toLowerCase().includes(q) || (p.id || "").toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q) || potProtocols(p).some(pr => pr.toLowerCase().includes(q)))) return false;
      return true;
    });
    list = [...list];
    if (sort === "az") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "za") list.sort((a, b) => b.name.localeCompare(a.name));
    else if (sort === "protocols") list.sort((a, b) => potProtocols(b).length - potProtocols(a).length);
    else list.sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || a.name.localeCompare(b.name));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pots, search, cats, langs, protos, favOnly, sort, favorites]);

  return (
    <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {deployTarget && <DeployModal pot={deployTarget} onClose={() => setDeployTarget(null)} />}
      {infoTarget && <InfoModal pot={infoTarget} onClose={() => setInfoTarget(null)} onDeploy={() => setDeployTarget(infoTarget)} />}

      {/* header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="page-label">Honeypot Catalogue</p>
          <h1 className="page-title">HoneyBee Store</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 5, maxWidth: 560, lineHeight: 1.65 }}>
            Browse and deploy production-ready honeypots — pre-configured, battle-tested, one click to live. The App Store for honeypots.
          </p>
        </div>
        {role === "admin" && (
          <button className="btn btn-secondary" disabled={sync.isPending} onClick={() => sync.mutate()} style={{ gap: 7 }}>
            <Ico d={P.sync} size={14} color="var(--text-muted)" /> {sync.isPending ? "Syncing…" : "Sync Catalogue"}
          </button>
        )}
      </div>

      {/* body: sidebar + grid */}
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>
        {/* ── Filter sidebar ── */}
        <aside className="hidden lg:block" style={{ width: 230, flexShrink: 0, position: "sticky", top: 80 }}>
          <div className="card" style={{ padding: "16px 16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.09em" }}>Filters</span>
              {anyFilter && (
                <button onClick={clearAll} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}>Clear all</button>
              )}
            </div>

            {/* Sort */}
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)", marginBottom: 9 }}>Sort By</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {SORTS.map(s => (
                  <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "4px 6px", borderRadius: 8 }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-2)"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}>
                    <input type="radio" name="potsort" checked={sort === s.key} onChange={() => setSort(s.key)} style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }} />
                    <span style={{ fontSize: 12.5, color: sort === s.key ? "var(--text)" : "var(--text-muted)", fontWeight: sort === s.key ? 700 : 500 }}>{s.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Favorites */}
            <div style={{ marginTop: 18 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", padding: "4px 6px", borderRadius: 8 }}>
                <input type="checkbox" checked={favOnly} onChange={e => setFavOnly(e.target.checked)} style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }} />
                <span style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--danger)" stroke="var(--danger)" strokeWidth="2"><path d={Icons.heart} /></svg> Favorites only
                </span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{favorites.size}</span>
              </label>
            </div>

            <FacetGroup title="Category" options={catFacet} selected={cats} onToggle={k => toggle(cats, setCats, k)} />
            <FacetGroup title="Protocol" options={protoFacet} selected={protos} onToggle={k => toggle(protos, setProtos, k)} />
            <FacetGroup title="Language" options={langFacet} selected={langs} onToggle={k => toggle(langs, setLangs, k)} />
          </div>
        </aside>

        {/* ── Main column ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* toolbar: search + count + mobile sort */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: 200 }}>
              <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <Ico d={P.search} size={15} color="var(--text-faint)" />
              </div>
              <input className="input" placeholder="Search honeypots…" value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 38, width: "100%", boxSizing: "border-box" }} />
            </div>
            <select className="input lg:hidden" value={sort} onChange={e => setSort(e.target.value as Sort)} style={{ width: 170 }}>
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <span style={{ fontSize: 12.5, color: "var(--text-faint)", fontWeight: 600, marginLeft: "auto", whiteSpace: "nowrap" }}>
              {filtered.length} of {pots.length} honeypot{pots.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* grid */}
          {isLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} className="card" style={{ padding: 0, overflow: "hidden" }}>
                  <div className="skeleton" style={{ height: 132, borderRadius: 0 }} />
                  <div style={{ padding: 15, display: "flex", flexDirection: "column", gap: 8 }}>
                    <div className="skeleton" style={{ height: 14, width: "60%" }} />
                    <div className="skeleton" style={{ height: 10, width: "90%" }} />
                    <div className="skeleton" style={{ height: 32, marginTop: 8 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            pots.length === 0 && !anyFilter ? (
              <div className="card empty-state">
                <div className="empty-icon"><Ico d={P.honey} size={26} color="var(--text-faint)" /></div>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Catalogue is empty</p>
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>No honeypots are available yet{role === "admin" ? " — sync to pull the latest catalogue." : "."}</p>
                {role === "admin" && <button onClick={() => sync.mutate()} disabled={sync.isPending} className="btn btn-secondary btn-sm" style={{ marginTop: 4, gap: 6 }}><Ico d={P.sync} size={13} color="var(--text-muted)" /> {sync.isPending ? "Syncing…" : "Sync catalogue"}</button>}
              </div>
            ) : (
              <div className="card empty-state">
                <div className="empty-icon"><Ico d={P.search} size={26} color="var(--text-faint)" /></div>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>No honeypots match your filters</p>
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Try clearing filters or a different search.</p>
                {anyFilter && <button onClick={clearAll} className="btn btn-secondary btn-sm" style={{ marginTop: 4 }}>Clear all filters</button>}
              </div>
            )
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
              {filtered.map(p => (
                <StoreCard key={p.id} pot={p} fav={favorites.has(p.id)} onFav={() => toggleFav(p.id)} onDeploy={() => setDeployTarget(p)} onInfo={() => setInfoTarget(p)} />
              ))}
            </div>
          )}

          {/* coming soon */}
          {!favOnly && (
            <div style={{ marginTop: 26 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <Ico d={P.clock} size={14} color="var(--text-faint)" />
                <p style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.07em" }}>On the Roadmap</p>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 600 }}>{COMING_SOON.length} planned</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                {COMING_SOON.map(p => <ComingSoonCard key={p.id} pot={p} />)}
              </div>
            </div>
          )}

          {/* footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 22 }}>
            {data?.last_updated && <p style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Catalogue last synced {new Date(data.last_updated).toLocaleString()}</p>}
            <a href="https://github.com/H0neyBe/honeybee_potstore" target="_blank" rel="noreferrer"
              style={{ fontSize: 11.5, color: "var(--text-faint)", display: "flex", alignItems: "center", gap: 4, textDecoration: "none" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "var(--text-faint)"}>
              <Ico d={P.link} size={11} color="var(--text-faint)" /> github.com/H0neyBe/honeybee_potstore
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
