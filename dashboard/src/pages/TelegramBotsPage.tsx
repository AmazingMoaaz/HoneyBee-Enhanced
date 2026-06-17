import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";
import { useAuthStore } from "../stores/auth";
import { Icon, Icons } from "../components/Icons";

/* ── Types (mirror the Go models) ─────────────────────────── */
interface SubscriptionConfig {
  events: { enabled: boolean; honeypot_types: string[]; node_ids: number[]; event_types: string[] };
  alerts: { enabled: boolean; min_severity: string };
  node_status: { enabled: boolean; online: boolean; offline: boolean };
  deployments: { enabled: boolean; statuses: string[] };
  audit: { enabled: boolean; actions: string[] };
}
interface TelegramBot {
  id: number; name: string; chat_id: string; enabled: boolean; has_token: boolean;
  config: SubscriptionConfig; msg_format: string; throttle_secs: number; last_sent_at: string | null;
}

const emptyConfig = (): SubscriptionConfig => ({
  events: { enabled: false, honeypot_types: [], node_ids: [], event_types: [] },
  alerts: { enabled: false, min_severity: "medium" },
  node_status: { enabled: false, online: true, offline: true },
  deployments: { enabled: false, statuses: [] },
  audit: { enabled: false, actions: [] },
});

const SEVERITIES = ["info", "low", "medium", "high", "critical"];
const DEPLOY_STATUSES = ["installing", "running", "failed", "stopped", "removed"];
const COMMON_AUDIT = ["create", "delete", "uninstall", "regenerate-token", "deploy", "user-create", "user-delete", "role-update", "telegram-bot.create"];

/* ═══════════════════════════════════════════ small UI atoms */
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{ flexShrink: 0, cursor: "pointer" }} />
  );
}

function MultiChips({ options, selected, onToggle }: { options: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void }) {
  if (options.length === 0) return <p style={{ fontSize: 12, color: "var(--text-faint)" }}>No options available.</p>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {options.map(o => {
        const on = selected.includes(o.value);
        return (
          <button key={o.value} type="button" onClick={() => onToggle(o.value)} style={{
            padding: "4px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: "pointer", border: "1.5px solid",
            background: on ? "var(--warn-bg)" : "var(--surface)", color: on ? "var(--accent)" : "var(--text-muted)",
            borderColor: on ? "var(--warn-border)" : "var(--border-2)",
          }}>{on ? "✓ " : ""}{o.label}</button>
        );
      })}
    </div>
  );
}

function TagInput({ values, onChange, placeholder, suggestions }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (v: string) => { const t = v.trim().toLowerCase(); if (t && !values.includes(t)) onChange([...values, t]); setDraft(""); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {values.map(v => (
            <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "var(--warn-bg)", color: "var(--accent)", border: "1px solid var(--warn-border)" }}>
              {v}
              <button type="button" onClick={() => onChange(values.filter(x => x !== v))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", display: "grid" }}><Icon d={Icons.close} size={10} color="var(--accent)" /></button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" value={draft} placeholder={placeholder} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }} style={{ flex: 1 }} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => add(draft)} disabled={!draft.trim()}>Add</button>
      </div>
      {suggestions && suggestions.filter(s => !values.includes(s)).length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {suggestions.filter(s => !values.includes(s)).slice(0, 8).map(s => (
            <button key={s} type="button" onClick={() => add(s)} style={{ padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 600, cursor: "pointer", background: "var(--bg-2)", border: "1px dashed var(--border-2)", color: "var(--text-faint)" }}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ icon, color, title, desc, on, onToggle, children }: { icon: string; color: string; title: string; desc: string; on: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="card-sub" style={{ padding: "12px 14px", borderColor: on ? "var(--warn-border)" : "var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <div style={{ width: 32, height: 32, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0, background: `${color}1A`, color }}>
          <Icon d={icon} size={16} color={color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)" }}>{title}</p>
          <p style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{desc}</p>
        </div>
        <Switch on={on} onChange={onToggle} />
      </div>
      {on && children && <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="input-label">{label}</label>{children}</div>;
}

/* ═══════════════════════════════════════════ create / edit modal */
function BotModal({ bot, nodes, potTypes, onClose, onSave, pending, error }: {
  bot: TelegramBot | null; nodes: any[]; potTypes: string[];
  onClose: () => void; onSave: (p: any) => void; pending: boolean; error: string | null;
}) {
  const [name, setName] = useState(bot?.name ?? "");
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState(bot?.chat_id ?? "");
  const [enabled, setEnabled] = useState(bot?.enabled ?? true);
  const [throttle, setThrottle] = useState(bot?.throttle_secs ?? 0);
  // Deep-clone so the editor never aliases the react-query cache object.
  const [cfg, setCfg] = useState<SubscriptionConfig>(() => (bot?.config ? structuredClone(bot.config) : emptyConfig()));

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // immutable-ish updates into the nested config
  const set = (patch: Partial<SubscriptionConfig>) => setCfg(c => ({ ...c, ...patch }));
  const arrToggle = (arr: string[], v: string) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const nodeIdsStr = cfg.events.node_ids.map(String);
  const valid = name.trim() && chatId.trim() && (bot ? true : token.trim());

  const save = () => onSave({
    name: name.trim(), bot_token: token.trim(), chat_id: chatId.trim(), enabled,
    throttle_secs: Number(throttle) || 0, msg_format: "text", config: cfg,
  });

  return createPortal(
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal animate-fade-up" role="dialog" aria-modal="true" style={{ maxWidth: 560, display: "flex", flexDirection: "column", maxHeight: "90vh" }}>
        <div className="card-header" style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--info-bg)" }}>
              <Icon d={Icons.send} size={17} color="var(--info)" />
            </div>
            <p className="section-title">{bot ? "Edit bot" : "New Telegram bot"}</p>
          </div>
          <button className="icon-btn" onClick={onClose}><Icon d={Icons.close} size={15} /></button>
        </div>

        <div style={{ padding: "16px 20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div className="badge badge-error" style={{ width: "100%", justifyContent: "flex-start", padding: "8px 12px" }}>
              <Icon d={Icons.warn} size={14} /> {error}
            </div>
          )}

          {/* Connection */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Field label="Bot name"><input className="input" value={name} placeholder="e.g. SOC Alerts" onChange={e => setName(e.target.value)} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label={bot?.has_token ? "Bot token (leave blank to keep)" : "Bot token"}>
                <input className="input" type="password" value={token} placeholder={bot?.has_token ? "•••••••• stored" : "123456:ABC-DEF…"} onChange={e => setToken(e.target.value)} />
              </Field>
              <Field label="Chat / channel ID"><input className="input" value={chatId} placeholder="-1001234567890" onChange={e => setChatId(e.target.value)} /></Field>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <Field label="Throttle (sec, per signal)"><input className="input" type="number" min={0} value={throttle} onChange={e => setThrottle(Number(e.target.value))} style={{ width: 160 }} /></Field>
              <label style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", marginTop: 18 }}>
                <Switch on={enabled} onChange={setEnabled} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Enabled</span>
              </label>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", lineHeight: 1.6, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
              <strong style={{ color: "var(--text-muted)" }}>Getting "chat not found"?</strong> Telegram only lets a bot message chats it belongs to:
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                <li><strong>This</strong> bot (the token above) must be added to the chat — not the bot you used to read the ID.</li>
                <li>For a direct message, open your bot and press <strong>Start</strong> first, then use your own user ID.</li>
                <li>For a group/channel, add the bot as a member; supergroups use a <code style={{ fontFamily: "ui-monospace,monospace" }}>-100…</code> ID.</li>
              </ul>
            </div>
          </div>

          <div style={{ height: 1, background: "var(--border)" }} />
          <p style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Notify me about…</p>

          {/* Events */}
          <Section icon={Icons.bolt} color="#EF4444" title="Attacker events" desc="Live interactions captured by honeypots"
            on={cfg.events.enabled} onToggle={v => set({ events: { ...cfg.events, enabled: v } })}>
            <Field label="Honeypot types (empty = all)">
              <MultiChips options={potTypes.map(t => ({ value: t, label: t }))} selected={cfg.events.honeypot_types}
                onToggle={v => set({ events: { ...cfg.events, honeypot_types: arrToggle(cfg.events.honeypot_types, v) } })} />
            </Field>
            <Field label="Nodes (empty = all)">
              <MultiChips options={nodes.map(n => ({ value: String(n.id), label: n.name }))} selected={nodeIdsStr}
                onToggle={v => { const next = arrToggle(nodeIdsStr, v).map(Number); set({ events: { ...cfg.events, node_ids: next } }); }} />
            </Field>
            <Field label="Event types (empty = all)">
              <TagInput values={cfg.events.event_types} placeholder="e.g. cowrie.login.success" onChange={v => set({ events: { ...cfg.events, event_types: v } })} />
            </Field>
          </Section>

          {/* Alerts */}
          <Section icon={Icons.bell} color="#F59E0B" title="Security alerts" desc="Triggered alerts at or above a severity"
            on={cfg.alerts.enabled} onToggle={v => set({ alerts: { ...cfg.alerts, enabled: v } })}>
            <Field label="Minimum severity">
              <select className="input" value={cfg.alerts.min_severity} onChange={e => set({ alerts: { ...cfg.alerts, min_severity: e.target.value } })} style={{ maxWidth: 200 }}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)} and above</option>)}
              </select>
            </Field>
          </Section>

          {/* Node status */}
          <Section icon={Icons.server} color="#22C55E" title="Node status" desc="When nodes connect or drop"
            on={cfg.node_status.enabled} onToggle={v => set({ node_status: { ...cfg.node_status, enabled: v } })}>
            <div style={{ display: "flex", gap: 18 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
                <input type="checkbox" checked={cfg.node_status.online} onChange={e => set({ node_status: { ...cfg.node_status, online: e.target.checked } })} style={{ width: 15, height: 15, accentColor: "var(--ok)" }} /> Online 🟢
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "var(--text)" }}>
                <input type="checkbox" checked={cfg.node_status.offline} onChange={e => set({ node_status: { ...cfg.node_status, offline: e.target.checked } })} style={{ width: 15, height: 15, accentColor: "var(--danger)" }} /> Offline 🔴
              </label>
            </div>
          </Section>

          {/* Deployments */}
          <Section icon={Icons.deploy} color="#7C3AED" title="Deployments" desc="Honeypot deployment status changes"
            on={cfg.deployments.enabled} onToggle={v => set({ deployments: { ...cfg.deployments, enabled: v } })}>
            <Field label="Statuses (empty = all)">
              <MultiChips options={DEPLOY_STATUSES.map(s => ({ value: s, label: s }))} selected={cfg.deployments.statuses}
                onToggle={v => set({ deployments: { ...cfg.deployments, statuses: arrToggle(cfg.deployments.statuses, v) } })} />
            </Field>
          </Section>

          {/* Audit */}
          <Section icon={Icons.shield} color="#0EA5E9" title="Audit / security actions" desc="Privileged actions recorded in the audit log"
            on={cfg.audit.enabled} onToggle={v => set({ audit: { ...cfg.audit, enabled: v } })}>
            <Field label="Actions (empty = all)">
              <TagInput values={cfg.audit.actions} placeholder="e.g. delete" suggestions={COMMON_AUDIT} onChange={v => set({ audit: { ...cfg.audit, actions: v } })} />
            </Field>
          </Section>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={!valid || pending}>{pending ? "Saving…" : bot ? "Save changes" : "Create bot"}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ═══════════════════════════════════════════ bot card */
function summaryChips(c: SubscriptionConfig): { label: string; color: string }[] {
  const out: { label: string; color: string }[] = [];
  if (c.events.enabled) out.push({ label: "Events", color: "#EF4444" });
  if (c.alerts.enabled) out.push({ label: `Alerts ≥${c.alerts.min_severity}`, color: "#F59E0B" });
  if (c.node_status.enabled) out.push({ label: "Nodes", color: "#22C55E" });
  if (c.deployments.enabled) out.push({ label: "Deploys", color: "#7C3AED" });
  if (c.audit.enabled) out.push({ label: "Audit", color: "#0EA5E9" });
  return out;
}

function BotCard({ bot, onEdit, onDelete, onToggle, onTest, testing }: {
  bot: TelegramBot; onEdit: () => void; onDelete: () => void; onToggle: (v: boolean) => void; onTest: () => void; testing: boolean;
}) {
  const chips = summaryChips(bot.config);
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", display: "flex", flexDirection: "column", opacity: bot.enabled ? 1 : 0.7 }}>
      <div style={{ padding: "16px 18px 12px", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, display: "grid", placeItems: "center", background: "var(--info-bg)", border: "1px solid var(--info-border)" }}>
            <Icon d={Icons.send} size={22} color="var(--info)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 800, fontSize: 15.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.name}</p>
            <p style={{ fontSize: 11.5, color: "var(--text-faint)", fontFamily: "ui-monospace, monospace", marginTop: 1 }}>chat {bot.chat_id}</p>
          </div>
          <Switch on={bot.enabled} onChange={onToggle} />
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {chips.length === 0
            ? <span className="chip chip-slate" style={{ fontSize: 10.5 }}>No subscriptions</span>
            : chips.map(c => (
                <span key={c.label} style={{ padding: "2px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: `${c.color}1A`, color: c.color, border: `1px solid ${c.color}40` }}>{c.label}</span>
              ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, fontSize: 11, color: "var(--text-faint)", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <Icon d={bot.has_token ? Icons.key : Icons.warn} size={11} color={bot.has_token ? "var(--ok)" : "var(--danger)"} />
            {bot.has_token ? "Token set" : "No token"}
          </span>
          {bot.throttle_secs > 0 && <span style={{ display: "flex", alignItems: "center", gap: 5 }}><Icon d={Icons.clock} size={11} color="var(--text-faint)" /> {bot.throttle_secs}s throttle</span>}
          {bot.last_sent_at && <span>· last sent {new Date(bot.last_sent_at).toLocaleString()}</span>}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", display: "flex", gap: 8, background: "var(--bg-2)" }}>
        <button className="btn btn-secondary btn-sm" onClick={onTest} disabled={testing} style={{ gap: 6 }}><Icon d={Icons.send} size={13} color="var(--text-muted)" /> {testing ? "Sending…" : "Test"}</button>
        <button className="btn btn-secondary btn-sm" onClick={onEdit} style={{ gap: 6 }}><Icon d={Icons.settings} size={13} color="var(--text-muted)" /> Edit</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-danger btn-sm" onClick={onDelete} style={{ gap: 6 }}><Icon d={Icons.trash} size={13} color="var(--danger)" /> Delete</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ page */
export default function TelegramBotsPage() {
  const qc = useQueryClient();
  const canManage = useAuthStore(s => s.hasPerm("notifications.manage"));
  const [modal, setModal] = useState<{ bot: TelegramBot | null } | null>(null);
  const [confirmDel, setConfirmDel] = useState<TelegramBot | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  const { data: bots = [], isLoading } = useQuery<TelegramBot[]>({
    queryKey: ["telegram-bots"], queryFn: async () => (await api.get("/telegram-bots")).data ?? [],
    enabled: canManage, retry: false,
  });
  const { data: nodes = [] } = useQuery<any[]>({ queryKey: ["nodes"], queryFn: async () => (await api.get("/nodes")).data ?? [], enabled: canManage });
  const { data: potstore } = useQuery<any>({ queryKey: ["potstore"], queryFn: async () => (await api.get("/potstore")).data, enabled: canManage, staleTime: 60_000 });
  const potTypes: string[] = (potstore?.pots ?? []).map((p: any) => p.id);

  const refresh = () => qc.invalidateQueries({ queryKey: ["telegram-bots"] });
  const apiErr = (e: any) => e?.response?.data?.error ?? e?.message ?? "Request failed";

  const create = useMutation({ mutationFn: async (p: any) => (await api.post("/telegram-bots", p)).data, onSuccess: () => { refresh(); setModal(null); setToast({ msg: "Bot created", ok: true }); } });
  const update = useMutation({ mutationFn: async ({ id, p }: any) => (await api.put(`/telegram-bots/${id}`, p)).data, onSuccess: () => { refresh(); setModal(null); setToast({ msg: "Bot updated", ok: true }); } });
  const del = useMutation({ mutationFn: async (id: number) => api.delete(`/telegram-bots/${id}`), onSuccess: () => { refresh(); setConfirmDel(null); setToast({ msg: "Bot deleted", ok: true }); } });
  const toggle = useMutation({ mutationFn: async ({ id, enabled }: any) => api.post(`/telegram-bots/${id}/toggle`, { enabled }), onSuccess: () => refresh() });
  const test = useMutation({
    mutationFn: async (id: number) => api.post(`/telegram-bots/${id}/test`),
    onMutate: (id: number) => setTestingId(id),
    onSuccess: () => setToast({ msg: "Test message sent ✓", ok: true }),
    onError: (e: any) => setToast({ msg: apiErr(e), ok: false }),
    onSettled: () => setTestingId(null),
  });

  if (!canManage) {
    return (
      <div className="card empty-state" style={{ marginTop: 40 }}>
        <div className="empty-icon"><Icon d={Icons.shield} size={26} color="var(--text-faint)" /></div>
        <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>No access</p>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>You need the “Manage notifications” permission to configure Telegram bots.</p>
      </div>
    );
  }

  const saveErr = create.isError ? apiErr(create.error) : update.isError ? apiErr(update.error) : null;

  return (
    <div className="animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {modal && (
        <BotModal key={modal.bot?.id ?? "new"} bot={modal.bot} nodes={nodes} potTypes={potTypes} onClose={() => setModal(null)}
          pending={create.isPending || update.isPending} error={saveErr}
          onSave={p => modal.bot ? update.mutate({ id: modal.bot.id, p }) : create.mutate(p)} />
      )}

      {/* Header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <p className="page-label">Notifications</p>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            Telegram Bots
            <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, background: "var(--info-bg)", color: "var(--info)", border: "1px solid var(--info-border)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{bots.length}</span>
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 6, maxWidth: 560, lineHeight: 1.6 }}>
            Pipe any system signal — attacker events, alerts, node up/down, deployments, audit actions — straight to Telegram. Create as many bots as you like, each tuned to exactly what you care about.
          </p>
        </div>
        <button className="btn btn-primary shine" style={{ gap: 6 }} onClick={() => setModal({ bot: null })}>
          <Icon d={Icons.plus} size={14} color="#1C0A00" /> Add Bot
        </button>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {[0, 1, 2].map(i => <div key={i} className="card" style={{ height: 180 }}><div className="skeleton" style={{ height: "100%" }} /></div>)}
        </div>
      ) : bots.length === 0 ? (
        <div className="card empty-state">
          <div className="empty-icon"><Icon d={Icons.send} size={28} color="var(--info)" /></div>
          <p style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>No bots yet</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 360 }}>Create your first Telegram bot to start receiving real-time HoneyBee notifications.</p>
          <button className="btn btn-primary shine" style={{ marginTop: 4, gap: 6 }} onClick={() => setModal({ bot: null })}><Icon d={Icons.plus} size={14} color="#1C0A00" /> Add your first bot</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
          {bots.map(b => (
            <BotCard key={b.id} bot={b} testing={testingId === b.id}
              onEdit={() => setModal({ bot: b })} onDelete={() => setConfirmDel(b)}
              onToggle={v => toggle.mutate({ id: b.id, enabled: v })} onTest={() => test.mutate(b.id)} />
          ))}
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && createPortal(
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setConfirmDel(null); }}>
          <div className="modal animate-fade-up" role="dialog" aria-modal="true" style={{ maxWidth: 420 }}>
            <div className="card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, display: "grid", placeItems: "center", background: "var(--danger-bg)" }}><Icon d={Icons.trash} size={16} color="var(--danger)" /></div>
                <p className="section-title">Delete bot</p>
              </div>
              <button className="icon-btn" onClick={() => setConfirmDel(null)}><Icon d={Icons.close} size={14} /></button>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>Delete <strong style={{ color: "var(--text)" }}>{confirmDel.name}</strong>? It will stop receiving all notifications. This cannot be undone.</p>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "14px 20px", borderTop: "1px solid var(--border)" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" onClick={() => del.mutate(confirmDel.id)} disabled={del.isPending}><Icon d={Icons.trash} size={13} color="var(--danger)" /> Delete</button>
            </div>
          </div>
        </div>, document.body)}

      {/* Toast */}
      {toast && createPortal(
        <div className="animate-fade-up" role="status" aria-live="polite" style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 60,
          background: "var(--elevated)", border: "1px solid var(--border-2)", borderRadius: 999, boxShadow: "var(--shadow-lg)",
          padding: "10px 18px", display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: "var(--text)", maxWidth: "90vw" }}>
          <Icon d={toast.ok ? Icons.check : Icons.warn} size={15} color={toast.ok ? "var(--ok)" : "var(--danger)"} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{toast.msg}</span>
        </div>, document.body)}
    </div>
  );
}
