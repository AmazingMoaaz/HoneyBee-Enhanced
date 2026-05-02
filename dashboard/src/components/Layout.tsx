import { Link, Outlet, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

export default function Layout() {
  const { email, role, logout } = useAuthStore();
  const nav = useNavigate();

  const onLogout = () => {
    logout();
    nav("/login");
  };

  const linkCls = "block px-3 py-2 rounded hover:bg-slate-800 text-slate-300 hover:text-honey-400";

  return (
    <div className="flex h-full">
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800">
          <h1 className="text-honey-400 font-bold text-lg">HoneyBee</h1>
          <p className="text-xs text-slate-500">Enhanced</p>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-1">
          <Link to="/" className={linkCls}>Dashboard</Link>
          <Link to="/nodes" className={linkCls}>Nodes</Link>
          <Link to="/deployments" className={linkCls}>Deployments</Link>
          <Link to="/events" className={linkCls}>Events</Link>
          <Link to="/sessions" className={linkCls}>Sessions</Link>
          <Link to="/potstore" className={linkCls}>PotStore</Link>
          {role === "admin" && <Link to="/users" className={linkCls}>Users</Link>}
        </nav>
        <div className="px-3 py-3 border-t border-slate-800 text-xs">
          <div className="text-slate-400">{email}</div>
          <div className="text-slate-500">role: {role}</div>
          <button onClick={onLogout} className="mt-2 text-honey-400 hover:underline">Sign out</button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
