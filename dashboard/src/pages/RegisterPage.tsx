import { FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import logoUrl from "../assets/logo.png";
import ParticleCanvas, { HoneycombGrid } from "../components/ParticleCanvas";
import { LIGHT_THEME_VARS } from "./LoginPage";

export default function RegisterPage() {
  const [orgName, setOrgName] = useState("");
  const [name,    setName]    = useState("");
  const [email,   setEmail]   = useState("");
  const [pw,      setPw]      = useState("");
  const [err,     setErr]     = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const register = useAuthStore((s) => s.register);
  const nav      = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null); setLoading(true);
    try { await register(orgName, email, pw, name); nav("/"); }
    catch (e: any) { setErr(e?.response?.data?.error ?? e.message ?? "Registration failed"); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", overflow:"hidden", background:"#FFFFFF", ...LIGHT_THEME_VARS }}>

      {/* ── Mouse-reactive floating particles ── */}
      <ParticleCanvas />

      {/* ════ LEFT — Dark amber honeycomb hero panel (58%) ════ */}
      <div
        className="hidden lg:flex"
        style={{
          width:"58%", position:"relative", flexDirection:"column",
          alignItems:"center", justifyContent:"center", overflow:"hidden",
          background:"linear-gradient(135deg, #0C0500 0%, #1C0A00 28%, #431407 62%, #7C2D12 100%)",
          zIndex:2,
        }}
      >
        <HoneycombGrid />

        <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
          <div style={{ position:"absolute", top:"-15%", right:"-10%", width:520, height:520, borderRadius:"50%",
                        background:"radial-gradient(circle, rgba(245,158,11,0.3) 0%, transparent 65%)", filter:"blur(64px)" }} />
          <div style={{ position:"absolute", bottom:"-12%", left:"-6%", width:400, height:400, borderRadius:"50%",
                        background:"radial-gradient(circle, rgba(217,119,6,0.24) 0%, transparent 65%)", filter:"blur(52px)" }} />
        </div>

        <div style={{ position:"relative", zIndex:10, display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", padding:"0 56px" }}>
          <img src={logoUrl} alt="HoneyBee"
               style={{ height:128, width:128, objectFit:"contain", marginBottom:28,
                        filter:"drop-shadow(0 18px 44px rgba(245,158,11,0.7))" }} />
          <h1 style={{ fontSize:38, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1.15, color:"#FFFFFF", margin:"0 0 16px",
                        textShadow:"0 2px 24px rgba(245,158,11,0.55), 0 1px 2px rgba(0,0,0,0.4)" }}>
            Start Defending<br />Intelligently
          </h1>
          <p style={{ fontSize:15, lineHeight:1.8, color:"rgba(255,255,255,0.88)", maxWidth:320,
                       textShadow:"0 1px 4px rgba(0,0,0,0.35)" }}>
            Create your organisation and deploy honeypots in minutes. Every attacker interaction is captured and logged.
          </p>
        </div>
      </div>

      {/* ════ RIGHT — Register form ════ */}
      <div style={{
        flex:1, display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding:"32px 40px", background:"var(--surface)", position:"relative", zIndex:2,
      }}>
        <div className="lg:hidden" style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:28 }}>
          <img src={logoUrl} alt="HoneyBee"
               style={{ height:56, width:56, objectFit:"contain", marginBottom:10,
                        filter:"drop-shadow(0 6px 16px rgba(245,158,11,0.45))" }} />
          <span style={{ fontSize:18, fontWeight:900, color:"var(--text)" }}>HoneyBee</span>
        </div>

        <div style={{ width:"100%", maxWidth:440 }} className="animate-float-up">
          <h2 style={{ fontSize:28, fontWeight:900, letterSpacing:"-0.03em", color:"var(--text)", margin:"0 0 5px" }}>
            Create account
          </h2>
          <p style={{ fontSize:14, color:"var(--text-muted)", margin:"0 0 26px" }}>
            Register your organisation to get started.
          </p>

          <form onSubmit={onSubmit} style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
              <div>
                <label className="input-label">Organisation</label>
                <input className="input" placeholder="Acme Security" value={orgName}
                       onChange={e => setOrgName(e.target.value)} required />
              </div>
              <div>
                <label className="input-label">Your name</label>
                <input className="input" placeholder="Jane Doe" value={name}
                       onChange={e => setName(e.target.value)} required />
              </div>
            </div>
            <div>
              <label className="input-label">Email</label>
              <input className="input" type="email" placeholder="you@example.com" value={email}
                     onChange={e => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="input-label">Password</label>
              <input className="input" type="password" placeholder="••••••••" value={pw}
                     onChange={e => setPw(e.target.value)} required />
            </div>
            {err && (
              <div style={{ background:"var(--danger-bg)", border:"1px solid var(--border)", color:"var(--danger)",
                            borderRadius:10, padding:"10px 14px", fontSize:13, fontWeight:500 }}>
                {err}
              </div>
            )}
            <button type="submit" className="btn btn-primary" disabled={loading}
                    style={{ padding:"13px 0", fontSize:14.5, marginTop:4 }}>
              {loading ? "Creating…" : "Create organisation"}
            </button>
          </form>

          <p style={{ marginTop:20, textAlign:"center", fontSize:13, color:"var(--text-muted)" }}>
            Already have an account?{" "}
            <Link to="/login" style={{ color:"var(--accent)", fontWeight:700 }}>Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
