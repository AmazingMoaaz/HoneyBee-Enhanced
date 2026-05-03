import { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../stores/auth";
import logoUrl from "../assets/logo.png";
import ParticleCanvas, { HoneycombGrid } from "../components/ParticleCanvas";

export default function LoginPage() {
  const [email, setEmail]     = useState("");
  const [pass, setPass]       = useState("");
  const [err, setErr]         = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const nav = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      await login(email, pass);
      nav("/");
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? "Invalid credentials");
    } finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", overflow: "hidden", background: "#FFFFFF" }}>

      {/* ── Mouse-reactive floating particles (full-page canvas) ── */}
      <ParticleCanvas />

      {/* ════ LEFT — Dark amber honeycomb hero panel (58%) ════ */}
      <div
        className="hidden lg:flex"
        style={{
          width: "58%", position: "relative", flexDirection: "column",
          alignItems: "center", justifyContent: "center", overflow: "hidden",
          background: "linear-gradient(135deg, #0C0500 0%, #1C0A00 28%, #431407 62%, #7C2D12 100%)",
          zIndex: 2,
        }}
      >
        <HoneycombGrid />

        {/* Ambient glow orbs */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <div style={{ position:"absolute", top:"-15%", right:"-10%", width:520, height:520, borderRadius:"50%",
                        background:"radial-gradient(circle, rgba(245,158,11,0.3) 0%, transparent 65%)", filter:"blur(64px)" }} />
          <div style={{ position:"absolute", bottom:"-12%", left:"-6%", width:400, height:400, borderRadius:"50%",
                        background:"radial-gradient(circle, rgba(217,119,6,0.24) 0%, transparent 65%)", filter:"blur(52px)" }} />
          <div style={{ position:"absolute", top:"42%", left:"30%", width:240, height:240, borderRadius:"50%",
                        background:"radial-gradient(circle, rgba(252,211,77,0.13) 0%, transparent 65%)", filter:"blur(36px)" }} />
        </div>

        {/* Branding content */}
        <div style={{ position:"relative", zIndex:10, display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", padding:"0 56px" }}>
          <img src={logoUrl} alt="HoneyBee"
               style={{ height:128, width:128, objectFit:"contain", marginBottom:28,
                        filter:"drop-shadow(0 18px 44px rgba(245,158,11,0.7))" }} />
          <h1 style={{ fontSize:42, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1.1, color:"#FFFFFF", margin:"0 0 16px",
                        textShadow:"0 2px 24px rgba(245,158,11,0.55), 0 1px 2px rgba(0,0,0,0.4)" }}>
            HoneyBee
          </h1>
          <p style={{ fontSize:15, lineHeight:1.8, color:"rgba(255,255,255,0.88)", maxWidth:340, margin:"0 0 36px",
                       textShadow:"0 1px 4px rgba(0,0,0,0.35)" }}>
            Unified honeypot command &amp; control.<br />
            Deploy, monitor and replay attacker sessions in real time.
          </p>
          <div style={{ display:"flex", flexWrap:"wrap", gap:10, justifyContent:"center" }}>
            {["SSH Honeypots","Web Traps","WordPress Lures","Live Replay","PotStore"].map(t => (
              <span key={t} style={{
                padding:"6px 14px", borderRadius:999, fontSize:11.5, fontWeight:700,
                background:"rgba(245,158,11,0.22)", border:"1px solid rgba(245,158,11,0.55)",
                color:"#FFFFFF", letterSpacing:"0.01em",
                textShadow:"0 1px 3px rgba(0,0,0,0.4)",
              }}>{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ════ RIGHT — Clean white sign-in form ════ */}
      <div style={{
        flex:1, display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
        padding:"40px", background:"#FFFFFF", position:"relative", zIndex:2,
      }}>
        {/* Mobile-only logo */}
        <div className="lg:hidden" style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:32 }}>
          <img src={logoUrl} alt="HoneyBee"
               style={{ height:64, width:64, objectFit:"contain", marginBottom:10,
                        filter:"drop-shadow(0 6px 16px rgba(245,158,11,0.45))" }} />
          <span style={{ fontSize:20, fontWeight:900, color:"#0F172A" }}>HoneyBee</span>
        </div>

        <div style={{ width:"100%", maxWidth:400 }} className="animate-float-up">
          <h2 style={{ fontSize:30, fontWeight:900, letterSpacing:"-0.03em", color:"#0F172A", margin:"0 0 6px" }}>
            Sign in
          </h2>
          <p style={{ fontSize:14, color:"#64748B", margin:"0 0 30px" }}>
            Welcome back. Enter your credentials to continue.
          </p>

          <form onSubmit={submit} style={{ display:"flex", flexDirection:"column", gap:18 }}>
            {err && (
              <div style={{ background:"#FEF2F2", border:"1px solid #FECACA", color:"#DC2626",
                            borderRadius:10, padding:"10px 14px", fontSize:13, fontWeight:500 }}>
                {err}
              </div>
            )}
            <div>
              <label className="input-label">E-mail</label>
              <input type="email" className="input" value={email} required
                     onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <div>
              <label className="input-label">Password</label>
              <input type="password" className="input" value={pass} required
                     onChange={e => setPass(e.target.value)} placeholder="••••••••" />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary"
                    style={{ padding:"13px 0", fontSize:14.5, marginTop:4 }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p style={{ marginTop:24, textAlign:"center", fontSize:13, color:"#64748B" }}>
            New organisation?{" "}
            <Link to="/register" style={{ color:"#B45309", fontWeight:700 }}>Create account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
