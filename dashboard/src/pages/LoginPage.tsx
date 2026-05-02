import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const login = useAuthStore((s) => s.login);
  const nav = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await login(email, pw);
      nav("/");
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e.message ?? "login failed");
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-slate-950">
      <form onSubmit={onSubmit} className="w-80 bg-slate-900 p-6 rounded-lg border border-slate-800 space-y-4">
        <h1 className="text-2xl text-honey-400 font-bold">HoneyBee Login</h1>
        <input className="w-full bg-slate-800 px-3 py-2 rounded" placeholder="Email"
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" className="w-full bg-slate-800 px-3 py-2 rounded" placeholder="Password"
               value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="w-full bg-honey-500 hover:bg-honey-600 text-slate-900 font-bold py-2 rounded">
          Sign in
        </button>
        <p className="text-sm text-slate-400 text-center">
          New org? <Link to="/register" className="text-honey-400">Register</Link>
        </p>
      </form>
    </div>
  );
}
