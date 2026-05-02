import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";

export default function RegisterPage() {
  const [orgName, setOrgName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const register = useAuthStore((s) => s.register);
  const nav = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await register(orgName, email, pw, name);
      nav("/");
    } catch (e: any) {
      setErr(e?.response?.data?.error ?? e.message);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center">
      <form onSubmit={onSubmit} className="w-96 bg-slate-900 p-6 rounded-lg border border-slate-800 space-y-3">
        <h1 className="text-2xl text-honey-400 font-bold">Create organization</h1>
        <input className="w-full bg-slate-800 px-3 py-2 rounded" placeholder="Organization name"
               value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        <input className="w-full bg-slate-800 px-3 py-2 rounded" placeholder="Your name"
               value={name} onChange={(e) => setName(e.target.value)} />
        <input className="w-full bg-slate-800 px-3 py-2 rounded" placeholder="Email"
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" className="w-full bg-slate-800 px-3 py-2 rounded" placeholder="Password"
               value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="w-full bg-honey-500 hover:bg-honey-600 text-slate-900 font-bold py-2 rounded">
          Create
        </button>
        <p className="text-sm text-slate-400 text-center">
          Have account? <Link to="/login" className="text-honey-400">Login</Link>
        </p>
      </form>
    </div>
  );
}
