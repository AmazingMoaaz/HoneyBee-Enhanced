import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../stores/auth";
import api from "../api/client";
import logoUrl from "../assets/logo.png";
import ParticleCanvas from "./ParticleCanvas";
import { Icon, Icons } from "./Icons";

/* ─────────────────────────────────────────────────────────────────
   App shell — floating sidebar + glass topbar + animated background
   Enhancements:
     • Sliding morph indicator behind active nav item
     • Floating right-side label tooltip with arrow
     • Mouse-tracked subtle particle field on entire app
     • Topbar shows live time + connection breadcrumb
─────────────────────────────────────────────────────────────────── */

const NAV = [
  { to: "/",           label: "Dashboard",      icon: Icons.hex,          end: true },
  { to: "/nodes",      label: "Nodes",          icon: Icons.server },
  { to: "/events",     label: "Events",         icon: Icons.activity },
  { to: "/analytics",  label: "Analytics",      icon: Icons.chart },
  { to: "/alerts",     label: "Alerts",         icon: Icons.bell },
  { to: "/potstore",   label: "HoneyBee Store", icon: Icons.honeypot },
  { to: "/audit-log",  label: "Audit Log",      icon: Icons.clipboard },
  { to: "/system",     label: "System Check",   icon: Icons.shield },
  { to: "/topology",   label: "Draft Topology", icon: Icons.network },
];

function getPageTitle(pathname: string): string {
  if (pathname === "/")                  return "Dashboard";
  if (pathname.startsWith("/nodes"))     return "Node Manager";
  if (pathname.startsWith("/events"))    return "Event Stream";
  if (pathname.startsWith("/analytics")) return "Attack Analytics";
  if (pathname.startsWith("/alerts"))    return "Alerts";
  if (pathname.startsWith("/audit-log")) return "Audit Log";
  if (pathname.startsWith("/potstore"))  return "HoneyBee Store";
  if (pathname.startsWith("/system"))    return "System Check";
  if (pathname.startsWith("/topology"))  return "Draft Topology";
  if (pathname.startsWith("/users"))     return "User Management";
  return "HoneyBee";
}

function getPageBreadcrumb(pathname: string): string[] {
  if (pathname === "/")                   return ["Home"];
  if (pathname.startsWith("/nodes/"))     return ["Fleet", "Node detail"];
  if (pathname.startsWith("/nodes"))      return ["Fleet"];
  if (pathname.startsWith("/events"))     return ["Telemetry"];
  if (pathname.startsWith("/analytics"))  return ["Intelligence"];
  if (pathname.startsWith("/alerts"))     return ["Security"];
  if (pathname.startsWith("/audit-log"))  return ["Security"];
  if (pathname.startsWith("/potstore"))   return ["Catalog"];
  if (pathname.startsWith("/system"))     return ["Diagnostics"];  if (pathname.startsWith("/topology"))    return ["Design"];  if (pathname.startsWith("/users"))      return ["Admin"];
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
              style={{ background: "#EF4444", color: "#FFF", boxShadow: "0 2px 6px rgba(239,68,68,0.4)" }}>
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

export default function Layout() {
  const { email, role, logout } = useAuthStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [hovered, setHovered] = useState<string | null>(null);
  const onLogout = () => { logout(); nav("/login"); };

  const navItems = [...NAV, ...(role === "admin" ? [{ to: "/users", label: "Users", icon: Icons.users }] : [])];

  /* ── Live clock for topbar ── */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ── Sliding active indicator (per-item refs for reliability) ── */
  const railRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pill, setPill] = useState<{ top: number; height: number; opacity: number }>({
    top: 0, height: 44, opacity: 0,
  });
  const [hoverPill, setHoverPill] = useState<{ top: number; height: number; opacity: number }>({
    top: 0, height: 44, opacity: 0,
  });

  const activeKey = (() => {
    const found = navItems.find(i =>
      i.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(i.to)
    );
    return found?.to ?? null;
  })();

  const measure = (key: string | null, set: typeof setPill) => {
    const rail = railRef.current;
    if (!rail || !key) { set(s => ({ ...s, opacity: 0 })); return; }
    const node = itemRefs.current[key];
    if (!node) { set(s => ({ ...s, opacity: 0 })); return; }
    const r = rail.getBoundingClientRect();
    const n = node.getBoundingClientRect();
    set({ top: n.top - r.top, height: n.height, opacity: 1 });
  };

  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => measure(activeKey, setPill));
    return () => cancelAnimationFrame(id);
  }, [activeKey, role]);

  useEffect(() => {
    const onResize = () => measure(activeKey, setPill);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeKey]);

  useEffect(() => {
    if (hovered && hovered !== activeKey) measure(hovered, setHoverPill);
    else setHoverPill(s => ({ ...s, opacity: 0 }));
  }, [hovered, activeKey]);

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC" }}>

      {/* ════════ Animated background ════════ */}
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />
      <div className="bg-grid" />

      {/* ════════ Subtle mouse-reactive particles ════════ */}
      <ParticleCanvas subtle />

      {/* ════════ Floating Pill Sidebar ════════ */}
      <aside className="fixed left-4 top-1/2 -translate-y-1/2 z-50">
        <div
          ref={railRef}
          className="relative flex flex-col items-center gap-1.5 p-2 rounded-[20px]"
          style={{
            background: "rgba(255,255,255,0.94)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            border: "1px solid rgba(15,23,42,0.07)",
            boxShadow:
              "0 12px 44px rgba(15,23,42,0.12), 0 1px 2px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.6)",
          }}
          onMouseLeave={() => setHovered(null)}
        >
          {/* Hover ghost pill (slate, faint) */}
          <div
            aria-hidden
            style={{
              position: "absolute", left: 8, right: 8,
              top: hoverPill.top, height: hoverPill.height,
              background: "rgba(15,23,42,0.05)",
              borderRadius: 14,
              opacity: hoverPill.opacity,
              transition:
                "top .28s cubic-bezier(.5,1.4,.4,1), height .28s cubic-bezier(.5,1.4,.4,1), opacity .18s",
              zIndex: 0,
              pointerEvents: "none",
            }}
          />

          {/* Active amber pill */}
          <div
            aria-hidden
            style={{
              position: "absolute", left: 8, right: 8,
              top: pill.top, height: pill.height,
              background:
                "linear-gradient(135deg, #FCD34D 0%, #F59E0B 55%, #D97706 100%)",
              borderRadius: 14,
              boxShadow:
                "0 8px 22px rgba(245,158,11,0.45), 0 2px 6px rgba(217,119,6,0.35), inset 0 1px 0 rgba(255,255,255,0.32)",
              opacity: pill.opacity,
              transition:
                "top .38s cubic-bezier(.5,1.4,.4,1), height .38s cubic-bezier(.5,1.4,.4,1), opacity .25s",
              zIndex: 0,
              pointerEvents: "none",
            }}
          />

          {navItems.map((item) => {
            const active = item.to === activeKey;
            return (
              <div
                key={item.to}
                ref={el => { itemRefs.current[item.to] = el; }}
                className="relative"
                style={{ zIndex: 1 }}
                onMouseEnter={() => setHovered(item.to)}
              >
                <NavLink
                  to={item.to}
                  end={(item as any).end}
                  aria-label={item.label}
                  className="flex h-11 w-11 items-center justify-center rounded-[14px] outline-none transition-all"
                  style={{
                    background: "transparent",
                    color: active ? "#1C0A00" : "#64748B",
                    transform: active ? "scale(1.04)" : "scale(1)",
                  }}
                  onFocus={e => (e.currentTarget as HTMLElement).style.boxShadow =
                    "0 0 0 2px rgba(245,158,11,0.55)"}
                  onBlur={e => (e.currentTarget as HTMLElement).style.boxShadow = "none"}
                >
                  <Icon d={item.icon} size={19} sw={2} />
                </NavLink>

                {/* Hover tooltip with arrow */}
                {hovered === item.to && (
                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-4 z-50 pointer-events-none"
                       style={{ animation: "fade-up .18s ease-out both" }}>
                    <div className="flex items-center px-3 py-1.5 rounded-lg whitespace-nowrap text-[12px] font-semibold relative"
                         style={{
                           background: "#0F172A",
                           color: "#FFFFFF",
                           boxShadow: "0 10px 26px rgba(15,23,42,0.30)",
                         }}>
                      {item.label}
                      <div style={{
                        position: "absolute", left: -4, top: "50%",
                        transform: "translateY(-50%) rotate(45deg)",
                        width: 8, height: 8, background: "#0F172A",
                      }} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      {/* ════════ Fixed Glass Topbar ════════ */}
      <header className="fixed top-0 left-0 right-0 h-16 z-40 flex items-center justify-between px-6"
              style={{
                background: "rgba(255,255,255,0.78)",
                backdropFilter: "blur(14px)",
                borderBottom: "1px solid rgba(15,23,42,0.06)",
              }}>

        {/* Logo + Title + Breadcrumb */}
        <div className="flex items-center min-w-0">
          <Link to="/" className="flex items-center gap-2.5 mr-5 hover:opacity-90 transition-opacity">
            <img src={logoUrl} alt="HoneyBee" className="h-9 w-9 object-contain"
                 style={{ filter: "drop-shadow(0 2px 6px rgba(245,158,11,0.35))" }} />
            <span className="text-[18px] font-extrabold tracking-tight text-shimmer">HoneyBee</span>
          </Link>
          <div className="h-6 w-px mx-1" style={{ background: "rgba(15,23,42,0.1)" }} />
          <div className="ml-4 flex items-center gap-2 min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight whitespace-nowrap" style={{ color: "#0F172A" }}>
              {getPageTitle(loc.pathname)}
            </h2>
            {getPageBreadcrumb(loc.pathname).map((b, i) => (
              <span key={i} className="hidden md:inline-flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.08em]"
                    style={{ color: "#94A3B8" }}>
                <span style={{ color: "#CBD5E1" }}>/</span>{b}
              </span>
            ))}
          </div>
        </div>

        {/* Right side: clock + user pill + actions */}
        <div className="flex items-center gap-3">
          {/* Live clock */}
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full"
               style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.18)" }}>
            <Icon d={Icons.clock} size={12} color="#B45309" />
            <span className="text-[11.5px] font-bold tabular-nums" style={{ color: "#B45309" }}>
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>

          {/* Alert bell */}
          <AlertBell />

          {/* User pill */}
          <div className="flex items-center gap-2.5 pl-2 pr-3 py-1 rounded-full"
               style={{ background: "#F8FAFC", border: "1px solid rgba(15,23,42,0.08)" }}>
            <div className="h-7 w-7 rounded-full grid place-items-center text-[11px] font-bold glow-amber"
                 style={{ background: "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)", color: "#1C0A00" }}>
              {(email ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[11.5px] font-semibold" style={{ color: "#0F172A" }}>{email ?? "Guest"}</span>
              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] mt-0.5" style={{ color: "#94A3B8" }}>{role ?? "—"}</span>
            </div>
          </div>

          <div className="h-6 w-px" style={{ background: "rgba(15,23,42,0.08)" }} />

          <button onClick={() => window.location.reload()} title="Refresh" className="icon-btn">
            <Icon d={Icons.refresh} size={16} />
          </button>
          <button onClick={onLogout} title="Sign out" className="icon-btn icon-btn-danger">
            <Icon d={Icons.logout} size={16} />
          </button>
        </div>
      </header>

      {/* ════════ Content area ════════ */}
      <main className="bg-layer pl-[88px] pt-16 min-h-screen animate-fade-in">
        <div className="p-7 max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
