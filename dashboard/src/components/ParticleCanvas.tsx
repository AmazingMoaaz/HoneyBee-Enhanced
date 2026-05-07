import { useEffect, useRef, useId } from "react";

/* ─── Mouse-reactive particle canvas ──────────────────────────────────────── */
/*  Features:                                                                  */
/*    - Mouse-orbit field: particles tangentially orbit the cursor             */
/*    - Click bursts: emits expanding amber rings + radial impulse on pts      */
/*    - Constellation lines: nearby particles within mouse radius are linked   */
/*    - Glow halo on particles inside the cursor field                         */
/*    - Edge wrap: seamless looping particles                                  */
/*    - DPR-aware sizing for crisp lines on retina displays                    */
/*    - subtle=true → low-density / low-alpha for use on white backgrounds     */
/* ─────────────────────────────────────────────────────────────────────────── */
export default function ParticleCanvas({ subtle = false }: { subtle?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf: number;
    const mouse = { x: -9999, y: -9999 };

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width  = Math.floor(window.innerWidth  * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width  = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove  = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    const onLeave = () => { mouse.x = -9999; mouse.y = -9999; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);

    /* ── Click ripples ── */
    type Ripple = { x: number; y: number; r: number; a: number };
    const ripples: Ripple[] = [];
    const onClick = (e: MouseEvent) => {
      ripples.push({ x: e.clientX, y: e.clientY, r: 0, a: 0.55 });
      for (const p of pts) {
        const dx = p.x - e.clientX, dy = p.y - e.clientY;
        const d = Math.hypot(dx, dy);
        if (d < 280 && d > 0) {
          const f = (1 - d / 280) * 4.2;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
          p.av += (Math.random() - 0.5) * 0.4;
        }
      }
    };
    window.addEventListener("click", onClick);

    const COLORS_VIVID  = ["245,158,11","217,119,6","252,211,77","180,83,9","253,230,138","251,191,36","28,10,0"];
    const COLORS_SUBTLE = ["245,158,11","217,119,6","252,211,77","251,191,36","180,83,9"];
    const COLORS = subtle ? COLORS_SUBTLE : COLORS_VIVID;
    const COUNT  = subtle ? 90  : 150;
    const A_MIN  = subtle ? 0.05 : 0.20;
    const A_RNG  = subtle ? 0.13 : 0.35;
    const LW_MAX = subtle ? 1.2  : 1.8;

    const pts = Array.from({ length: COUNT }, () => ({
      x:     Math.random() * window.innerWidth,
      y:     Math.random() * window.innerHeight,
      vx:    (Math.random() - 0.5) * 0.6,
      vy:    (Math.random() - 0.5) * 0.6,
      len:   5 + Math.random() * 18,
      angle: Math.random() * Math.PI * 2,
      av:    (Math.random() - 0.5) * 0.015,
      col:   COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: A_MIN + Math.random() * A_RNG,
      lw:    0.8 + Math.random() * LW_MAX,
    }));

    const tick = () => {
      const W = window.innerWidth, H = window.innerHeight;
      ctx.clearRect(0, 0, W, H);

      const R    = 220;                  // mouse interaction radius
      const LINK = subtle ? 110 : 130;   // particle-to-particle link radius near cursor

      /* ── Constellation lines: connect nearby pts when in mouse zone ── */
      if (mouse.x > -1000) {
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const adx = a.x - mouse.x, ady = a.y - mouse.y;
          const adM = Math.hypot(adx, ady);
          if (adM > R) continue;
          for (let j = i + 1; j < pts.length; j++) {
            const b = pts[j];
            const dx = a.x - b.x, dy = a.y - b.y;
            const d = Math.hypot(dx, dy);
            if (d > LINK) continue;
            const mProx = 1 - adM / R;
            const pProx = 1 - d / LINK;
            const al = mProx * pProx * (subtle ? 0.18 : 0.42);
            ctx.strokeStyle = `rgba(245,158,11,${al})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      /* ── Particle update + draw ── */
      for (const p of pts) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d  = Math.hypot(dx, dy);

        if (d < R && d > 0.1) {
          const force = (R - d) / R;
          const a     = Math.atan2(dy, dx);
          p.vx += (Math.cos(a + Math.PI / 2) * 0.08 + (dx / d) * 0.04) * force;
          p.vy += (Math.sin(a + Math.PI / 2) * 0.08 + (dy / d) * 0.04) * force;
          p.av += force * 0.06;
        }

        p.vx *= 0.96;
        p.vy *= 0.96;
        p.av *= 0.95;
        p.x  += p.vx;
        p.y  += p.vy;
        p.angle += p.av + 0.004;

        if      (p.x < -30)        p.x = W + 30;
        else if (p.x > W + 30)     p.x = -30;
        if      (p.y < -30)        p.y = H + 30;
        else if (p.y > H + 30)     p.y = -30;

        const halo = d < R ? (1 - d / R) : 0;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        if (halo > 0.4) {
          ctx.shadowColor = `rgba(${p.col},${halo * 0.7})`;
          ctx.shadowBlur  = 8 * halo;
        }
        ctx.strokeStyle = `rgba(${p.col},${Math.min(1, p.alpha + halo * 0.4)})`;
        ctx.lineWidth   = p.lw + halo * 0.6;
        ctx.lineCap     = "round";
        ctx.beginPath();
        ctx.moveTo(-p.len / 2, 0);
        ctx.lineTo( p.len / 2, 0);
        ctx.stroke();
        ctx.restore();
      }

      /* ── Click ripples ── */
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        rp.r += 5.2;
        rp.a *= 0.955;
        ctx.strokeStyle = `rgba(245,158,11,${rp.a})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = `rgba(252,211,77,${rp.a * 0.6})`;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r * 0.62, 0, Math.PI * 2);
        ctx.stroke();
        if (rp.a < 0.02 || rp.r > 420) ripples.splice(i, 1);
      }

      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("click", onClick);
    };
  }, [subtle]);

  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, zIndex: 3, pointerEvents: "none" }}
    />
  );
}

/* ─── Honeycomb SVG grid overlay ───────────────────────────────────────── */
export function HoneycombGrid() {
  const uid = useId().replace(/:/g, "");
  const id  = `hc${uid}`;

  const pts = (cx: number, cy: number) =>
    [
      [cx,        cy - 24],
      [cx + 20.8, cy - 12],
      [cx + 20.8, cy + 12],
      [cx,        cy + 24],
      [cx - 20.8, cy + 12],
      [cx - 20.8, cy - 12],
    ].map(([x, y]) => `${x},${y}`).join(" ");

  const centers: [number, number][] = [
    [42, 24],
    [0,  24], [84, 24],
    [21, -12], [63, -12],
    [21,  60], [63,  60],
  ];

  return (
    <svg
      className="absolute inset-0 w-full h-full"
      xmlns="http://www.w3.org/2000/svg"
      style={{ pointerEvents: "none" }}
    >
      <defs>
        <pattern id={id} x="0" y="0" width="84" height="48" patternUnits="userSpaceOnUse">
          {centers.map(([cx, cy], i) => (
            <polygon
              key={i}
              points={pts(cx, cy)}
              fill="none"
              stroke="rgba(245,158,11,0.2)"
              strokeWidth="1.5"
            />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
