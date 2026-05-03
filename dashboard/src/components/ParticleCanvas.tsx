import { useEffect, useRef, useId } from "react";

/* ─── Mouse-reactive particle canvas ──────────────────────────────────────── */
/* subtle=true → low-alpha amber dashes for use on white backgrounds           */
export default function ParticleCanvas({ subtle = false }: { subtle?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf: number;
    const mouse = { x: -9999, y: -9999 };

    const resize = () => {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };
    window.addEventListener("mousemove", onMove);

    // Honey-amber color palette — lighter set for subtle/white-bg mode
    const COLORS_VIVID = [
      "245,158,11",   // amber-500
      "217,119,6",    // amber-600
      "252,211,77",   // amber-300 (gold)
      "180,83,9",     // amber-700
      "253,230,138",  // amber-200
      "251,191,36",   // amber-400
      "28,10,0",      // near-black honey
    ];
    const COLORS_SUBTLE = [
      "245,158,11",   // amber-500
      "217,119,6",    // amber-600
      "252,211,77",   // amber-300
      "251,191,36",   // amber-400
      "180,83,9",     // amber-700
    ];
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
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of pts) {
        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const d  = Math.hypot(dx, dy);
        const R  = 220;

        if (d < R && d > 0.1) {
          const force = (R - d) / R;
          const a     = Math.atan2(dy, dx);
          // Tangential orbit + gentle radial push
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

        // Wrap edges
        if      (p.x < -30)                  p.x = canvas.width  + 30;
        else if (p.x > canvas.width  + 30)   p.x = -30;
        if      (p.y < -30)                  p.y = canvas.height + 30;
        else if (p.y > canvas.height + 30)   p.y = -30;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.strokeStyle = `rgba(${p.col},${p.alpha})`;
        ctx.lineWidth   = p.lw;
        ctx.lineCap     = "round";
        ctx.beginPath();
        ctx.moveTo(-p.len / 2, 0);
        ctx.lineTo( p.len / 2, 0);
        ctx.stroke();
        ctx.restore();
      }

      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, zIndex: 3, pointerEvents: "none" }}
    />
  );
}

/* ─── Honeycomb SVG grid overlay ───────────────────────────────────────────
   Tessellated pointy-top hexagons (size a=24) with pattern tile 84×48.
   Seven hex centers: 1 full center + 2 half-edges + 4 quarter-corners.
   Adjacent tile copies fill the missing quarters to form a complete grid.
─────────────────────────────────────────────────────────────────────────── */
export function HoneycombGrid() {
  const uid = useId().replace(/:/g, "");
  const id  = `hc${uid}`;

  const pts = (cx: number, cy: number) =>
    [
      [cx,       cy - 24],
      [cx + 20.8, cy - 12],
      [cx + 20.8, cy + 12],
      [cx,       cy + 24],
      [cx - 20.8, cy + 12],
      [cx - 20.8, cy - 12],
    ].map(([x, y]) => `${x},${y}`).join(" ");

  const centers: [number, number][] = [
    [42, 24],              // full center
    [0,  24], [84, 24],   // left / right half-edges
    [21, -12], [63, -12], // upper quarter-corners
    [21,  60], [63,  60], // lower quarter-corners
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
