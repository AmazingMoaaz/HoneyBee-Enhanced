import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../stores/auth";
import api from "../api/client";
import logoUrl from "../assets/logo.png";
import ParticleCanvas from "./ParticleCanvas";
import { Icon, Icons } from "./Icons";
import CommandPalette, { CommandItem } from "./CommandPalette";
import { getTheme, setTheme, type Theme } from "../lib/theme";

/* ─────────────────────────────────────────────────────────────────
   App shell — floating sidebar + glass topbar + animated background
   Enhancements:
     • Sliding morph indicator behind active nav item
     • Floating right-side label tooltip with arrow
     • Mouse-tracked subtle particle field on entire app
     • Topbar shows live time + connection breadcrumb
─────────────────────────────────────────────────────────────────── */

// Command-palette shortcut, shown correctly per platform (⌘ on macOS, Ctrl elsewhere).
const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

interface NavItem { to: string; label: string; icon: string; group: string; end?: boolean; desc?: string }

const NAV: NavItem[] = [
  { to: "/",          label: "Dashboard",  icon: Icons.hex,       group: "Overview",   end: true, desc: "Live overview" },
  { to: "/nodes",     label: "Nodes",      icon: Icons.server,    group: "Operations", desc: "Honeypot hosts" },
  { to: "/potstore",  label: "Store",      icon: Icons.honeypot,  group: "Operations", desc: "Browse & deploy" },
  { to: "/events",    label: "Events",     icon: Icons.activity,  group: "Monitoring", desc: "Attacker activity" },
  { to: "/attack-map", label: "Attack Map", icon: Icons.globe,    group: "Monitoring", desc: "Live threat origins" },
  { to: "/analytics", label: "Analytics",  icon: Icons.chart,     group: "Monitoring", desc: "Trends & insights" },
  { to: "/alerts",    label: "Alerts",     icon: Icons.bell,      group: "Monitoring", desc: "Security alerts" },
  { to: "/audit-log", label: "Audit Log",  icon: Icons.clipboard, group: "Security",   desc: "Activity history" },
  { to: "/system",    label: "System",     icon: Icons.shield,    group: "Security",   desc: "Diagnostics" },
  { to: "/topology",  label: "Topology",   icon: Icons.network,   group: "Lab",        desc: "Deployment map" },
];

function getPageTitle(pathname: string): string {
  if (pathname === "/")                  return "Dashboard";
  if (pathname.startsWith("/nodes"))     return "Node Manager";
  if (pathname.startsWith("/events"))    return "Event Stream";
  if (pathname.startsWith("/attack-map")) return "Attack Map";
  if (pathname.startsWith("/analytics")) return "Attack Analytics";
  if (pathname.startsWith("/alerts"))    return "Alerts";
  if (pathname.startsWith("/audit-log")) return "Audit Log";
  if (pathname.startsWith("/potstore"))  return "HoneyBee Store";
  if (pathname.startsWith("/system"))    return "System Check";
  if (pathname.startsWith("/topology"))  return "Draft Topology";
  if (pathname.startsWith("/telegram-bots")) return "Telegram Bots";
  if (pathname.startsWith("/users"))     return "User Management";
  return "HoneyBee";
}

function getPageBreadcrumb(pathname: string): string[] {
  if (pathname === "/")                   return ["Home"];
  if (pathname.startsWith("/nodes/"))     return ["Fleet", "Node detail"];
  if (pathname.startsWith("/nodes"))      return ["Fleet"];
  if (pathname.startsWith("/events"))     return ["Telemetry"];
  if (pathname.startsWith("/attack-map")) return ["Telemetry"];
  if (pathname.startsWith("/analytics"))  return ["Intelligence"];
  if (pathname.startsWith("/alerts"))     return ["Security"];
  if (pathname.startsWith("/audit-log"))  return ["Security"];
  if (pathname.startsWith("/potstore"))   return ["Catalog"];
  if (pathname.startsWith("/system"))     return ["Diagnostics"];  if (pathname.startsWith("/topology"))    return ["Design"];  if (pathname.startsWith("/telegram-bots")) return ["Admin"];  if (pathname.startsWith("/users"))      return ["Admin"];
  return [];
}

function AlertBell() {
  const nav = useNavigate();
  const { data } = useQuery({
    queryKey: ["alert-count"],
    queryFn: async () => (await api.get("/alerts/count")).data,
    refetchInterval: 10000,
  });
  const count = data?.count ?? 0;
  return (
    <button onClick={() => nav("/alerts")} className="relative icon-btn" title="Alerts">
      <Icon d={Icons.bell} size={16} />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold px-1"
              style={{ background: "var(--danger)", color: "#FFF", boxShadow: "0 2px 6px rgba(239,68,68,0.4)" }}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

/* One navigation entry — adapts between the collapsed 40px icon button and the
   expanded full-width labeled row. */
function SideItem({ item, expanded, active, delay, badge, animate }: {
  item: NavItem; expanded: boolean; active: boolean; delay: number; badge: number; animate: boolean;
}) {
  const ACTIVE_BG = "linear-gradient(135deg, #FCD34D 0%, #F59E0B 55%, #D97706 100%)";
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={expanded ? undefined : item.label}
      className="group relative flex items-center rounded-[12px] outline-none"
      style={{
        height: expanded ? 44 : 40,
        width: expanded ? "100%" : 40,
        padding: expanded ? "0 10px" : 0,
        justifyContent: expanded ? "flex-start" : "center",
        gap: 10,
        color: active ? "#1C0A00" : "var(--text-muted)",
        background: active ? ACTIVE_BG : "transparent",
        boxShadow: active
          ? (expanded
              ? "0 8px 20px rgba(245,158,11,0.40), inset 0 1px 0 rgba(255,255,255,0.3)"
              : "0 4px 12px rgba(245,158,11,0.35), inset 0 1px 0 rgba(255,255,255,0.3)")
          : "none",
        fontWeight: 600,
        transition: "background .2s, color .2s, box-shadow .2s, transform .18s",
        animation: animate ? "navIn .4s cubic-bezier(.2,.7,.3,1) both" : undefined,
        animationDelay: animate ? `${delay * 30}ms` : undefined,
      }}
      onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; if (!active) el.style.background = "var(--bg-2)"; if (expanded) el.style.transform = "translateX(2px)"; }}
      onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; if (!active) el.style.background = "transparent"; el.style.transform = "none"; }}
    >
      {active && expanded && <span aria-hidden style={{ position: "absolute", left: -12, top: 9, bottom: 9, width: 3, borderRadius: 3, background: "var(--accent)" }} />}

      <span className="relative grid place-items-center shrink-0 transition-transform duration-200 group-hover:scale-110" style={{ width: 20, height: 20 }}>
        <Icon d={item.icon} size={18} sw={2} />
        {badge > 0 && !expanded && (
          <span style={{ position: "absolute", top: -3, right: -4, width: 8, height: 8, borderRadius: 99, background: "var(--danger)", border: "1.5px solid var(--surface)" }} />
        )}
      </span>

      {expanded && (
        <span className="flex flex-col min-w-0 leading-tight" style={{ whiteSpace: "nowrap" }}>
          <span className="text-[13px] truncate" style={{ letterSpacing: "-0.01em" }}>{item.label}</span>
          {item.desc && <span className="text-[10px] truncate" style={{ color: active ? "rgba(28,10,0,0.62)" : "var(--text-faint)", fontWeight: 500 }}>{item.desc}</span>}
        </span>
      )}

      {expanded && badge > 0 && (
        <span className="ml-auto text-[10px] font-bold px-1.5 rounded-full"
              style={{ minWidth: 18, height: 17, display: "grid", placeItems: "center", background: active ? "rgba(28,10,0,0.18)" : "var(--danger)", color: active ? "#1C0A00" : "#fff" }}>
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </NavLink>
  );
}

/* Floating launcher (bottom-right) that opens the external Log Analyzer in a
   new tab. Renders only when the integration is enabled and a public URL is
   configured — otherwise it stays hidden. Uses LA's violet identity. */
function LogAnalyzerFab() {
  const [hover, setHover] = useState(false);
  const { data } = useQuery({
    queryKey: ["integrations", "log-analyzer"],
    queryFn: async () => (await api.get("/integrations/log-analyzer")).data,
    staleTime: 60_000,
  });
  if (!data?.enabled || !data?.public_url) return null;
  // Compact circular launcher that expands to a labelled pill on hover, so it
  // keeps a small footprint and doesn't blanket page content in the corner.
  return (
    <a
      href={data.public_url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open Log Analyzer in a new tab"
      className="fixed z-40 flex items-center animate-fade-in"
      style={{
        right: 22, bottom: 22, height: 50,
        width: hover ? 192 : 50,
        justifyContent: hover ? "flex-start" : "center",
        paddingLeft: hover ? 16 : 0, paddingRight: hover ? 18 : 0, gap: 10,
        borderRadius: 25, overflow: "hidden", whiteSpace: "nowrap",
        background: "linear-gradient(135deg, #A78BFA 0%, #7C3AED 58%, #6D28D9 100%)",
        color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 13.5,
        boxShadow: hover
          ? "0 18px 44px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.3)"
          : "0 10px 26px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.25)",
        transition: "width .26s cubic-bezier(.2,.8,.2,1), padding .26s, box-shadow .2s",
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="grid place-items-center shrink-0" style={{ width: 22 }}><Icon d="M4 6h16M4 10h16M4 14h10M4 18h13" size={19} sw={2.2} /></span>
      <span style={{ display: "flex", alignItems: "center", gap: 7, opacity: hover ? 1 : 0, transition: "opacity .18s" }}>
        Log Analyzer <Icon d={Icons.external} size={13} sw={2.2} />
      </span>
    </a>
  );
}

export default function Layout() {
  const { email, role, logout } = useAuthStore();
  const nav = useNavigate();
  const loc = useLocation();
  const onLogout = () => { logout(); nav("/login"); };

  const canManageUsers = useAuthStore((s) => s.hasPerm("users.manage"));
  const canManageNotif = useAuthStore((s) => s.hasPerm("notifications.manage"));
  const navItems: NavItem[] = [
    ...NAV,
    ...(canManageNotif ? [{ to: "/telegram-bots", label: "Telegram Bots", icon: Icons.send, group: "Admin", desc: "Notifications" }] : []),
    ...(canManageUsers ? [{ to: "/users", label: "Users", icon: Icons.users, group: "Admin", desc: "Roles & access" }] : []),
  ];

  /* ── Current user (for the real avatar + account menu) ── */
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get("/auth/me")).data,
    staleTime: 60_000,
  });
  const displayName: string = me?.name || (email ? email.split("@")[0] : "Account");

  /* ── Command palette (⌘K) + account menu ── */
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const commandItems: CommandItem[] = navItems.map((i) => ({
    to: i.to, label: i.label, icon: i.icon, group: getPageBreadcrumb(i.to)[0],
  }));

  /* ── Live clock for topbar ── */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ── Collapsible sidebar (clean hard toggle — no hover-peek) ── */
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem("hb-sidebar-collapsed") === "1");
  const expanded = !collapsed;
  const toggleCollapsed = () => setCollapsed((c) => { const n = !c; localStorage.setItem("hb-sidebar-collapsed", n ? "1" : "0"); return n; });

  // Play the staggered nav entrance only on first load — not on every toggle
  // (re-running it each toggle is what looked janky).
  const [animateNav, setAnimateNav] = useState(true);
  useEffect(() => { const t = setTimeout(() => setAnimateNav(false), 1100); return () => clearTimeout(t); }, []);

  // Dark / light theme toggle.
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  const toggleTheme = () => { const next: Theme = theme === "dark" ? "light" : "dark"; setTheme(next); setThemeState(next); };
  const SUN = "M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 7a5 5 0 100 10 5 5 0 000-10z";
  const MOON = "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z";

  const isActive = (to: string, end?: boolean) => (end || to === "/") ? loc.pathname === to : loc.pathname.startsWith(to);

  // Live unacknowledged-alert count for the Alerts nav badge (shares the
  // AlertBell query key, so it's de-duplicated).
  const { data: alertData } = useQuery({
    queryKey: ["alert-count"],
    queryFn: async () => (await api.get("/alerts/count")).data,
    refetchInterval: 10000,
  });
  const alertCount: number = alertData?.count ?? 0;

  // Preserve the source order of groups as they first appear in navItems.
  const groups = useMemo(() => {
    const order: string[] = [];
    const map: Record<string, NavItem[]> = {};
    navItems.forEach((i) => { if (!map[i.group]) { map[i.group] = []; order.push(i.group); } map[i.group].push(i); });
    return order.map((g) => ({ label: g, items: map[g] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers, canManageNotif]);

  // Expanded = docked full-height sidebar; collapsed = a floating icon pill.
  // The content DODGES the sidebar: the left gutter tracks the sidebar's real
  // footprint (docked width when expanded, the floating-pill lane when collapsed)
  // while the right side uses a normal page gutter — so content fills the freed
  // space and widens when the sidebar collapses, instead of sitting in a fixed
  // symmetric gutter.
  const SIDEBAR_W = 180;                          // expanded docked width
  const PAD_X     = 28;                            // page gutter on the open (right) side
  const padLeft   = expanded ? SIDEBAR_W + 24 : 88; // dodge the docked rail / the 60px pill lane

  // Per-item stagger order for the entrance animation.
  const itemDelay: Record<string, number> = {};
  let _i = 0;
  groups.forEach((g) => g.items.forEach((it) => { itemDelay[it.to] = _i++; }));

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {/* ════════ Animated background ════════ */}
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />
      <div className="bg-grid" />

      {/* ════════ Subtle mouse-reactive particles (background layer, behind content) ════════ */}
      <ParticleCanvas subtle z={0} />

      {/* ════════ Collapsible sidebar — docked when expanded, floating pill when collapsed ════════ */}
      <aside
        className="fixed z-50 flex flex-col animate-fade-in"
        style={expanded ? {
          left: 0, top: 64, bottom: 0, width: SIDEBAR_W,
          background: "var(--surface)",
          borderRight: "1px solid var(--border)",
          boxShadow: "0 1px 2px var(--shadow)",
          userSelect: "none",
        } : {
          left: 14, top: "50%", transform: "translateY(-50%)", width: 60,
          maxHeight: "calc(100vh - 170px)",
          background: "var(--glass-strong)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          border: "1px solid var(--border)",
          borderRadius: 22,
          boxShadow: "0 16px 48px var(--shadow), 0 2px 6px var(--shadow), inset 0 1px 0 var(--border-2)",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        {/* nav groups */}
        {expanded ? (
          /* Expanded: grouped, labeled rows */
          <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3 space-y-1">
            {groups.map((g) => (
              <div key={g.label} className="pb-1">
                <div className="px-2.5 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.13em] whitespace-nowrap" style={{ color: "var(--text-faint)" }}>{g.label}</div>
                <div className="space-y-0.5">
                  {g.items.map((item) => (
                    <SideItem key={item.to} item={item} expanded active={isActive(item.to, item.end)} delay={itemDelay[item.to]} badge={item.to === "/alerts" ? alertCount : 0} animate={animateNav} />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        ) : (
          /* Collapsed: a single uniform icon rail (no group dividers) */
          <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 flex flex-col items-center gap-1">
            {navItems.map((item) => (
              <SideItem key={item.to} item={item} expanded={false} active={isActive(item.to, item.end)} delay={itemDelay[item.to]} badge={item.to === "/alerts" ? alertCount : 0} animate={animateNav} />
            ))}
          </nav>
        )}

        {/* collapse toggle — inside the sidebar only when expanded */}
        {expanded && (
          <div className="py-3 px-3" style={{ borderTop: "1px solid var(--border)" }}>
            <button
              onClick={toggleCollapsed}
              title="Collapse sidebar"
              className="flex items-center rounded-[12px] outline-none w-full"
              style={{ height: 40, padding: "0 10px", gap: 10, color: "var(--text-faint)", background: "transparent", cursor: "pointer", border: "none", fontWeight: 600, transition: "background .18s, color .18s" }}
              onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "var(--bg-2)"; el.style.color = "var(--text-muted)"; }}
              onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "var(--text-faint)"; }}
            >
              <span className="grid place-items-center shrink-0"><Icon d="M15 18l-6-6 6-6" size={18} sw={2.4} /></span>
              <span className="text-[12.5px]" style={{ whiteSpace: "nowrap" }}>Collapse</span>
            </button>
          </div>
        )}
      </aside>

      {/* Floating expand button — aligned with the icon pill, but its own floating element */}
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar"
          className="fixed z-50 grid place-items-center animate-fade-in"
          style={{
            left: 14, bottom: 24, width: 60, height: 46, borderRadius: 18,
            background: "var(--glass-strong)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
            border: "1px solid var(--border)",
            boxShadow: "0 12px 32px var(--shadow), 0 2px 6px var(--shadow), inset 0 1px 0 var(--border-2)",
            color: "var(--text-faint)", cursor: "pointer",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--text-faint)"; }}
        >
          <Icon d="M9 18l6-6-6-6" size={18} sw={2.4} />
        </button>
      )}

      {/* ════════ Fixed Glass Topbar ════════ */}
      <header className="fixed top-0 left-0 right-0 h-16 z-40 flex items-center justify-between pr-6"
              style={{
                background: "var(--glass)",
                backdropFilter: "blur(14px)",
                borderBottom: "1px solid var(--border)",
              }}>

        {/* Logo + Title + Breadcrumb */}
        <div className="flex items-center min-w-0">
          <Link to="/" className="flex items-center gap-2.5 shrink-0 hover:opacity-90 transition-opacity"
                style={{ paddingLeft: 22 }}>
            <img src={logoUrl} alt="HoneyBee" className="h-8 w-8 object-contain"
                 style={{ filter: "drop-shadow(0 2px 6px rgba(245,158,11,0.35))" }} />
            <span className="text-[17px] font-extrabold tracking-tight text-shimmer">HoneyBee</span>
          </Link>
          {/* floating divider */}
          <span aria-hidden style={{ width: 1.5, height: 22, borderRadius: 99, background: "var(--border-2)", margin: "0 16px", flexShrink: 0 }} />
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight whitespace-nowrap" style={{ color: "var(--text)" }}>
              {getPageTitle(loc.pathname)}
            </h2>
            {getPageBreadcrumb(loc.pathname).map((b, i) => (
              <span key={i} className="hidden md:inline-flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: "var(--text-faint)" }}>
                <span style={{ color: "var(--border-2)" }}>/</span>{b}
              </span>
            ))}
          </div>
        </div>

        {/* Right side: search + clock + bell + account menu */}
        <div className="flex items-center gap-2.5">
          {/* Command palette trigger — interactive search field */}
          <button
            onClick={() => setPaletteOpen(true)}
            title={`Search (${MOD_KEY}+K)`}
            className="hidden sm:flex items-center gap-2.5 pl-3.5 pr-2 h-9 rounded-xl outline-none"
            style={{
              minWidth: 234,
              color: "var(--text-faint)",
              background: "linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%)",
              border: "1px solid var(--border-2)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
              transition: "border-color .18s, box-shadow .18s, color .18s",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "rgba(245,158,11,0.55)";
              el.style.color = "var(--accent)";
              el.style.boxShadow = "0 0 0 3px rgba(245,158,11,0.10), inset 0 1px 0 rgba(255,255,255,0.05)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget;
              el.style.borderColor = "var(--border-2)";
              el.style.color = "var(--text-faint)";
              el.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.04)";
            }}
          >
            {/* icon inherits the button color (shifts to amber on hover) */}
            <span className="grid place-items-center shrink-0"><Icon d={Icons.search} size={15} sw={2.2} /></span>
            <span className="text-[12.5px] font-medium flex-1 text-left" style={{ color: "var(--text-muted)" }}>Search commands, pages…</span>
            <span className="flex items-center gap-1 shrink-0">
              <kbd className="grid place-items-center text-[10px] font-bold rounded-md"
                   style={{ minWidth: 22, height: 19, padding: "0 6px", background: "var(--surface)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}>{MOD_KEY}</kbd>
              <kbd className="grid place-items-center text-[10px] font-bold rounded-md"
                   style={{ width: 19, height: 19, background: "var(--surface)", border: "1px solid var(--border-2)", color: "var(--text-muted)" }}>K</kbd>
            </span>
          </button>

          {/* Live clock */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full"
               style={{ background: "var(--warn-bg)", border: "1px solid var(--warn-bg)" }}>
            <Icon d={Icons.clock} size={12} color="var(--accent)" />
            <span className="text-[11.5px] font-bold tabular-nums" style={{ color: "var(--accent)" }}>
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>

          {/* Theme toggle */}
          <button onClick={toggleTheme} className="icon-btn" title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            <Icon d={theme === "dark" ? SUN : MOON} size={16} />
          </button>

          {/* Alert bell */}
          <AlertBell />

          {/* Account menu */}
          <div className="relative" ref={menuRef}>
            <button onClick={() => setMenuOpen((v) => !v)}
                    className="flex items-center gap-2.5 pl-1 pr-2.5 py-1 rounded-full transition-all"
                    style={{ background: menuOpen ? "var(--warn-bg)" : "var(--bg-2)", border: `1px solid ${menuOpen ? "var(--accent)" : "var(--border)"}` }}>
              {me?.avatar
                ? <img src={me.avatar} alt="" className="h-7 w-7 rounded-full object-cover" style={{ boxShadow: "0 2px 6px var(--shadow)" }} />
                : <div className="h-7 w-7 rounded-full grid place-items-center text-[11px] font-bold glow-amber"
                       style={{ background: "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)", color: "#1C0A00" }}>
                    {(displayName ?? "?").charAt(0).toUpperCase()}
                  </div>}
              <div className="hidden sm:flex flex-col leading-none text-left">
                <span className="text-[11.5px] font-semibold truncate" style={{ color: "var(--text)", maxWidth: 140 }}>{displayName}</span>
                <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] mt-0.5" style={{ color: "var(--text-faint)" }}>{role ?? "—"}</span>
              </div>
              <Icon d={Icons.arrowDown} size={13} color="var(--text-faint)" style={{ transform: menuOpen ? "rotate(180deg)" : "none" }} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 card animate-fade-up"
                   style={{ width: 248, zIndex: 50, padding: 0, overflow: "hidden" }}>
                {/* identity header */}
                <div className="flex items-center gap-3 p-3.5" style={{ borderBottom: "1px solid var(--border)" }}>
                  {me?.avatar
                    ? <img src={me.avatar} alt="" className="h-10 w-10 rounded-xl object-cover" />
                    : <div className="h-10 w-10 rounded-xl grid place-items-center text-[14px] font-bold glow-amber"
                           style={{ background: "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)", color: "#1C0A00" }}>
                        {(displayName ?? "?").charAt(0).toUpperCase()}
                      </div>}
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate" style={{ color: "var(--text)" }}>{displayName}</div>
                    <div className="text-[11.5px] truncate" style={{ color: "var(--text-muted)" }}>{email}</div>
                  </div>
                </div>
                {/* role chip */}
                <div className="px-3.5 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                  <span className="badge badge-admin" style={{ textTransform: "capitalize" }}>
                    <Icon d={Icons.shield} size={11} /> {role ?? "—"}
                  </span>
                </div>
                {/* actions */}
                <div className="p-1.5">
                  {canManageUsers && (
                    <button onClick={() => { setMenuOpen(false); nav("/users"); }}
                            className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:bg-[var(--bg-2)]"
                            style={{ color: "var(--text)", border: "none", background: "transparent", cursor: "pointer" }}>
                      <Icon d={Icons.users} size={15} color="var(--text-muted)" /> Manage users
                    </button>
                  )}
                  <button onClick={() => { setMenuOpen(false); window.location.reload(); }}
                          className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors hover:bg-[var(--bg-2)]"
                          style={{ color: "var(--text)", border: "none", background: "transparent", cursor: "pointer" }}>
                    <Icon d={Icons.refresh} size={15} color="var(--text-muted)" /> Refresh data
                  </button>
                  <button onClick={() => { setMenuOpen(false); onLogout(); }}
                          className="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg text-[13px] font-semibold transition-colors hover:bg-[var(--danger-bg)]"
                          style={{ color: "var(--danger)", border: "none", background: "transparent", cursor: "pointer" }}>
                    <Icon d={Icons.logout} size={15} /> Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {paletteOpen && (
        <CommandPalette items={commandItems} onNavigate={(to) => nav(to)} onClose={() => setPaletteOpen(false)} />
      )}

      {/* ════════ Content area ════════ */}
      {/* Content dodges the sidebar: left gutter tracks the sidebar footprint and
          animates when it collapses; the right side is a normal page gutter so
          content reclaims the freed width. max-width keeps it readable on wide
          screens, centered within the available area. */}
      <main className="bg-layer pt-16 min-h-screen animate-fade-in"
            style={{ paddingLeft: padLeft, paddingRight: PAD_X, transition: "padding-left .28s cubic-bezier(.2,.8,.2,1)" }}>
        <div className="py-7 max-w-[1400px] mx-auto" style={{ paddingBottom: 96 }}>
          <Outlet />
        </div>
      </main>

      {/* Floating Log Analyzer launcher (bottom-right) — hidden when LA is off */}
      <LogAnalyzerFab />
    </div>
  );
}
