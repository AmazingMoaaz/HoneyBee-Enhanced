import { Link, NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { useAuthStore } from "../stores/auth";
import logoUrl from "../assets/logo.png";
import ParticleCanvas from "./ParticleCanvas";

/* ── Inline SVG icons (no extra deps) ───────────── */
const Icon = ({ d, className = "" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={`w-[18px] h-[18px] ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const I = {
  dashboard:   "M3 12L12 3l9 9M5 10v10h14V10",
  nodes:       "M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18",
  deploy:      "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  events:      "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
  sessions:    "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM8 12h.01M12 12h.01M16 12h.01",
  potstore:    "M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4",
  users:       "M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0",
  refresh:     "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  logout:      "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  system:      "M9 12l2 2 4-4M12 22a10 10 0 110-20 10 10 0 010 20z",
};

const NAV = [
  { to: "/",         label: "Dashboard",      icon: I.dashboard, end: true },
  { to: "/nodes",    label: "Nodes",          icon: I.nodes },
  { to: "/events",   label: "Events",         icon: I.events },
  { to: "/potstore", label: "HoneyBee Store", icon: I.potstore },
  { to: "/system",   label: "System Check",   icon: I.system },
];

function getPageTitle(pathname: string): string {
  if (pathname === "/")                 return "Dashboard";
  if (pathname.startsWith("/nodes"))    return "Node Manager";
  if (pathname.startsWith("/events"))   return "Event Stream";
  if (pathname.startsWith("/potstore")) return "HoneyBee Store";
  if (pathname.startsWith("/system"))   return "System Check";
  if (pathname.startsWith("/users"))    return "User Management";
  return "HoneyBee";
}

export default function Layout() {
  const { email, role, logout } = useAuthStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [hovered, setHovered] = useState<string | null>(null);
  const onLogout = () => { logout(); nav("/login"); };

  const navItems = [...NAV, ...(role === "admin" ? [{ to: "/users", label: "Users", icon: I.users }] : [])];

  return (
    <div className="min-h-screen" style={{ background: "#F8FAFC" }}>

      {/* ════════ Animated background ════════ */}
      <div className="bg-orb bg-orb-1" />
      <div className="bg-orb bg-orb-2" />
      <div className="bg-orb bg-orb-3" />
      <div className="bg-grid" />

      {/* ════════ Subtle mouse-reactive particles ════════ */}
      <ParticleCanvas subtle />

      {/* ════════ Floating Pill Sidebar (left center) ════════ */}
      <aside className="fixed left-4 top-1/2 -translate-y-1/2 z-50">
        <div className="flex flex-col items-center gap-2 p-2.5 rounded-2xl"
             style={{
               background: "rgba(255,255,255,0.92)",
               backdropFilter: "blur(16px)",
               border: "1px solid rgba(15,23,42,0.07)",
               boxShadow: "0 10px 40px rgba(15,23,42,0.1), 0 1px 2px rgba(15,23,42,0.05)",
             }}>
          {navItems.map((item) => {
            const active = item.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(item.to);
            return (
              <div key={item.to} className="relative"
                   onMouseEnter={() => setHovered(item.to)}
                   onMouseLeave={() => setHovered(null)}>
                <NavLink to={item.to} end={(item as any).end}
                  className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={active
                    ? { background: "linear-gradient(135deg, #FCD34D 0%, #F59E0B 55%, #D97706 100%)",
                        color: "#1C0A00",
                        boxShadow: "0 4px 14px rgba(245,158,11,0.45), inset 0 1px 0 rgba(255,255,255,0.28)" }
                    : { background: "transparent", color: "#64748B" }
                  }
                  onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "#F1F5F9"; }}
                  onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <Icon d={item.icon} />
                </NavLink>

                {/* Floating label tooltip */}
                {hovered === item.to && (
                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 z-50 animate-float-up pointer-events-none">
                    <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg whitespace-nowrap text-[12.5px] font-semibold"
                         style={{
                           background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
                           color: "#1C0A00",
                           boxShadow: "0 8px 22px rgba(245,158,11,0.4)",
                         }}>
                      {item.label}
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

        {/* Logo + Title */}
        <div className="flex items-center">
          <Link to="/" className="flex items-center gap-2.5 mr-5 hover:opacity-85">
            <img src={logoUrl} alt="HoneyBee" className="h-9 w-9 object-contain"
                 style={{ filter: "drop-shadow(0 2px 6px rgba(245,158,11,0.35))" }} />
            <span className="text-[18px] font-extrabold tracking-tight text-shimmer">HoneyBee</span>
          </Link>
          <div className="h-6 w-px mx-1" style={{ background: "rgba(15,23,42,0.1)" }} />
          <h2 className="text-[15px] font-semibold ml-4 tracking-tight" style={{ color: "#0F172A" }}>
            {getPageTitle(loc.pathname)}
          </h2>
        </div>

        {/* User pill + actions */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 pl-2 pr-3 py-1 rounded-full"
               style={{ background: "#F8FAFC", border: "1px solid rgba(15,23,42,0.08)" }}>
            <div className="h-7 w-7 rounded-full grid place-items-center text-[11px] font-bold"
                 style={{ background: "linear-gradient(135deg, #FCD34D 0%, #F59E0B 100%)", color: "#1C0A00", boxShadow: "0 2px 6px rgba(245,158,11,0.35)" }}>
              {(email ?? "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[11.5px] font-semibold" style={{ color: "#0F172A" }}>{email ?? "Guest"}</span>
              <span className="text-[9.5px] font-bold uppercase tracking-[0.1em] mt-0.5" style={{ color: "#94A3B8" }}>{role ?? "—"}</span>
            </div>
          </div>

          <div className="h-6 w-px" style={{ background: "rgba(15,23,42,0.08)" }} />

          <button onClick={() => window.location.reload()} title="Refresh"
                  className="h-9 w-9 grid place-items-center rounded-full hover:bg-slate-100"
                  style={{ color: "#64748B" }}>
            <Icon d={I.refresh} />
          </button>
          <button onClick={onLogout} title="Sign out"
                  className="h-9 w-9 grid place-items-center rounded-full"
                  style={{ color: "#EF4444" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <Icon d={I.logout} />
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
