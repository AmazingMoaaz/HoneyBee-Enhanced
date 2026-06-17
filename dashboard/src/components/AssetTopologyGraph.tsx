import { useRef, useEffect, useCallback, useState } from "react";

/* ───────────────────────── Asset Topology Graph ─────────────────────────
   Interactive force-directed map of user → nodes → honeypots (+ LogAnalyser).
   Scroll behaviour: a plain mouse-wheel scrolls the PAGE; hold Ctrl/⌘ and
   scroll to zoom the graph (so the canvas never traps page scrolling).
─────────────────────────────────────────────────────────────────────────── */

interface Deployment {
  id: number;
  node_id: number;
  honeypot_type: string;
  pot_id: string;
  status: string;
}

interface GNode {
  id: string;
  label: string;
  kind: "user" | "node" | "honeypot" | "loganalyzer";
  online?: boolean;
  hostname?: string;
  ip?: string;
  os?: string;
  potCount?: number;
  runningPots?: number;
  potType?: string;
  potId?: string;
  status?: string;
  parentId?: string;
  laWorkspaceName?: string;
  laWorkspaceUrl?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}
interface GEdge { source: string; target: string }

function buildGraph(email: string | null, nodes: any[], deployments: Deployment[], w: number, h: number): { gnodes: GNode[]; edges: GEdge[] } {
  const cx = w / 2, cy = h / 2;
  const gnodes: GNode[] = [];
  const edges: GEdge[] = [];

  gnodes.push({ id: "user", label: email?.split("@")[0] ?? "You", kind: "user", x: cx, y: cy, vx: 0, vy: 0, fixed: true });

  const nodeR = Math.min(cx, cy) * 0.55;
  const N = Math.max(nodes.length, 1);
  nodes.forEach((n: any, i: number) => {
    const angle = (2 * Math.PI * i) / N - Math.PI / 2;
    const nx = cx + nodeR * Math.cos(angle);
    const ny = cy + nodeR * Math.sin(angle);
    const nid = `node-${n.id}`;
    const pots = deployments.filter((d) => d.node_id === n.id);
    gnodes.push({
      id: nid, label: n.name, kind: "node", online: !!n.online,
      hostname: n.hostname, ip: n.ip_address, os: n.os, potCount: pots.length,
      runningPots: pots.filter((p) => p.status === "running").length,
      x: nx, y: ny, vx: 0, vy: 0,
    });
    edges.push({ source: "user", target: nid });

    const laId = (n.la_enabled && pots.length > 0) ? `la-${n.id}` : null;
    if (laId) {
      const laAngle = angle;
      const laR = Math.min(w, h) * 0.08;
      gnodes.push({
        id: laId, label: "Log Analyser", kind: "loganalyzer", online: true, parentId: nid,
        laWorkspaceName: (n as any).la_workspace_name, laWorkspaceUrl: (n as any).la_workspace_url,
        x: nx + laR * Math.cos(laAngle), y: ny + laR * Math.sin(laAngle), vx: 0, vy: 0,
      });
      edges.push({ source: nid, target: laId });
    }

    const potR = Math.min(w, h) * 0.14;
    const spread = Math.min(Math.PI * 0.7, 0.35 + pots.length * 0.18);
    pots.forEach((p, j) => {
      const t = pots.length === 1 ? 0 : (j / (pots.length - 1)) - 0.5;
      const pa = angle + t * spread;
      const px = nx + potR * Math.cos(pa);
      const py = ny + potR * Math.sin(pa);
      gnodes.push({
        id: `pot-${p.id}`, label: p.honeypot_type, kind: "honeypot",
        online: p.status === "running", potType: p.honeypot_type, potId: p.pot_id, status: p.status, parentId: nid,
        x: px, y: py, vx: 0, vy: 0,
      });
      edges.push({ source: laId ?? nid, target: `pot-${p.id}` });
    });
  });

  return { gnodes, edges };
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

const KIND_STYLE: Record<string, { r: number; gradId: string; stroke: string; glow: string; ring: string }> = {
  user:        { r: 28, gradId: "grad-user",        stroke: "#D97706", glow: "rgba(245,158,11,0.55)", ring: "#FCD34D" },
  node:        { r: 20, gradId: "grad-node",        stroke: "#2563EB", glow: "rgba(59,130,246,0.50)", ring: "#93C5FD" },
  honeypot:    { r: 13, gradId: "grad-honeypot",    stroke: "#10B981", glow: "rgba(16,185,129,0.45)", ring: "#6EE7B7" },
  loganalyzer: { r: 16, gradId: "grad-loganalyzer", stroke: "#7C3AED", glow: "rgba(124,58,237,0.45)", ring: "#C4B5FD" },
};
const OFFLINE_FILL = "var(--bg-2)";
const OFFLINE_STROKE = "var(--text-faint)";
const KIND_ICON: Record<string, string> = {
  user:        "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0v1H5v-1z",
  node:        "M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01",
  honeypot:    "M12 2l3 5 5 .8-3.5 3.5.8 5L12 14l-5.3 2.3.8-5L4 7.8 9 7l3-5z",
  loganalyzer: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4",
};
type FilterMode = "all" | "online" | "withpots";

export default function AssetTopologyGraph({ nodes, deployments, email }: { nodes: any[]; deployments: Deployment[]; email: string | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w: 800, h: 520 });
  const [gdata, setGdata] = useState<{ gnodes: GNode[]; edges: GEdge[] }>({ gnodes: [], edges: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [view, setView] = useState({ tx: 0, ty: 0, scale: 1 });
  const [rebuildKey, setRebuildKey] = useState(0);

  const dragNode = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const panRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const fsRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width, height } = e.contentRect;
        if (width > 0 && height > 0) setDim({ w: width, h: height });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) fsRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  useEffect(() => {
    setGdata(buildGraph(email, nodes, deployments, dim.w, dim.h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, nodes, deployments, dim, rebuildKey]);

  useEffect(() => {
    if (gdata.gnodes.length === 0) return;
    let running = true;
    let frames = 0;
    function tick() {
      if (!running) return;
      frames++;
      setGdata((prev) => {
        const ns = prev.gnodes.map((n) => ({ ...n }));
        const idx = new Map<string, number>();
        ns.forEach((n, i) => idx.set(n.id, i));
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            const dx = ns[i].x - ns[j].x;
            const dy = ns[i].y - ns[j].y;
            const dist2 = dx * dx + dy * dy + 1;
            const minD = (KIND_STYLE[ns[i].kind].r + KIND_STYLE[ns[j].kind].r) * 3.2;
            if (dist2 < minD * minD) {
              const force = (minD * minD - dist2) / (dist2 * 60);
              ns[i].vx += dx * force; ns[i].vy += dy * force;
              ns[j].vx -= dx * force; ns[j].vy -= dy * force;
            }
          }
        }
        prev.edges.forEach((e) => {
          const a = ns[idx.get(e.source)!]; const b = ns[idx.get(e.target)!];
          if (!a || !b) return;
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const rest = a.kind === "user" ? Math.min(dim.w, dim.h) * 0.28 : 70;
          const k = 0.02;
          const f = (dist - rest) * k;
          const fx = (dx / dist) * f, fy = (dy / dist) * f;
          if (!a.fixed) { a.vx += fx; a.vy += fy; }
          if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
        });
        ns.forEach((n) => {
          if (n.fixed) { n.vx = 0; n.vy = 0; return; }
          n.vx *= 0.75; n.vy *= 0.75;
          n.x = clamp(n.x + n.vx, 30, dim.w - 30);
          n.y = clamp(n.y + n.vy, 30, dim.h - 30);
        });
        return { gnodes: ns, edges: prev.edges };
      });
      if (frames < 180) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gdata.gnodes.length, dim, rebuildKey]);

  const toSvgPt = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM()!.inverse());
  }, []);

  const toGraphPt = useCallback((clientX: number, clientY: number) => {
    const p = toSvgPt(clientX, clientY);
    return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
  }, [view, toSvgPt]);

  const onNodeMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const node = gdata.gnodes.find((n) => n.id === id)!;
    const gp = toGraphPt(e.clientX, e.clientY);
    dragNode.current = { id, ox: gp.x - node.x, oy: gp.y - node.y };
  };

  const onBgMouseDown = (e: React.MouseEvent) => {
    if ((e.target as SVGElement).tagName !== "rect" && (e.target as SVGElement).tagName !== "svg") return;
    panRef.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
    setSelected(null);
  };

  const onSvgMouseMove = (e: React.MouseEvent) => {
    if (dragNode.current) {
      const gp = toGraphPt(e.clientX, e.clientY);
      const { id, ox, oy } = dragNode.current;
      setGdata((prev) => ({
        ...prev,
        gnodes: prev.gnodes.map((n) =>
          n.id === id ? { ...n, x: clamp(gp.x - ox, 30, dim.w - 30), y: clamp(gp.y - oy, 30, dim.h - 30), vx: 0, vy: 0 } : n
        ),
      }));
    } else if (panRef.current) {
      const { sx, sy, tx, ty } = panRef.current;
      setView((v) => ({ ...v, tx: tx + (e.clientX - sx), ty: ty + (e.clientY - sy) }));
    }
  };

  const onSvgMouseUp = () => { dragNode.current = null; panRef.current = null; };

  // Zoom only while Ctrl/⌘ is held — otherwise let the page scroll normally.
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const p = toSvgPt(e.clientX, e.clientY);
    const delta = -e.deltaY * 0.0012;
    setView((v) => {
      const next = clamp(v.scale * (1 + delta), 0.4, 2.5);
      const k = next / v.scale;
      return { scale: next, tx: p.x - (p.x - v.tx) * k, ty: p.y - (p.y - v.ty) * k };
    });
  };

  const adjacency = useCallback(() => {
    const m = new Map<string, Set<string>>();
    gdata.edges.forEach((e) => {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    });
    return m;
  }, [gdata.edges]);

  const activeId = selected ?? hover;
  const activeSet = (() => {
    if (!activeId) return null;
    const adj = adjacency();
    const set = new Set<string>([activeId]);
    const direct = adj.get(activeId);
    if (direct) direct.forEach((n) => set.add(n));
    gdata.gnodes.forEach((n) => { if (n.parentId && set.has(n.parentId)) set.add(n.id); });
    return set;
  })();

  const q = search.trim().toLowerCase();
  const passesFilter = (n: GNode) => {
    if (n.kind === "user") return true;
    if (filterMode === "online" && !n.online) return false;
    if (filterMode === "withpots" && n.kind === "node" && (n.potCount ?? 0) === 0) return false;
    if (filterMode === "withpots" && n.kind === "honeypot") {
      const parent = gdata.gnodes.find((g) => g.id === n.parentId);
      if (!parent || (parent.potCount ?? 0) === 0) return false;
    }
    if (filterMode === "withpots" && n.kind === "loganalyzer") {
      const parent = gdata.gnodes.find((g) => g.id === n.parentId);
      if (!parent || (parent.potCount ?? 0) === 0) return false;
    }
    if (q) {
      const hay = `${n.label} ${n.hostname ?? ""} ${n.ip ?? ""} ${n.potType ?? ""} ${n.potId ?? ""}`.toLowerCase();
      return hay.includes(q);
    }
    return true;
  };
  const visibleIds = new Set(gdata.gnodes.filter(passesFilter).map((n) => n.id));
  const nodeById = new Map<string, GNode>(gdata.gnodes.map((n) => [n.id, n]));

  const nodeCount = nodes.length;
  const onlineNodes = nodes.filter((n: any) => n.online).length;
  const potCount = deployments.length;
  const runningPots = deployments.filter((d) => d.status === "running").length;
  const tooltipNode = activeId ? nodeById.get(activeId) : null;

  const zoomBy = (factor: number) => {
    setView((v) => {
      const cx = dim.w / 2, cy = dim.h / 2;
      const next = clamp(v.scale * factor, 0.4, 2.5);
      const k = next / v.scale;
      return { scale: next, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
    });
  };
  const reset = () => { setView({ tx: 0, ty: 0, scale: 1 }); setRebuildKey((k) => k + 1); };

  const FSIcon = () => isFullscreen
    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>;

  if (gdata.gnodes.length <= 1 && nodeCount === 0) {
    return (
      <div ref={containerRef}
        style={{ height: 520, background: "linear-gradient(180deg, var(--surface) 0%, var(--bg-2) 100%)", borderRadius: 12, position: "relative" }}
        className="flex flex-col items-center justify-center gap-2">
        <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--warn-bg)", display: "grid", placeItems: "center", color: "var(--accent)", fontSize: 22 }}>⬡</div>
        <p className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>No assets to display yet</p>
        <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>Register a node to populate the topology</p>
      </div>
    );
  }

  const TonePill = ({ active, onClick, children }: any) => (
    <button onClick={onClick}
      style={{
        padding: "5px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
        border: active ? "1px solid #F59E0B" : "1px solid var(--border)",
        background: active ? "var(--warn-bg)" : "var(--surface)",
        color: active ? "var(--accent)" : "var(--text-muted)", cursor: "pointer", transition: "all .15s",
      }}>{children}</button>
  );
  const IconBtn = ({ onClick, title, children }: any) => (
    <button onClick={onClick} title={title}
      style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-muted)", display: "grid", placeItems: "center", cursor: "pointer", fontSize: 14, fontWeight: 700, transition: "background .12s, box-shadow .12s" }}
      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-2)")}
      onMouseLeave={e => (e.currentTarget.style.background = "var(--surface)")}>{children}</button>
  );

  return (
    <div ref={fsRef} style={isFullscreen ? { position: "fixed", inset: 0, zIndex: 9999, background: "var(--bg-2)", padding: "20px 24px 16px", display: "flex", flexDirection: "column", gap: 14 } : {}}>
      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 4px 14px 4px" }}>
        <div style={{ position: "relative", flex: "0 1 260px", minWidth: 200 }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search nodes, IPs, honeypots…"
            style={{ width: "100%", padding: "8px 12px 8px 32px", fontSize: 12.5, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", outline: "none" }} />
          <svg viewBox="0 0 24 24" width="14" height="14" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-faint)" }} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <TonePill active={filterMode === "all"} onClick={() => setFilterMode("all")}>All</TonePill>
          <TonePill active={filterMode === "online"} onClick={() => setFilterMode("online")}>Online</TonePill>
          <TonePill active={filterMode === "withpots"} onClick={() => setFilterMode("withpots")}>With honeypots</TonePill>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <IconBtn onClick={() => zoomBy(1.2)} title="Zoom in">+</IconBtn>
          <IconBtn onClick={() => zoomBy(1 / 1.2)} title="Zoom out">−</IconBtn>
          <IconBtn onClick={reset} title="Reset view">⟲</IconBtn>
          <div style={{ width: 1, height: 18, background: "var(--border)", margin: "0 2px" }} />
          <IconBtn onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}><FSIcon /></IconBtn>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef}
        style={{ position: "relative", height: isFullscreen ? 0 : 520, flex: isFullscreen ? 1 : undefined, minHeight: isFullscreen ? 0 : undefined, borderRadius: 12, overflow: "hidden", background: "radial-gradient(circle at 50% 40%, var(--surface) 0%, var(--bg-2) 70%, var(--bg) 100%)", border: "1px solid var(--border)" }}>
        <svg ref={svgRef} width="100%" height="100%"
          style={{ display: "block", cursor: dragNode.current ? "grabbing" : panRef.current ? "grabbing" : "default" }}
          onMouseDown={onBgMouseDown} onMouseMove={onSvgMouseMove} onMouseUp={onSvgMouseUp} onMouseLeave={onSvgMouseUp} onWheel={onWheel}>
          <defs>
            <radialGradient id="grad-user" cx="35%" cy="35%"><stop offset="0%" stopColor="rgba(245,158,11,0.16)" /><stop offset="60%" stopColor="#FCD34D" /><stop offset="100%" stopColor="#F59E0B" /></radialGradient>
            <radialGradient id="grad-node" cx="35%" cy="35%"><stop offset="0%" stopColor="rgba(59,130,246,0.12)" /><stop offset="60%" stopColor="#93C5FD" /><stop offset="100%" stopColor="#3B82F6" /></radialGradient>
            <radialGradient id="grad-honeypot" cx="35%" cy="35%"><stop offset="0%" stopColor="rgba(34,197,94,0.12)" /><stop offset="60%" stopColor="#6EE7B7" /><stop offset="100%" stopColor="#10B981" /></radialGradient>
            <radialGradient id="grad-loganalyzer" cx="35%" cy="35%"><stop offset="0%" stopColor="rgba(139,92,246,0.12)" /><stop offset="60%" stopColor="#C4B5FD" /><stop offset="100%" stopColor="#7C3AED" /></radialGradient>
            <linearGradient id="edge-grad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="var(--text-faint)" stopOpacity="0.7" /><stop offset="100%" stopColor="var(--border-2)" stopOpacity="0.3" /></linearGradient>
            <linearGradient id="edge-grad-active" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#F59E0B" stopOpacity="0.95" /><stop offset="100%" stopColor="#F59E0B" stopOpacity="0.45" /></linearGradient>
            {Object.entries(KIND_STYLE).map(([k, s]) => (
              <filter key={k} id={`glow-${k}`} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feFlood floodColor={s.glow} result="color" />
                <feComposite in="color" in2="blur" operator="in" result="shadow" />
                <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            ))}
            <pattern id="dotgrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="var(--text-faint)" opacity="0.28" /></pattern>
          </defs>

          <rect x="0" y="0" width={dim.w} height={dim.h} fill="url(#dotgrid)" />

          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>
            {gdata.edges.map((e) => {
              const s = nodeById.get(e.source); const t = nodeById.get(e.target);
              if (!s || !t) return null;
              if (!visibleIds.has(s.id) || !visibleIds.has(t.id)) return null;
              const isActive = !!activeSet && activeSet.has(s.id) && activeSet.has(t.id);
              const dim_ = !!activeSet && !isActive;
              const toLA = s.kind === "loganalyzer" || t.kind === "loganalyzer";
              const toHP = t.kind === "honeypot" && s.kind !== "loganalyzer";
              const passC = toLA ? "#A78BFA" : toHP ? "#34D399" : "var(--text-faint)";
              const actC = toLA ? "#7C3AED" : toHP ? "#10B981" : "#F59E0B";
              const dash = toLA ? "3 5" : toHP ? "4 5" : "6 5";
              const dx = t.x - s.x, dy = t.y - s.y;
              const mx = (s.x + t.x) / 2 + dy * 0.1;
              const my = (s.y + t.y) / 2 - dx * 0.1;
              const path = `M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`;
              return (
                <g key={`${e.source}-${e.target}`} opacity={dim_ ? 0.1 : 1} style={{ transition: "opacity .25s" }}>
                  <path d={path} stroke="transparent" strokeWidth="10" fill="none" />
                  <path d={path} stroke={isActive ? actC : passC} strokeWidth={isActive ? 2.2 : 1.2} fill="none" strokeDasharray={isActive ? "0" : dash} strokeOpacity={isActive ? 1 : 0.6} style={{ transition: "stroke .2s, stroke-width .15s" }} />
                  {isActive && (
                    <circle r="3.5" fill={actC}>
                      <animateMotion dur={toLA ? "1.1s" : "1.6s"} repeatCount="indefinite" path={path} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
                    </circle>
                  )}
                </g>
              );
            })}

            {gdata.gnodes.map((gn) => {
              if (!visibleIds.has(gn.id)) return null;
              const s = KIND_STYLE[gn.kind];
              const isOffline = gn.online === false;
              const isAgentWarn = gn.kind === "node" && isOffline && (gn.runningPots ?? 0) > 0;
              const isActive = !!activeSet && activeSet.has(gn.id);
              const isHovered = hover === gn.id;
              const opacity = !!activeSet && !isActive ? 0.18 : 1;
              const isPulsing = gn.online !== false && gn.kind !== "user";
              const iSize = gn.kind === "user" ? 20 : gn.kind === "node" ? 15 : gn.kind === "loganalyzer" ? 13 : 11;
              const iHalf = iSize / 2;
              const labelRaw = gn.label ?? "";
              const labelTxt = labelRaw.length > 15 ? labelRaw.slice(0, 14) + "…" : labelRaw;
              const labelBgW = Math.max(labelTxt.length * 6.4 + 14, 42);
              return (
                <g key={gn.id} opacity={opacity}
                  style={{ cursor: "grab", transition: "opacity .25s", animation: "svgNodeIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both", transformBox: "fill-box", transformOrigin: "center center" }}
                  onMouseDown={(e) => onNodeMouseDown(e, gn.id)} onMouseEnter={() => setHover(gn.id)} onMouseLeave={() => setHover(null)}
                  onClick={(e) => { e.stopPropagation(); setSelected(selected === gn.id ? null : gn.id); }}>
                  <circle cx={gn.x} cy={gn.y} r={isHovered ? s.r + 18 : s.r + 7} fill={isOffline ? "transparent" : s.glow} opacity={isHovered ? 0.42 : 0.2} style={{ transition: "r .22s ease, opacity .22s ease" }} />
                  {isPulsing && (
                    <circle cx={gn.x} cy={gn.y} r={s.r + 3} fill="none" stroke={s.ring} strokeWidth="1.5" opacity="0">
                      <animate attributeName="r" values={`${s.r + 1};${s.r + 18};${s.r + 1}`} dur={gn.kind === "user" ? "3.2s" : "2.6s"} repeatCount="indefinite" />
                      <animate attributeName="opacity" values="0.6;0;0.6" dur={gn.kind === "user" ? "3.2s" : "2.6s"} repeatCount="indefinite" />
                    </circle>
                  )}
                  <circle cx={gn.x} cy={gn.y + 2} r={s.r} fill="rgba(15,23,42,0.18)" style={{ filter: "blur(4px)" }} />
                  <circle cx={gn.x} cy={gn.y} r={s.r} fill={isOffline ? OFFLINE_FILL : `url(#${s.gradId})`} stroke={isOffline ? OFFLINE_STROKE : isHovered ? s.ring : s.stroke} strokeWidth={gn.kind === "user" ? 3 : isHovered ? 2.8 : 2} filter={`url(#glow-${gn.kind})`} style={{ transition: "stroke .15s, stroke-width .15s" }} />
                  {!isOffline && (<circle cx={gn.x} cy={gn.y} r={s.r * 0.65} fill="rgba(255,255,255,0.2)" />)}
                  {selected === gn.id && (
                    <circle cx={gn.x} cy={gn.y} r={s.r + 7} fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round">
                      <animateTransform attributeName="transform" type="rotate" from={`0 ${gn.x} ${gn.y}`} to={`360 ${gn.x} ${gn.y}`} dur="9s" repeatCount="indefinite" />
                    </circle>
                  )}
                  <svg x={gn.x - iHalf} y={gn.y - iHalf} width={iSize} height={iSize} viewBox="0 0 24 24" fill="none" stroke={isOffline ? "var(--text-faint)" : "#fff"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none", overflow: "hidden" }}>
                    <path d={KIND_ICON[gn.kind]} fill={gn.kind === "honeypot" && !isOffline ? "rgba(255,255,255,0.3)" : "none"} />
                  </svg>
                  {gn.kind === "node" && (gn.potCount ?? 0) > 0 && (
                    <g transform={`translate(${gn.x + s.r * 0.72}, ${gn.y + s.r * 0.72})`}>
                      <circle r="9.5" fill={gn.online ? "#10B981" : "var(--text-muted)"} stroke="#fff" strokeWidth="2" />
                      <text textAnchor="middle" y="3.5" fontSize="8.5" fontWeight="800" fill="#fff" style={{ pointerEvents: "none", userSelect: "none", fontFamily: "ui-monospace,monospace" }}>{gn.potCount}</text>
                    </g>
                  )}
                  {gn.kind !== "user" && (
                    <circle cx={gn.x + s.r * 0.72} cy={gn.y - s.r * 0.72} r="5" fill={gn.online ? "#22C55E" : isAgentWarn ? "#F59E0B" : "var(--text-faint)"} stroke="#fff" strokeWidth="1.8" />
                  )}
                  <g style={{ pointerEvents: "none", userSelect: "none" }}>
                    <rect x={gn.x - labelBgW / 2} y={gn.y + s.r + 7} width={labelBgW} height={15} rx={7.5} fill="var(--glass-strong)" stroke={s.stroke + "30"} strokeWidth="1" />
                    <text x={gn.x} y={gn.y + s.r + 18} textAnchor="middle" fontSize={gn.kind === "user" ? 11 : gn.kind === "node" ? 10 : 9} fontWeight="700"
                      fill={gn.kind === "user" ? "var(--accent)" : gn.kind === "node" ? "var(--info)" : gn.kind === "loganalyzer" ? "var(--violet)" : "var(--ok)"}>{labelTxt}</text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Stats panel */}
        <div style={{ position: "absolute", top: 12, left: 12, background: "var(--glass)", backdropFilter: "blur(8px)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", display: "flex", gap: 18, fontSize: 11.5, boxShadow: "0 4px 16px var(--shadow)" }}>
          <div>
            <div style={{ color: "var(--text-faint)", fontWeight: 600, letterSpacing: 0.4 }}>NODES</div>
            <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 16 }}>{nodeCount}<span style={{ fontSize: 11, color: "var(--ok)", marginLeft: 6 }}>● {onlineNodes}</span></div>
          </div>
          <div style={{ width: 1, background: "var(--border)" }} />
          <div>
            <div style={{ color: "var(--text-faint)", fontWeight: 600, letterSpacing: 0.4 }}>HONEYPOTS</div>
            <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 16 }}>{potCount}<span style={{ fontSize: 11, color: "var(--ok)", marginLeft: 6 }}>● {runningPots}</span></div>
          </div>
        </div>

        {/* Tooltip */}
        {tooltipNode && (() => {
          const s = KIND_STYLE[tooltipNode.kind];
          const screenX = tooltipNode.x * view.scale + view.tx;
          const screenY = tooltipNode.y * view.scale + view.ty;
          const left = Math.min(Math.max(screenX + s.r * view.scale + 14, 12), dim.w - 230);
          const top = clamp(screenY - 30, 12, dim.h - 130);
          return (
            <div style={{ position: "absolute", left, top, background: "rgba(15,23,42,0.96)", backdropFilter: "blur(6px)", color: "#E8EDF5", borderRadius: 10, padding: "10px 14px", fontSize: 12, minWidth: 200, maxWidth: 240, boxShadow: "0 8px 28px rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)", pointerEvents: "none", zIndex: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: tooltipNode.kind === "user" ? "#F59E0B" : tooltipNode.online ? "#22C55E" : "var(--text-faint)" }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{tooltipNode.label}</span>
              </div>
              <div style={{ color: "var(--text-faint)", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.6, marginBottom: 4 }}>{tooltipNode.kind}</div>
              {tooltipNode.kind === "node" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 3, fontSize: 11.5 }}>
                  {tooltipNode.hostname && (<><span style={{ color: "var(--text-muted)" }}>host</span><span>{tooltipNode.hostname}</span></>)}
                  {tooltipNode.ip && (<><span style={{ color: "var(--text-muted)" }}>ip</span><span style={{ fontFamily: "monospace" }}>{tooltipNode.ip}</span></>)}
                  {tooltipNode.os && (<><span style={{ color: "var(--text-muted)" }}>os</span><span>{tooltipNode.os}</span></>)}
                  <span style={{ color: "var(--text-muted)" }}>pots</span><span>{tooltipNode.potCount ?? 0}</span>
                  <span style={{ color: "var(--text-muted)" }}>agent</span>
                  <span style={{ color: tooltipNode.online ? "#4ADE80" : "#F87171" }}>{tooltipNode.online ? "online" : "offline"}</span>
                </div>
              )}
              {tooltipNode.kind === "honeypot" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 3, fontSize: 11.5 }}>
                  <span style={{ color: "var(--text-muted)" }}>type</span><span>{tooltipNode.potType}</span>
                  <span style={{ color: "var(--text-muted)" }}>id</span><span style={{ fontFamily: "monospace" }}>{tooltipNode.potId}</span>
                  <span style={{ color: "var(--text-muted)" }}>status</span><span style={{ color: tooltipNode.online ? "#4ADE80" : "var(--text-faint)" }}>{tooltipNode.status}</span>
                </div>
              )}
              {tooltipNode.kind === "loganalyzer" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 3, fontSize: 11.5 }}>
                  {tooltipNode.laWorkspaceName && (<><span style={{ color: "var(--text-muted)" }}>workspace</span><span>{tooltipNode.laWorkspaceName}</span></>)}
                  <span style={{ color: "var(--text-muted)" }}>status</span><span style={{ color: "#4ADE80" }}>active</span>
                </div>
              )}
              {tooltipNode.kind === "user" && email && (<div style={{ fontSize: 11.5, color: "var(--border-2)" }}>{email}</div>)}
            </div>
          );
        })()}

        {/* Legend */}
        <div style={{ position: "absolute", bottom: 12, right: 12, background: "var(--glass)", backdropFilter: "blur(8px)", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 12px", display: "flex", gap: 14, fontSize: 11, color: "var(--text-muted)", boxShadow: "0 4px 16px var(--shadow)" }}>
          {[{ color: "#F59E0B", label: "User" }, { color: "#3B82F6", label: "Node" }, { color: "#10B981", label: "Honeypot" }, { color: "#94A3B8", label: "Offline" }, { color: "#7C3AED", label: "Log Analyser" }].map(({ color, label }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block", boxShadow: `0 0 6px ${color}66` }} />
              {label}
            </span>
          ))}
        </div>

        {/* Help hint */}
        <div style={{ position: "absolute", bottom: 12, left: 12, fontSize: 10.5, color: "var(--text-faint)", letterSpacing: 0.3 }}>
          drag&nbsp;nodes&nbsp;·&nbsp;Ctrl+scroll&nbsp;to&nbsp;zoom&nbsp;·&nbsp;drag&nbsp;canvas&nbsp;to&nbsp;pan&nbsp;·&nbsp;click&nbsp;to&nbsp;focus
        </div>
      </div>
    </div>
  );
}
