import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import api from "../api/client";
import { useAuthStore } from "../stores/auth";
import { Icon, Icons } from "../components/Icons";

/* ════════════════════════════════════════════════════════════ Types */
interface User {
  id: number; email: string; name: string; role: string;
  avatar?: string; created_at: string; updated_at: string;
}
interface RoleDef {
  id: number; slug: string; name: string; color: string;
  permissions: string[]; is_system: boolean;
}
interface PermDef { key: string; label: string; group: string; description: string }
interface AuditEntry {
  id: number; user_id: number | null; action: string; resource: string;
  resource_id: string | null; details: string; created_at: string;
}

/* ════════════════════════════════════════════════════════════ Constants */
/* Role colors are an intentional fixed palette (consumed via hex-alpha concat
   like role.color + "1A"), so they MUST stay literal hex — not theme tokens. */
const COLOR_SWATCHES = [
  "#F59E0B", "#D97706", "#818CF8", "#6366F1", "#0EA5E9", "#0891B2",
  "#22C55E", "#10B981", "#DC2626", "#DB2777", "#7C3AED", "#64748B",
];

const SEC_ACTIONS: Record<string, { label: string; icon: string; color: string }> = {
  "user-create":         { label: "added user",             icon: Icons.plus,     color: "var(--ok)" },
  "user-delete":         { label: "removed user",           icon: Icons.trash,    color: "var(--danger)" },
  "user-role-change":    { label: "changed role of",        icon: Icons.shield,   color: "var(--violet)" },
  "user-update":         { label: "updated user",           icon: Icons.user,     color: "var(--text-muted)" },
  "role-create":         { label: "created role",           icon: Icons.key,      color: "var(--ok)" },
  "role-update":         { label: "edited role",            icon: Icons.key,      color: "var(--violet)" },
  "role-delete":         { label: "deleted role",           icon: Icons.trash,    color: "var(--danger)" },
  "regenerate-token":    { label: "regenerated node token", icon: Icons.key,      color: "var(--accent)" },
  "create":              { label: "registered node",        icon: Icons.server,   color: "var(--ok)" },
  "delete":              { label: "deleted node",           icon: Icons.trash,    color: "var(--danger)" },
  "uninstall":           { label: "uninstalled node",       icon: Icons.offline,  color: "var(--danger)" },
};

/* ════════════════════════════════════════════════════════════ Helpers */
function initials(name: string, email: string): string {
  const n = (name || "").trim();
  if (n) { const p = n.split(/\s+/); return (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase(); }
  return (email || "?").slice(0, 2).toUpperCase();
}
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
const emailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const apiErr = (e: any): string => e?.response?.data?.error || e?.message || "Something went wrong";

const STRENGTH = [
  { label: "Too short", color: "var(--danger)", w: "20%" }, { label: "Weak", color: "var(--danger)", w: "40%" },
  { label: "Fair", color: "var(--warn)", w: "60%" }, { label: "Good", color: "var(--ok)", w: "80%" },
  { label: "Strong", color: "var(--ok)", w: "100%" },
];
function scorePassword(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++; if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}
function randInt(max: number): number {
  const a = new Uint32Array(1);
  (window.crypto || (window as any).msCrypto).getRandomValues(a);
  return a[0] % max;
}
function genPassword(len = 16): string {
  const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_=+"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randInt(s.length)]);
  while (chars.length < len) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
/** Read an image file, cover-crop to 128px, return a compact JPEG data URL. */
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const size = 128;
        const c = document.createElement("canvas");
        c.width = size; c.height = size;
        const ctx = c.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function roleIcon(r: RoleDef): string {
  if (r.slug === "admin") return Icons.shield;
  if (r.slug === "operator") return Icons.bolt;
  if (r.slug === "viewer") return Icons.user;
  if (r.permissions.includes("users.manage")) return Icons.shield;
  if (r.permissions.some((p) => p === "pots.deploy" || p === "nodes.manage")) return Icons.bolt;
  return Icons.key;
}
function fallbackRole(slug: string): RoleDef {
  return { id: 0, slug, name: slug, color: "#64748B", permissions: [], is_system: false };
}

/* ════════════════════════════════════════════════════════════ Small UI */
function Avatar({ user, color, size = 38 }: { user: User; color: string; size?: number }) {
  const radius = size * 0.32;
  if (user.avatar) {
    return <img src={user.avatar} alt="" style={{ width: size, height: size, borderRadius: radius, objectFit: "cover", boxShadow: "0 2px 8px rgba(15,23,42,0.18)" }} />;
  }
  return (
    <div className="grid place-items-center font-bold text-white shrink-0"
      style={{
        width: size, height: size, borderRadius: radius, fontSize: size * 0.36, letterSpacing: "-0.02em",
        background: `linear-gradient(135deg, rgba(255,255,255,0.28), rgba(0,0,0,0.14)), ${color}`,
        boxShadow: "0 4px 12px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.4)",
      }}>
      {initials(user.name, user.email)}
    </div>
  );
}
function RolePill({ role }: { role: RoleDef }) {
  return (
    <span className="badge" style={{ background: role.color + "1A", color: role.color, borderColor: role.color + "44" }}>
      <Icon d={roleIcon(role)} size={11} /> {role.name}
    </span>
  );
}
function SecurityRing({ score }: { score: number }) {
  const r = 30, c = 2 * Math.PI * r, off = c * (1 - score / 100);
  const color = score >= 80 ? "var(--ok)" : score >= 50 ? "var(--warn)" : "var(--danger)";
  return (
    <svg width={76} height={76} viewBox="0 0 76 76" className="shrink-0">
      <circle cx={38} cy={38} r={r} fill="none" stroke="var(--border)" strokeWidth={7} />
      <circle cx={38} cy={38} r={r} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off} transform="rotate(-90 38 38)" style={{ transition: "stroke-dashoffset .6s ease, stroke .3s" }} />
      <text x={38} y={37} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 19, fontWeight: 800, fill: "var(--text)" }}>{score}</text>
      <text x={38} y={50} textAnchor="middle" style={{ fontSize: 8, fontWeight: 700, fill: "var(--text-faint)", letterSpacing: "0.08em" }}>SCORE</text>
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════ Page */
export default function UsersPage() {
  const qc = useQueryClient();
  const myID = useAuthStore((s) => s.userID);

  const { data: users = [], isLoading } = useQuery<User[]>({ queryKey: ["users"], queryFn: async () => (await api.get("/users")).data });
  const { data: roles = [] } = useQuery<RoleDef[]>({ queryKey: ["roles"], queryFn: async () => (await api.get("/roles")).data });
  const { data: catalog = [] } = useQuery<PermDef[]>({ queryKey: ["roles-catalog"], queryFn: async () => (await api.get("/roles/catalog")).data });
  const { data: audit = [] } = useQuery<AuditEntry[]>({ queryKey: ["audit-sec"], queryFn: async () => (await api.get("/audit-log?limit=120")).data });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["users"] });
    qc.invalidateQueries({ queryKey: ["roles"] });
    qc.invalidateQueries({ queryKey: ["audit-sec"] });
  };

  /* role lookup */
  const roleMap = useMemo(() => {
    const m: Record<string, RoleDef> = {};
    roles.forEach((r) => { m[r.slug] = r; });
    return m;
  }, [roles]);
  const getRole = (slug: string): RoleDef => roleMap[slug] ?? fallbackRole(slug);
  const rolesSorted = useMemo(
    () => [...roles].sort((a, b) => (a.is_system === b.is_system ? a.name.localeCompare(b.name) : a.is_system ? -1 : 1)),
    [roles]
  );

  /* user mutations */
  const createUser = useMutation({
    mutationFn: async (p: any) => (await api.post("/users", p)).data,
    onSuccess: () => { refresh(); setShowAdd(false); },
  });
  const updateUser = useMutation({
    mutationFn: async (p: { id: number; body: any }) => (await api.patch(`/users/${p.id}`, p.body)).data,
    onSuccess: () => { refresh(); setEditUser(null); },
  });
  const deleteUser = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/users/${id}`)).data,
    onSuccess: () => { refresh(); setDelUser(null); },
  });
  const bulkDelete = useMutation({
    mutationFn: async (ids: number[]) => { await Promise.all(ids.map((id) => api.delete(`/users/${id}`))); },
    onSuccess: () => { refresh(); setSelected([]); setShowBulk(false); },
  });

  /* role mutations */
  const createRole = useMutation({
    mutationFn: async (p: any) => (await api.post("/roles", p)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); qc.invalidateQueries({ queryKey: ["audit-sec"] }); setRoleModal(null); },
  });
  const updateRole = useMutation({
    mutationFn: async (p: { id: number; body: any }) => (await api.put(`/roles/${p.id}`, p.body)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); qc.invalidateQueries({ queryKey: ["audit-sec"] }); setRoleModal(null); },
  });
  const deleteRole = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/roles/${id}`)).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); qc.invalidateQueries({ queryKey: ["audit-sec"] }); setDelRole(null); },
  });

  /* ui state */
  const [tab, setTab] = useState<"members" | "roles" | "activity">("members");
  const [view, setView] = useState<"table" | "grid">("table");
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sort, setSort] = useState<"new" | "old" | "name" | "role">("new");
  const [selected, setSelected] = useState<number[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [delUser, setDelUser] = useState<User | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [roleModal, setRoleModal] = useState<RoleDef | "new" | null>(null);
  const [delRole, setDelRole] = useState<RoleDef | null>(null);

  /* derived */
  const total = users.length;
  const roleCounts = useMemo(() => {
    const c: Record<string, number> = {};
    users.forEach((u) => { c[u.role] = (c[u.role] ?? 0) + 1; });
    return c;
  }, [users]);
  const adminCount = roleCounts["admin"] ?? 0;

  const score = useMemo(() => {
    let s = 100;
    if (adminCount === 0) s -= 60; else if (adminCount === 1) s -= 25;
    const privileged = users.filter((u) => getRole(u.role).permissions.length > 0 || u.role === "admin").length;
    if (total > 0 && privileged / total > 0.6) s -= 15;
    if (total > 1 && (roleCounts["viewer"] ?? 0) === 0) s -= 5;
    return Math.max(0, Math.min(100, s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, adminCount, total, roleCounts, roleMap]);

  const usersById = useMemo(() => { const m: Record<number, User> = {}; users.forEach((u) => { m[u.id] = u; }); return m; }, [users]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return users
      .filter((u) => (roleFilter === "all" || u.role === roleFilter) &&
        (!term || u.email.toLowerCase().includes(term) || (u.name || "").toLowerCase().includes(term)))
      .sort((a, b) => {
        switch (sort) {
          case "old":  return +new Date(a.created_at) - +new Date(b.created_at);
          case "name": return (a.name || a.email).localeCompare(b.name || b.email);
          case "role": return getRole(a.role).name.localeCompare(getRole(b.role).name) || a.email.localeCompare(b.email);
          default:     return +new Date(b.created_at) - +new Date(a.created_at);
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, q, roleFilter, sort, roleMap]);

  const insights = useMemo(() => buildInsights(adminCount, roleCounts["viewer"] ?? 0, total), [adminCount, roleCounts, total]);
  const feed = useMemo(() => audit.filter((a) => SEC_ACTIONS[a.action]), [audit]);

  const isSelf = (u: User) => u.id === myID;
  const isLastAdmin = (u: User) => u.role === "admin" && adminCount <= 1;

  /* selection */
  const selectableIds = useMemo(() => filtered.filter((u) => !isSelf(u)).map((u) => u.id), [filtered, myID]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));
  const toggleAll = () => setSelected(allSelected ? [] : selectableIds);
  const toggleOne = (id: number) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const selectedUsers = users.filter((u) => selected.includes(u.id));
  const adminsSelected = selectedUsers.filter((u) => u.role === "admin").length;
  const canBulkDelete = selectedUsers.length > 0 && adminCount - adminsSelected >= 1;

  const changeRole = (u: User, role: string) => {
    if (role === u.role) return;
    setBusyId(u.id);
    updateUser.mutate({ id: u.id, body: { name: u.name, role } }, { onSettled: () => setBusyId(null) });
  };
  const exportCSV = (rows: User[]) => {
    const head = ["id", "email", "name", "role", "created_at"];
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [head.join(","), ...rows.map((u) => [u.id, u.email, u.name, u.role, u.created_at].map(esc).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const TABS = [
    { key: "members" as const, label: "Members", icon: Icons.users, count: total },
    { key: "roles" as const, label: "Roles & Permissions", icon: Icons.key, count: roles.length },
    { key: "activity" as const, label: "Activity", icon: Icons.activity, count: feed.length },
  ];

  return (
    <div className="space-y-5 animate-fade-up">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-label">Access Control &amp; Security</p>
          <h1 className="page-title flex items-center gap-2.5"><Icon d={Icons.shield} size={25} color="var(--accent)" /> Users &amp; Security</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => exportCSV(filtered)} title="Export CSV"><Icon d={Icons.install} size={15} /> Export</button>
          <button className="btn btn-secondary btn-sm" onClick={refresh} title="Refresh"><Icon d={Icons.refresh} size={15} /></button>
          {tab === "roles"
            ? <button className="btn btn-primary" onClick={() => { createRole.reset(); setRoleModal("new"); }}><Icon d={Icons.plus} size={16} /> New role</button>
            : <button className="btn btn-primary" onClick={() => { createUser.reset(); setShowAdd(true); }}><Icon d={Icons.plus} size={16} /> Add user</button>}
        </div>
      </div>

      {/* KPI bar */}
      <div className="card p-4 flex flex-wrap items-center gap-5">
        <div className="flex items-center gap-3">
          <SecurityRing score={score} />
          <div>
            <p className="page-label" style={{ margin: 0 }}>Security posture</p>
            <p style={{ fontSize: 14, fontWeight: 800, color: score >= 80 ? "var(--ok)" : score >= 50 ? "var(--accent)" : "var(--danger)" }}>
              {score >= 80 ? "Healthy" : score >= 50 ? "Needs attention" : "At risk"}
            </p>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{total} member{total === 1 ? "" : "s"} · {roles.length} roles</p>
          </div>
        </div>
        <div className="h-12 w-px hidden sm:block" style={{ background: "var(--border)" }} />
        <div className="flex-1 min-w-[220px]">
          <span className="page-label" style={{ margin: 0 }}>Role distribution</span>
          <div className="flex h-2.5 rounded-full overflow-hidden mt-1.5" style={{ background: "var(--bg-2)" }}>
            {rolesSorted.map((r) => (roleCounts[r.slug] ?? 0) > 0 && (
              <div key={r.slug} title={`${roleCounts[r.slug]} ${r.name}`} style={{ width: `${((roleCounts[r.slug] ?? 0) / Math.max(total, 1)) * 100}%`, background: r.color }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {rolesSorted.filter((r) => (roleCounts[r.slug] ?? 0) > 0).map((r) => (
              <span key={r.slug} className="flex items-center gap-1.5" style={{ fontSize: 12 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: r.color }} />
                <b>{roleCounts[r.slug]}</b> <span style={{ color: "var(--text-muted)" }}>{r.name}</span>
              </span>
            ))}
          </div>
        </div>
        {insights[0] && (
          <div className="flex items-start gap-2.5 min-w-[230px] max-w-[320px]" style={{ background: `color-mix(in srgb, ${insights[0].color} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${insights[0].color} 20%, transparent)`, borderRadius: 12, padding: "10px 12px" }}>
            <div className="grid place-items-center shrink-0" style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${insights[0].color} 10%, transparent)`, color: insights[0].color }}><Icon d={insights[0].icon} size={15} /></div>
            <div className="min-w-0"><div style={{ fontSize: 12.5, fontWeight: 700 }}>{insights[0].title}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{insights[0].detail}</div></div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="segmented w-fit">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2${tab === t.key ? " is-active" : ""}`}>
            <Icon d={t.icon} size={15} /> {t.label}
            <span style={{ fontSize: 11, fontWeight: 800, padding: "0 6px", borderRadius: 99, minWidth: 18, textAlign: "center", background: "var(--bg-2)", color: "var(--text-muted)" }}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* ════ MEMBERS ════ */}
      {tab === "members" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative" style={{ flex: "1 1 220px", minWidth: 180 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }}><Icon d={Icons.search} size={16} /></span>
              <input className="input" style={{ paddingLeft: 36 }} placeholder="Search name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="segmented" style={{ flexWrap: "wrap" }}>
              <FilterPill active={roleFilter === "all"} onClick={() => setRoleFilter("all")}>All {total}</FilterPill>
              {rolesSorted.filter((r) => (roleCounts[r.slug] ?? 0) > 0).map((r) => (
                <FilterPill key={r.slug} active={roleFilter === r.slug} onClick={() => setRoleFilter(r.slug)}>{r.name} {roleCounts[r.slug]}</FilterPill>
              ))}
            </div>
            <select className="input" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="new">Newest</option><option value="old">Oldest</option><option value="name">Name A–Z</option><option value="role">By role</option>
            </select>
            <div className="segmented">
              {(["table", "grid"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} title={`${v} view`} className={`grid place-items-center${view === v ? " is-active" : ""}`} style={{ padding: "6px 10px" }}>
                  <Icon d={v === "table" ? Icons.hash : Icons.deploy} size={15} />
                </button>
              ))}
            </div>
          </div>

          {selected.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 animate-fade-up" style={{ background: "var(--text)", borderRadius: "var(--r-md)", color: "var(--surface)" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{selected.length} selected</span>
              <button className="btn-xs" style={{ border: "none", background: "rgba(255,255,255,0.14)", color: "var(--surface)", cursor: "pointer", padding: "5px 11px", borderRadius: 8 }} onClick={() => exportCSV(selectedUsers)}>Export</button>
              <button className="btn-xs" disabled={!canBulkDelete} title={!canBulkDelete ? "Selection would remove the last admin" : "Delete selected"}
                style={{ border: "none", background: canBulkDelete ? "var(--danger)" : "rgba(255,255,255,0.1)", color: "var(--surface)", cursor: canBulkDelete ? "pointer" : "not-allowed", padding: "5px 11px", borderRadius: 8 }}
                onClick={() => { bulkDelete.reset(); setShowBulk(true); }}>Delete</button>
              <button className="btn-xs" style={{ marginLeft: "auto", border: "none", background: "transparent", color: "rgba(255,255,255,0.7)", cursor: "pointer" }} onClick={() => setSelected([])}>Clear</button>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 56 }} />)}</div>
          ) : filtered.length === 0 ? (
            <EmptyState filtered={!!q || roleFilter !== "all"} />
          ) : view === "table" ? (
            <div className="card overflow-hidden">
              <div style={{ overflowX: "auto" }}>
                <table className="w-full" style={{ minWidth: 640 }}>
                  <thead><tr>
                    <th className="th" style={{ width: 40 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ cursor: "pointer" }} /></th>
                    <th className="th">User</th><th className="th" style={{ width: 170 }}>Role</th><th className="th" style={{ width: 120 }}>Joined</th><th className="th-r" style={{ width: 100 }}></th>
                  </tr></thead>
                  <tbody>
                    {filtered.map((u) => {
                      const role = getRole(u.role);
                      return (
                        <tr key={u.id} className="tr">
                          <td className="td"><input type="checkbox" disabled={isSelf(u)} checked={selected.includes(u.id)} onChange={() => toggleOne(u.id)} style={{ cursor: isSelf(u) ? "not-allowed" : "pointer" }} /></td>
                          <td className="td">
                            <div className="flex items-center gap-3">
                              <Avatar user={u} color={role.color} />
                              <div className="min-w-0">
                                <div className="flex items-center gap-2"><span style={{ fontWeight: 700 }} className="truncate">{u.name || u.email.split("@")[0]}</span>{isSelf(u) && <span className="chip chip-amber" style={{ padding: "1px 7px", fontSize: 10 }}>You</span>}</div>
                                <div className="truncate" style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.email}</div>
                              </div>
                            </div>
                          </td>
                          <td className="td">
                            <select className="input" style={{ padding: "5px 9px", fontSize: 12.5, width: 150 }} value={u.role} disabled={isLastAdmin(u) || busyId === u.id}
                              title={isLastAdmin(u) ? "The only admin's role is locked" : "Change role"} onChange={(e) => changeRole(u, e.target.value)}>
                              {rolesSorted.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
                              {!roleMap[u.role] && <option value={u.role}>{u.role}</option>}
                            </select>
                          </td>
                          <td className="td" style={{ color: "var(--text-muted)", fontSize: 12.5 }} title={fmtDate(u.created_at)}>{relativeTime(u.created_at)}</td>
                          <td className="td">
                            <div className="flex items-center justify-end gap-1">
                              <button className="icon-btn" style={{ width: 30, height: 30 }} title="Copy email" onClick={() => navigator.clipboard?.writeText(u.email).catch(() => {})}><Icon d={Icons.copy} size={14} /></button>
                              <button className="icon-btn" style={{ width: 30, height: 30 }} title="Edit" onClick={() => { updateUser.reset(); setEditUser(u); }}><Icon d={Icons.settings} size={14} /></button>
                              <button className="icon-btn icon-btn-danger" style={{ width: 30, height: 30 }} disabled={isSelf(u) || isLastAdmin(u)}
                                title={isSelf(u) ? "You can't delete yourself" : isLastAdmin(u) ? "Can't remove the last admin" : "Delete"} onClick={() => { deleteUser.reset(); setDelUser(u); }}><Icon d={Icons.trash} size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))" }}>
              {filtered.map((u) => {
                const role = getRole(u.role);
                return (
                  <div key={u.id} className="card card-hover p-4">
                    <div className="flex items-center gap-3">
                      <Avatar user={u} color={role.color} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2"><span style={{ fontWeight: 700, fontSize: 14 }} className="truncate">{u.name || u.email.split("@")[0]}</span>{isSelf(u) && <span className="chip chip-amber" style={{ padding: "1px 7px", fontSize: 10 }}>You</span>}</div>
                        <div className="truncate" style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{u.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-3.5 pt-3.5" style={{ borderTop: "1px solid var(--border)" }}>
                      <RolePill role={role} />
                      <div className="flex items-center gap-1">
                        <button className="icon-btn" style={{ width: 28, height: 28 }} title="Edit" onClick={() => { updateUser.reset(); setEditUser(u); }}><Icon d={Icons.settings} size={14} /></button>
                        <button className="icon-btn icon-btn-danger" style={{ width: 28, height: 28 }} disabled={isSelf(u) || isLastAdmin(u)} onClick={() => { deleteUser.reset(); setDelUser(u); }}><Icon d={Icons.trash} size={14} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════ ROLES ════ */}
      {tab === "roles" && (
        <div className="space-y-4">
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))" }}>
            {rolesSorted.map((r) => (
              <div key={r.slug} className="card p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="grid place-items-center shrink-0" style={{ width: 38, height: 38, borderRadius: 11, background: `${r.color}16`, color: r.color }}><Icon d={roleIcon(r)} size={19} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><span style={{ fontWeight: 800 }} className="truncate">{r.name}</span>
                      {r.is_system ? <span className="chip chip-slate" style={{ padding: "1px 7px", fontSize: 10 }}>Built-in</span> : <span className="chip chip-amber" style={{ padding: "1px 7px", fontSize: 10 }}>Custom</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{roleCounts[r.slug] ?? 0} user{(roleCounts[r.slug] ?? 0) === 1 ? "" : "s"} · {r.slug === "admin" ? "all" : r.permissions.length} permission{r.permissions.length === 1 && r.slug !== "admin" ? "" : "s"}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3" style={{ minHeight: 22 }}>
                  {r.slug === "admin" ? <span className="chip chip-amber" style={{ fontSize: 10.5 }}>Full access</span>
                    : r.permissions.length === 0 ? <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Read-only</span>
                    : r.permissions.slice(0, 3).map((p) => <span key={p} className="chip" style={{ fontSize: 10.5, padding: "2px 8px" }}>{catalog.find((c) => c.key === p)?.label.split(" ")[0] ?? p}</span>)}
                  {r.slug !== "admin" && r.permissions.length > 3 && <span className="chip" style={{ fontSize: 10.5, padding: "2px 8px" }}>+{r.permissions.length - 3}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {r.is_system ? (
                    <button className="btn btn-secondary btn-xs" onClick={() => setRoleModal(r)}><Icon d={Icons.eye} size={13} /> View</button>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-xs" onClick={() => { updateRole.reset(); setRoleModal(r); }}><Icon d={Icons.settings} size={13} /> Edit</button>
                      <button className="btn btn-danger btn-xs" disabled={(roleCounts[r.slug] ?? 0) > 0} title={(roleCounts[r.slug] ?? 0) > 0 ? "Reassign its users first" : "Delete role"} onClick={() => { deleteRole.reset(); setDelRole(r); }}><Icon d={Icons.trash} size={13} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 p-4" style={{ borderBottom: "1px solid var(--border)" }}><Icon d={Icons.key} size={16} color="var(--accent)" /><p className="section-label" style={{ margin: 0 }}>Permission matrix</p></div>
            <div style={{ overflowX: "auto" }}>
              <table className="w-full" style={{ minWidth: 520 }}>
                <thead><tr><th className="th">Capability</th>{rolesSorted.map((r) => <th key={r.slug} className="th" style={{ textAlign: "center", width: 92, color: r.color }}>{r.name}</th>)}</tr></thead>
                <tbody>
                  {catalog.map((p) => (
                    <tr key={p.key} className="tr">
                      <td className="td" title={p.description}>{p.label}</td>
                      {rolesSorted.map((r) => {
                        const has = r.slug === "admin" || r.permissions.includes(p.key);
                        return <td key={r.slug} className="td" style={{ textAlign: "center" }}>{has
                          ? <span className="inline-grid place-items-center" style={{ width: 22, height: 22, borderRadius: 7, background: "var(--ok-bg)", color: "var(--ok)" }}><Icon d={Icons.check} size={13} /></span>
                          : <span style={{ color: "var(--border-2)" }}>—</span>}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ════ ACTIVITY ════ */}
      {tab === "activity" && (
        <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)" }}>
          <div className="card overflow-hidden">
            <div className="flex items-center gap-2 p-4" style={{ borderBottom: "1px solid var(--border)" }}><Icon d={Icons.activity} size={16} color="var(--accent)" /><p className="section-label" style={{ margin: 0 }}>Security activity</p></div>
            {feed.length === 0 ? (
              <div className="empty-state"><Icon d={Icons.clipboard} size={26} /><p style={{ fontSize: 13, marginTop: 8 }}>No recent access changes.</p></div>
            ) : (
              <div className="p-2" style={{ maxHeight: 520, overflowY: "auto" }}>
                {feed.slice(0, 40).map((a) => {
                  const meta = SEC_ACTIONS[a.action];
                  const actor = a.user_id != null && usersById[a.user_id] ? (usersById[a.user_id].name || usersById[a.user_id].email) : "system";
                  return (
                    <div key={a.id} className="flex items-start gap-3" style={{ padding: "9px 10px" }}>
                      <div className="grid place-items-center shrink-0" style={{ width: 30, height: 30, borderRadius: 9, background: `color-mix(in srgb, ${meta.color} 9%, transparent)`, color: meta.color }}><Icon d={meta.icon} size={15} /></div>
                      <div className="min-w-0 flex-1">
                        <div style={{ fontSize: 12.5, lineHeight: 1.4 }}><span style={{ fontWeight: 700 }}>{actor}</span> <span style={{ color: "var(--text-muted)" }}>{meta.label}</span>{a.details && <> <span style={{ fontWeight: 600 }}>{a.details}</span></>}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 1 }}>{relativeTime(a.created_at)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="card overflow-hidden h-fit">
            <div className="flex items-center gap-2 p-4" style={{ borderBottom: "1px solid var(--border)" }}><Icon d={Icons.shield} size={16} color="var(--accent)" /><p className="section-label" style={{ margin: 0 }}>Posture checks</p></div>
            <div className="p-3 space-y-2">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-start gap-2.5" style={{ padding: "9px 10px", borderRadius: 10, background: "var(--bg-2)" }}>
                  <div className="grid place-items-center shrink-0" style={{ width: 28, height: 28, borderRadius: 8, background: `color-mix(in srgb, ${ins.color} 10%, transparent)`, color: ins.color }}><Icon d={ins.icon} size={15} /></div>
                  <div className="min-w-0"><div style={{ fontSize: 12.5, fontWeight: 700 }}>{ins.title}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{ins.detail}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {showAdd && <UserModal mode="add" roles={rolesSorted} onClose={() => setShowAdd(false)}
        onSubmit={(b) => createUser.mutate(b)} pending={createUser.isPending} error={createUser.isError ? apiErr(createUser.error) : null} getRole={getRole} />}
      {editUser && <UserModal mode="edit" user={editUser} roles={rolesSorted} lockAdminRole={isLastAdmin(editUser)} onClose={() => setEditUser(null)}
        onSubmit={(b) => updateUser.mutate({ id: editUser.id, body: b })} pending={updateUser.isPending} error={updateUser.isError ? apiErr(updateUser.error) : null} getRole={getRole} />}
      {delUser && <DeleteUserModal user={delUser} color={getRole(delUser.role).color} roleName={getRole(delUser.role).name} onClose={() => setDelUser(null)} onConfirm={() => deleteUser.mutate(delUser.id)} pending={deleteUser.isPending} error={deleteUser.isError ? apiErr(deleteUser.error) : null} />}
      {showBulk && <BulkDeleteModal users={selectedUsers} getRole={getRole} onClose={() => setShowBulk(false)} onConfirm={() => bulkDelete.mutate(selected)} pending={bulkDelete.isPending} error={bulkDelete.isError ? apiErr(bulkDelete.error) : null} />}
      {roleModal && <RoleModal role={roleModal === "new" ? null : roleModal} catalog={catalog} onClose={() => setRoleModal(null)}
        onSubmit={(b) => roleModal === "new" ? createRole.mutate(b) : updateRole.mutate({ id: roleModal.id, body: b })}
        pending={createRole.isPending || updateRole.isPending} error={(createRole.isError && apiErr(createRole.error)) || (updateRole.isError && apiErr(updateRole.error)) || null} />}
      {delRole && <ConfirmModal title="Delete role" sub={delRole.name} accent="var(--danger)" icon={Icons.trash} confirmLabel="Delete role" pending={deleteRole.isPending} error={deleteRole.isError ? apiErr(deleteRole.error) : null}
        onClose={() => setDelRole(null)} onConfirm={() => deleteRole.mutate(delRole.id)}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>The <b>{delRole.name}</b> role will be permanently removed. Users must be reassigned first.</p>
      </ConfirmModal>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════ Sub-components */
function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={active ? "is-active" : undefined} style={{ whiteSpace: "nowrap" }}>{children}</button>;
}
function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="card empty-state">
      <div className="empty-icon"><Icon d={Icons.users} size={26} /></div>
      <p style={{ fontWeight: 700, color: "var(--text)" }}>No users found</p>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{filtered ? "Try adjusting your search or filters." : "Add your first team member to get started."}</p>
    </div>
  );
}
function buildInsights(adminCount: number, viewerCount: number, total: number) {
  const out: { color: string; icon: string; title: string; detail: string }[] = [];
  if (adminCount === 0) out.push({ color: "var(--danger)", icon: Icons.warn, title: "No administrators", detail: "At least one admin is required to manage the org." });
  else if (adminCount === 1) out.push({ color: "var(--warn)", icon: Icons.warn, title: "Single administrator", detail: "Add a second admin to avoid lockout if access is lost." });
  else out.push({ color: "var(--ok)", icon: Icons.shield, title: `${adminCount} administrators`, detail: "Redundant admin access is configured." });
  out.push({ color: "var(--ok)", icon: Icons.check, title: "Least privilege", detail: `${viewerCount} read-only viewer${viewerCount === 1 ? "" : "s"} of ${total} total.` });
  out.push({ color: "var(--violet)", icon: Icons.lock, title: "Password policy", detail: "Minimum 8 characters, bcrypt-hashed at rest." });
  out.push({ color: "var(--info)", icon: Icons.clipboard, title: "Audit logging", detail: "All access & role changes are recorded." });
  return out;
}

/* ════════════════════════════════════════════════════════════ Modal shell */
function Modal({ title, sub, icon, accent = "var(--accent)", onClose, children, footer, width = 500 }: {
  title: string; sub?: string; icon: string; accent?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="card relative animate-fade-up w-full" style={{ maxWidth: width, zIndex: 1, maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div className="flex items-start gap-3 p-5 shrink-0" style={{ borderBottom: "1px solid var(--border)" }}>
          <div className="grid place-items-center shrink-0" style={{ width: 40, height: 40, borderRadius: 11, background: `${accent}16`, color: accent }}><Icon d={icon} size={20} /></div>
          <div className="flex-1 min-w-0"><h3 style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.02em" }}>{title}</h3>{sub && <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }} className="truncate">{sub}</p>}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon d={Icons.close} size={18} /></button>
        </div>
        <div className="p-5" style={{ overflowY: "auto" }}>{children}</div>
        {footer && <div className="flex justify-end gap-2 p-5 shrink-0" style={{ borderTop: "1px solid var(--border)" }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
function ErrorBar({ msg }: { msg: string }) {
  return <div className="badge badge-error" style={{ width: "100%", justifyContent: "flex-start", padding: "8px 12px" }}><Icon d={Icons.warn} size={14} /> {msg}</div>;
}

/* Avatar upload control */
function AvatarUpload({ user, color, onChange }: { user: User; color: string; onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const pick = async (f?: File) => {
    if (!f) return;
    setErr("");
    try { onChange(await fileToAvatar(f)); } catch { setErr("Could not read image"); }
  };
  return (
    <div className="flex items-center gap-3">
      <Avatar user={user} color={color} size={56} />
      <div>
        <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => ref.current?.click()}><Icon d={Icons.install} size={14} /> {user.avatar ? "Change" : "Upload"} photo</button>
          {user.avatar && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange("")}>Remove</button>}
        </div>
        <p style={{ fontSize: 11, color: err ? "var(--danger)" : "var(--text-faint)", marginTop: 5 }}>{err || "JPG/PNG · auto-resized to 128px"}</p>
      </div>
    </div>
  );
}

/* Unified add/edit user modal */
function UserModal({ mode, user, roles, lockAdminRole, onClose, onSubmit, pending, error, getRole }: {
  mode: "add" | "edit"; user?: User; roles: RoleDef[]; lockAdminRole?: boolean;
  onClose: () => void; onSubmit: (body: any) => void; pending: boolean; error: string | null; getRole: (s: string) => RoleDef;
}) {
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<string>(user?.role ?? "viewer");
  const [avatar, setAvatar] = useState<string>(user?.avatar ?? "");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const isAdd = mode === "add";
  const strength = STRENGTH[scorePassword(pw)];
  const emailOK = isAdd ? emailValid(email) : true;
  const pwOK = isAdd ? pw.length >= 8 : true;
  const canSubmit = emailOK && pwOK && !pending;
  const previewUser: User = { id: user?.id ?? 0, email, name, role, avatar, created_at: "", updated_at: "" };

  const submit = () => {
    if (isAdd) onSubmit({ email: email.trim(), name: name.trim(), password: pw, role, avatar });
    else onSubmit({ name: name.trim(), role, avatar });
  };

  return (
    <Modal title={isAdd ? "Add user" : "Edit user"} sub={isAdd ? "Create a new account" : user?.email} icon={isAdd ? Icons.plus : Icons.settings}
      accent={getRole(role).color} onClose={onClose} width={520}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>{pending ? "Saving…" : isAdd ? "Create user" : "Save changes"}</button></>}>
      <div className="space-y-4">
        {error && <ErrorBar msg={error} />}
        <AvatarUpload user={previewUser} color={getRole(role).color} onChange={setAvatar} />
        {isAdd && (
          <div>
            <label className="input-label">Email address</label>
            <input className="input" type="email" value={email} placeholder="jane@example.com" onChange={(e) => setEmail(e.target.value)} />
            {email && !emailOK && <p style={{ fontSize: 11.5, color: "var(--danger)", marginTop: 5 }}>Enter a valid email address.</p>}
          </div>
        )}
        <div>
          <label className="input-label">Full name {isAdd && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>(optional)</span>}</label>
          <input className="input" value={name} placeholder="Jane Doe" onChange={(e) => setName(e.target.value)} />
        </div>
        {isAdd && (
          <div>
            <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
              <label className="input-label" style={{ margin: 0 }}>Password</label>
              <button type="button" style={{ border: "none", background: "transparent", color: "var(--accent)", fontWeight: 700, cursor: "pointer", padding: 0, fontSize: 12 }} onClick={() => { setPw(genPassword(16)); setShow(true); }}><Icon d={Icons.wand} size={13} style={{ display: "inline", verticalAlign: "-2px" }} /> Generate</button>
            </div>
            <div className="relative">
              <input className="input" type={show ? "text" : "password"} value={pw} placeholder="At least 8 characters" style={{ paddingRight: 70, fontFamily: show ? "ui-monospace, monospace" : undefined }} onChange={(e) => setPw(e.target.value)} />
              <div className="flex items-center gap-1" style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>
                {pw && <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} title={copied ? "Copied!" : "Copy"} onClick={async () => { try { await navigator.clipboard.writeText(pw); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}><Icon d={copied ? Icons.check : Icons.copy} size={14} color={copied ? "var(--ok)" : undefined} /></button>}
                <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} title={show ? "Hide" : "Show"} onClick={() => setShow((s) => !s)}><Icon d={show ? Icons.eyeOff : Icons.eye} size={14} /></button>
              </div>
            </div>
            {pw && <div className="flex items-center gap-2" style={{ marginTop: 7 }}><div style={{ flex: 1, height: 5, borderRadius: 99, background: "var(--bg-2)", overflow: "hidden" }}><div style={{ height: "100%", width: strength.w, background: strength.color, borderRadius: 99, transition: "all .25s" }} /></div><span style={{ fontSize: 11, fontWeight: 700, color: strength.color, minWidth: 56, textAlign: "right" }}>{strength.label}</span></div>}
          </div>
        )}
        <div>
          <label className="input-label">Role</label>
          <div className="grid gap-2">
            {roles.map((r) => {
              const active = role === r.slug;
              const disabled = !!lockAdminRole && user?.role === "admin" && r.slug !== "admin";
              return (
                <button key={r.slug} type="button" disabled={disabled} onClick={() => setRole(r.slug)} className="flex items-center gap-3 text-left"
                  style={{ padding: "10px 12px", borderRadius: 12, width: "100%", border: `1.5px solid ${active ? r.color : "var(--border)"}`, background: active ? `${r.color}0E` : "var(--surface)", boxShadow: active ? `0 0 0 3.5px ${r.color}1A` : "none", opacity: disabled ? 0.45 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
                  <div className="grid place-items-center shrink-0" style={{ width: 32, height: 32, borderRadius: 9, background: `${r.color}16`, color: r.color }}><Icon d={roleIcon(r)} size={16} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><span style={{ fontSize: 13.5, fontWeight: 700 }}>{r.name}</span>{r.is_system && <span className="chip chip-slate" style={{ fontSize: 9.5, padding: "0 6px" }}>built-in</span>}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{r.slug === "admin" ? "Full access to everything" : r.permissions.length === 0 ? "Read-only access" : `${r.permissions.length} permission${r.permissions.length === 1 ? "" : "s"}`}</div>
                  </div>
                  {active && <Icon d={Icons.check} size={18} color={r.color} />}
                </button>
              );
            })}
          </div>
          {lockAdminRole && <p style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 7, display: "flex", gap: 5, alignItems: "center" }}><Icon d={Icons.warn} size={13} /> This is the only administrator — promote another user first.</p>}
        </div>
        {!isAdd && <p style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Email and password can't be changed here.</p>}
      </div>
    </Modal>
  );
}

/* Role builder modal (create / edit / view) */
function RoleModal({ role, catalog, onClose, onSubmit, pending, error }: {
  role: RoleDef | null; catalog: PermDef[]; onClose: () => void; onSubmit: (body: any) => void; pending: boolean; error: string | null;
}) {
  const readOnly = !!role?.is_system;
  const [name, setName] = useState(role?.name ?? "");
  const [color, setColor] = useState(role?.color ?? COLOR_SWATCHES[0]);
  const [perms, setPerms] = useState<string[]>(role?.permissions ?? []);
  const isAdmin = role?.slug === "admin";

  const groups = useMemo(() => {
    const g: Record<string, PermDef[]> = {};
    catalog.forEach((p) => { (g[p.group] ||= []).push(p); });
    return g;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog]);

  const toggle = (key: string) => setPerms((s) => s.includes(key) ? s.filter((p) => p !== key) : [...s, key]);
  const has = (key: string) => isAdmin || perms.includes(key);

  return (
    <Modal title={role ? (readOnly ? role.name : "Edit role") : "New role"} sub={readOnly ? "Built-in role (read-only)" : "Define a name, color and exact permissions"} icon={Icons.key} accent={color} onClose={onClose} width={560}
      footer={readOnly
        ? <button className="btn btn-secondary" onClick={onClose}>Close</button>
        : <><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!name.trim() || pending} onClick={() => onSubmit({ name: name.trim(), color, permissions: perms })}>{pending ? "Saving…" : role ? "Save role" : "Create role"}</button></>}>
      <div className="space-y-4">
        {error && <ErrorBar msg={error} />}
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="input-label">Role name</label>
            <input className="input" value={name} disabled={readOnly} placeholder="e.g. SOC Analyst" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="input-label">Color</label>
            <div className="flex items-center gap-1.5 flex-wrap" style={{ maxWidth: 200 }}>
              {COLOR_SWATCHES.map((c) => (
                <button key={c} type="button" disabled={readOnly} onClick={() => setColor(c)} title={c}
                  style={{ width: 22, height: 22, borderRadius: 7, background: c, cursor: readOnly ? "default" : "pointer", border: color === c ? "2.5px solid var(--border-2)" : "2.5px solid transparent", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
              ))}
            </div>
          </div>
        </div>

        {isAdmin && <div className="badge badge-warning" style={{ width: "100%", justifyContent: "flex-start", padding: "8px 12px" }}><Icon d={Icons.shield} size={14} /> Administrators always hold every permission.</div>}

        <div>
          <label className="input-label">Permissions</label>
          <div className="space-y-3">
            {Object.entries(groups).map(([group, permsList]) => (
              <div key={group}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{group}</div>
                <div className="space-y-1.5">
                  {permsList.map((p) => {
                    const on = has(p.key);
                    const locked = readOnly || isAdmin;
                    return (
                      <button key={p.key} type="button" disabled={locked} onClick={() => toggle(p.key)} className="flex items-start gap-3 text-left w-full"
                        style={{ padding: "9px 11px", borderRadius: 10, border: `1px solid ${on ? color + "55" : "var(--border)"}`, background: on ? color + "0E" : "var(--surface)", cursor: locked ? "default" : "pointer", opacity: locked && !on ? 0.5 : 1 }}>
                        <span className="grid place-items-center shrink-0" style={{ width: 20, height: 20, borderRadius: 6, marginTop: 1, background: on ? color : "transparent", border: on ? "none" : "1.5px solid var(--border-2)", color: "#fff" }}>{on && <Icon d={Icons.check} size={13} />}</span>
                        <div className="min-w-0"><div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.description}</div></div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* Generic confirm modal (used for role delete) */
function ConfirmModal({ title, sub, icon, accent, confirmLabel, onClose, onConfirm, pending, error, children }: {
  title: string; sub?: string; icon: string; accent: string; confirmLabel: string; onClose: () => void; onConfirm: () => void; pending: boolean; error: string | null; children: React.ReactNode;
}) {
  return (
    <Modal title={title} sub={sub} icon={icon} accent={accent} onClose={onClose} width={440}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={pending} onClick={onConfirm} style={{ background: accent, color: "#fff", borderColor: accent }}>{pending ? "Working…" : confirmLabel}</button></>}>
      <div className="space-y-3">{error && <ErrorBar msg={error} />}{children}</div>
    </Modal>
  );
}

/* Delete user modal (type-to-confirm) */
function DeleteUserModal({ user, color, roleName, onClose, onConfirm, pending, error }: {
  user: User; color: string; roleName: string; onClose: () => void; onConfirm: () => void; pending: boolean; error: string | null;
}) {
  const [confirm, setConfirm] = useState("");
  const ok = confirm.trim().toLowerCase() === user.email.toLowerCase();
  return (
    <Modal title="Delete user" sub="This action cannot be undone" icon={Icons.trash} accent="var(--danger)" onClose={onClose} width={460}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={!ok || pending} onClick={onConfirm} style={ok ? { background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" } : undefined}>{pending ? "Deleting…" : "Delete user"}</button></>}>
      <div className="space-y-3">
        {error && <ErrorBar msg={error} />}
        <div className="flex items-center gap-3 p-3" style={{ background: "var(--danger-bg)", border: "1px solid var(--danger)", borderRadius: 12 }}>
          <Avatar user={user} color={color} size={42} />
          <div className="min-w-0"><div style={{ fontWeight: 700 }}>{user.name || user.email.split("@")[0]}</div><div style={{ fontSize: 12.5, color: "var(--text-muted)" }} className="truncate">{user.email}</div></div>
          <span className="badge" style={{ marginLeft: "auto", background: color + "1A", color, borderColor: color + "44" }}>{roleName}</span>
        </div>
        <div><label className="input-label">Type <span style={{ color: "var(--danger)", textTransform: "none", letterSpacing: 0 }}>{user.email}</span> to confirm</label><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={user.email} autoFocus /></div>
      </div>
    </Modal>
  );
}

/* Bulk delete modal */
function BulkDeleteModal({ users, getRole, onClose, onConfirm, pending, error }: {
  users: User[]; getRole: (s: string) => RoleDef; onClose: () => void; onConfirm: () => void; pending: boolean; error: string | null;
}) {
  return (
    <Modal title={`Delete ${users.length} user${users.length === 1 ? "" : "s"}`} sub="This action cannot be undone" icon={Icons.trash} accent="var(--danger)" onClose={onClose} width={460}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={pending} onClick={onConfirm} style={{ background: "var(--danger)", color: "#fff", borderColor: "var(--danger)" }}>{pending ? "Deleting…" : `Delete ${users.length}`}</button></>}>
      <div className="space-y-3">
        {error && <ErrorBar msg={error} />}
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>You're about to permanently remove these accounts:</p>
        <div className="space-y-1.5" style={{ maxHeight: 240, overflowY: "auto" }}>
          {users.map((u) => { const r = getRole(u.role); return (
            <div key={u.id} className="flex items-center gap-2.5 p-2" style={{ background: "var(--bg-2)", borderRadius: 10 }}>
              <Avatar user={u} color={r.color} size={32} />
              <div className="min-w-0 flex-1"><div style={{ fontSize: 13, fontWeight: 600 }} className="truncate">{u.name || u.email.split("@")[0]}</div><div className="truncate" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{u.email}</div></div>
              <span className="badge" style={{ background: r.color + "1A", color: r.color, borderColor: r.color + "44" }}>{r.name}</span>
            </div>
          ); })}
        </div>
      </div>
    </Modal>
  );
}
