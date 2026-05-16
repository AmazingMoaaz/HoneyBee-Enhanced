import { useQuery } from "@tanstack/react-query";
import { useRef, useEffect, useCallback, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuthStore } from "../stores/auth";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

interface Stats {
  total_events: number;
  unique_ips: number;
  by_type: { type: string; count: number }[];
  by_ip:   { ip: string;  count: number }[];
  timeline: { bucket: string; count: number }[];
}

interface Deployment {
  id: number;
  node_id: number;
  honeypot_type: string;
  pot_id: string;
  status: string;
}

// ─── Topology Graph ──────────────────────────────────────────────────────────

interface GNode {
  id: string;
  label: string;
  kind: "user" | "node" | "honeypot" | "loganalyzer";
  online?: boolean;
  // node-specific
  hostname?: string;
  ip?: string;
  os?: string;
  potCount?: number;
  runningPots?: number;
  // honeypot-specific
  potType?: string;
  potId?: string;
  status?: string;
  parentId?: string;
  // log-analyser-specific
  laWorkspaceName?: string;
  laWorkspaceUrl?: string;
  // physics
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

interface GEdge { source: string; target: string }

function buildGraph(
  email: string | null,
  nodes: any[],
  deployments: Deployment[],
  w: number,
  h: number,
): { gnodes: GNode[]; edges: GEdge[] } {
  const cx = w / 2, cy = h / 2;
  const gnodes: GNode[] = [];
  const edges: GEdge[] = [];

  gnodes.push({
    id: "user", label: email?.split("@")[0] ?? "You",
    kind: "user", x: cx, y: cy, vx: 0, vy: 0, fixed: true,
  });

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

// Log Analyser node (if la_enabled and node has honeypots)
      const laId = (n.la_enabled && pots.length > 0) ? `la-${n.id}` : null;
      if (laId) {
        const laAngle = angle;
        const laR = Math.min(w, h) * 0.08;
        gnodes.push({
          id: laId,
          label: "Log Analyser",
          kind: "loganalyzer",
          online: true,
          parentId: nid,
          laWorkspaceName: (n as any).la_workspace_name,
          laWorkspaceUrl: (n as any).la_workspace_url,
          x: nx + laR * Math.cos(laAngle),
          y: ny + laR * Math.sin(laAngle),
          vx: 0, vy: 0,
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
          online: p.status === "running",
          potType: p.honeypot_type, potId: p.pot_id, status: p.status, parentId: nid,
          x: px, y: py, vx: 0, vy: 0,
        });
        // If LA node exists, route honeypot connection through it
        edges.push({ source: laId ?? nid, target: `pot-${p.id}` });
    });
  });

  return { gnodes, edges };
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// Visual style per kind. Uses gradient IDs defined in <defs>.
const KIND_STYLE: Record<string, { r: number; gradId: string; stroke: string; glow: string; ring: string }> = {
  user:        { r: 28, gradId: "grad-user",        stroke: "#D97706", glow: "rgba(245,158,11,0.55)", ring: "#FCD34D" },
  node:        { r: 20, gradId: "grad-node",        stroke: "#2563EB", glow: "rgba(59,130,246,0.50)", ring: "#93C5FD" },
  honeypot:    { r: 13, gradId: "grad-honeypot",    stroke: "#059669", glow: "rgba(16,185,129,0.45)", ring: "#6EE7B7" },
  loganalyzer: { r: 16, gradId: "grad-loganalyzer", stroke: "#7C3AED", glow: "rgba(124,58,237,0.45)", ring: "#C4B5FD" },
};

const OFFLINE_FILL   = "#F1F5F9";
const OFFLINE_STROKE = "#94A3B8";

// Inline icon paths (24x24 viewBox) rendered inside circles.
const KIND_ICON: Record<string, string> = {
  user:        "M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0v1H5v-1z",
  node:        "M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01",
  honeypot:    "M12 2l3 5 5 .8-3.5 3.5.8 5L12 14l-5.3 2.3.8-5L4 7.8 9 7l3-5z",
  loganalyzer: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4",
};

type FilterMode = "all" | "online" | "withpots";

function AssetTopologyGraph({ nodes, deployments, email }: {
  nodes: any[]; deployments: Deployment[]; email: string | null;
}) {
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

  // ── Measure container ──
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

  // ── Fullscreen ──
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      fsRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  // ── Rebuild graph when inputs change ──
  useEffect(() => {
    setGdata(buildGraph(email, nodes, deployments, dim.w, dim.h));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, nodes, deployments, dim, rebuildKey]);

  // ── Physics: continuous gentle force-directed layout ──
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

        // Node-node repulsion
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
        // Edge spring forces (target rest length depends on kinds)
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

        // Damp & integrate
        ns.forEach((n) => {
          if (n.fixed) { n.vx = 0; n.vy = 0; return; }
          n.vx *= 0.75; n.vy *= 0.75;
          n.x = clamp(n.x + n.vx, 30, dim.w - 30);
          n.y = clamp(n.y + n.vy, 30, dim.h - 30);
        });
        return { gnodes: ns, edges: prev.edges };
      });
      // Run for ~3s after a (re)build, then stop until next interaction
      if (frames < 180) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gdata.gnodes.length, dim, rebuildKey]);

  // ── Coordinate helpers ──
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

  // ── Drag node ──
  const onNodeMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const node = gdata.gnodes.find((n) => n.id === id)!;
    const gp = toGraphPt(e.clientX, e.clientY);
    dragNode.current = { id, ox: gp.x - node.x, oy: gp.y - node.y };
  };

  // ── Pan background ──
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

  // ── Zoom (mouse wheel) ──
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const p = toSvgPt(e.clientX, e.clientY);
    const delta = -e.deltaY * 0.0012;
    setView((v) => {
      const next = clamp(v.scale * (1 + delta), 0.4, 2.5);
      const k = next / v.scale;
      return { scale: next, tx: p.x - (p.x - v.tx) * k, ty: p.y - (p.y - v.ty) * k };
    });
  };

  // ── Adjacency for highlighting ──
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

  // Compute the "active set" — IDs that should be fully bright (selected/hovered + connected).
  const activeId = selected ?? hover;
  const activeSet = (() => {
    if (!activeId) return null;
    const adj = adjacency();
    const set = new Set<string>([activeId]);
    const direct = adj.get(activeId);
    if (direct) direct.forEach((n) => set.add(n));
    // Also include grandchildren via parentId/honeypots
    gdata.gnodes.forEach((n) => {
      if (n.parentId && set.has(n.parentId)) set.add(n.id);
    });
    return set;
  })();

  // ── Filter & search ──
  const q = search.trim().toLowerCase();
  const passesFilter = (n: GNode) => {
    if (n.kind === "user") return true;
    if (filterMode === "online" && !n.online) return false;
    if (filterMode === "withpots" && n.kind === "node" && (n.potCount ?? 0) === 0) return false;
    if (filterMode === "withpots" && n.kind === "honeypot") {
      // keep honeypots whose parent passes
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

  // ── Map for fast lookup ──
  const nodeById = new Map<string, GNode>(gdata.gnodes.map((n) => [n.id, n]));

  // ── Stats ──
  const nodeCount = nodes.length;
  const onlineNodes = nodes.filter((n: any) => n.online).length;
  const potCount = deployments.length;
  const runningPots = deployments.filter((d) => d.status === "running").length;

  // ── Tooltip target ──
  const tooltipNode = activeId ? nodeById.get(activeId) : null;

  // ── Controls ──
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
        style={{ height: 520, background: "linear-gradient(180deg,#FAFBFC 0%, #F1F5F9 100%)", borderRadius: 12, position: "relative" }}
        className="flex flex-col items-center justify-center gap-2">
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "linear-gradient(135deg,#FEF3C7,#FDE68A)",
          display: "grid", placeItems: "center", color: "#B45309", fontSize: 22,
        }}>⬡</div>
        <p className="text-sm font-medium" style={{ color: "#475569" }}>No assets to display yet</p>
        <p className="text-[12px]" style={{ color: "#94A3B8" }}>Register a node to populate the topology</p>
      </div>
    );
  }

  const TonePill = ({ active, onClick, children }: any) => (
    <button onClick={onClick}
      style={{
        padding: "5px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
        border: active ? "1px solid #F59E0B" : "1px solid #E2E8F0",
        background: active ? "linear-gradient(135deg,#FEF3C7,#FDE68A)" : "#fff",
        color: active ? "#92400E" : "#475569",
        cursor: "pointer", transition: "all .15s",
      }}>{children}</button>
  );

  const IconBtn = ({ onClick, title, children }: any) => (
    <button onClick={onClick} title={title}
      style={{
        width: 30, height: 30, borderRadius: 8, border: "1px solid #E2E8F0",
        background: "#fff", color: "#475569", display: "grid", placeItems: "center",
        cursor: "pointer", fontSize: 14, fontWeight: 700,
        transition: "background .12s, box-shadow .12s",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = "#F1F5F9")}
      onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
    >{children}</button>
  );

  return (
    <div ref={fsRef} style={isFullscreen ? {
      position: "fixed", inset: 0, zIndex: 9999,
      background: "#F8FAFC", padding: "20px 24px 16px",
      display: "flex", flexDirection: "column", gap: 14,
    } : {}}>
      {/* Toolbar */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
        padding: "10px 4px 14px 4px",
      }}>
        <div style={{ position: "relative", flex: "0 1 260px", minWidth: 200 }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes, IPs, honeypots…"
            style={{
              width: "100%", padding: "8px 12px 8px 32px",
              fontSize: 12.5, borderRadius: 8, border: "1px solid #E2E8F0",
              background: "#fff", color: "#0F172A", outline: "none",
            }}
          />
          <svg viewBox="0 0 24 24" width="14" height="14"
            style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94A3B8" }}
            fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
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
          <div style={{ width: 1, height: 18, background: "#E2E8F0", margin: "0 2px" }} />
          <IconBtn onClick={toggleFullscreen} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            <FSIcon />
          </IconBtn>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef}
        style={{
          position: "relative",
          height: isFullscreen ? 0 : 520,
          flex: isFullscreen ? 1 : undefined,
          minHeight: isFullscreen ? 0 : undefined,
          borderRadius: 12, overflow: "hidden",
          background: "radial-gradient(circle at 50% 40%, #FFFFFF 0%, #F1F5F9 70%, #E2E8F0 100%)",
          border: "1px solid rgba(15,23,42,0.06)",
        }}>
        <svg ref={svgRef} width="100%" height="100%"
          style={{ display: "block", cursor: dragNode.current ? "grabbing" : panRef.current ? "grabbing" : "default" }}
          onMouseDown={onBgMouseDown}
          onMouseMove={onSvgMouseMove}
          onMouseUp={onSvgMouseUp}
          onMouseLeave={onSvgMouseUp}
          onWheel={onWheel}>

          <defs>
            {/* Gradients per kind */}
            <radialGradient id="grad-user" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#FEF3C7" />
              <stop offset="60%" stopColor="#FCD34D" />
              <stop offset="100%" stopColor="#F59E0B" />
            </radialGradient>
            <radialGradient id="grad-node" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#EFF6FF" />
              <stop offset="60%" stopColor="#93C5FD" />
              <stop offset="100%" stopColor="#3B82F6" />
            </radialGradient>
            <radialGradient id="grad-honeypot" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#ECFDF5" />
              <stop offset="60%" stopColor="#6EE7B7" />
              <stop offset="100%" stopColor="#10B981" />
            </radialGradient>
            <radialGradient id="grad-loganalyzer" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#F5F3FF" />
              <stop offset="60%" stopColor="#C4B5FD" />
              <stop offset="100%" stopColor="#7C3AED" />
            </radialGradient>
            <linearGradient id="edge-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#94A3B8" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#CBD5E1" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="edge-grad-active" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.45" />
            </linearGradient>

            {/* Per-kind glow filters */}
            {Object.entries(KIND_STYLE).map(([k, s]) => (
              <filter key={k} id={`glow-${k}`} x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feFlood floodColor={s.glow} result="color" />
                <feComposite in="color" in2="blur" operator="in" result="shadow" />
                <feMerge><feMergeNode in="shadow" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            ))}

            {/* Subtle grid pattern */}
            <pattern id="dotgrid" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.1" fill="#94A3B8" opacity="0.28" />
            </pattern>
          </defs>

          {/* Background — captures pan & wheel */}
          <rect x="0" y="0" width={dim.w} height={dim.h} fill="url(#dotgrid)" />

          {/* Viewport group with pan/zoom transform */}
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>

            {/* Edges (curved bezier) */}
            {gdata.edges.map((e) => {
              const s = nodeById.get(e.source); const t = nodeById.get(e.target);
              if (!s || !t) return null;
              if (!visibleIds.has(s.id) || !visibleIds.has(t.id)) return null;
              const isActive = !!activeSet && activeSet.has(s.id) && activeSet.has(t.id);
              const dim_ = !!activeSet && !isActive;

              // Edge colour by type
              const toLA  = s.kind === "loganalyzer" || t.kind === "loganalyzer";
              const toHP  = t.kind === "honeypot" && s.kind !== "loganalyzer";
              const passC = toLA ? "#A78BFA" : toHP ? "#34D399" : "#94A3B8";
              const actC  = toLA ? "#7C3AED" : toHP ? "#10B981" : "#F59E0B";
              const dash  = toLA ? "3 5" : toHP ? "4 5" : "6 5";

              const dx = t.x - s.x, dy = t.y - s.y;
              const mx = (s.x + t.x) / 2 + dy * 0.1;
              const my = (s.y + t.y) / 2 - dx * 0.1;
              const path = `M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`;

              return (
                <g key={`${e.source}-${e.target}`} opacity={dim_ ? 0.1 : 1}
                  style={{ transition: "opacity .25s" }}>
                  {/* Invisible wide hit-area */}
                  <path d={path} stroke="transparent" strokeWidth="10" fill="none" />
                  {/* Visible line */}
                  <path d={path}
                    stroke={isActive ? actC : passC}
                    strokeWidth={isActive ? 2.2 : 1.2}
                    fill="none"
                    strokeDasharray={isActive ? "0" : dash}
                    strokeOpacity={isActive ? 1 : 0.6}
                    style={{ transition: "stroke .2s, stroke-width .15s" }}
                  />
                  {/* Animated flow particle */}
                  {isActive && (
                    <circle r="3.5" fill={actC}>
                      <animateMotion
                        dur={toLA ? "1.1s" : "1.6s"}
                        repeatCount="indefinite"
                        path={path}
                        keyPoints="1;0"
                        keyTimes="0;1"
                        calcMode="linear"
                      />
                    </circle>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {gdata.gnodes.map((gn) => {
              if (!visibleIds.has(gn.id)) return null;
              const s = KIND_STYLE[gn.kind];
              const isOffline  = gn.online === false;
              const isAgentWarn = gn.kind === "node" && isOffline && (gn.runningPots ?? 0) > 0;
              const isActive   = !!activeSet && activeSet.has(gn.id);
              const isHovered  = hover === gn.id;
              const opacity    = !!activeSet && !isActive ? 0.18 : 1;
              const isPulsing  = gn.online !== false && gn.kind !== "user";
              // Icon size: fits snugly (diagonal ≤ r√2)
              const iSize = gn.kind === "user" ? 20 : gn.kind === "node" ? 15 : gn.kind === "loganalyzer" ? 13 : 11;
              const iHalf = iSize / 2;
              const labelTxt = gn.label.length > 15 ? gn.label.slice(0, 14) + "…" : gn.label;
              const labelBgW = Math.max(labelTxt.length * 6.4 + 14, 42);

              return (
                <g key={gn.id} opacity={opacity}
                  style={{
                    cursor: "grab",
                    transition: "opacity .25s",
                    animation: "svgNodeIn 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both",
                    transformBox: "fill-box",
                    transformOrigin: "center center",
                  }}
                  onMouseDown={(e) => onNodeMouseDown(e, gn.id)}
                  onMouseEnter={() => setHover(gn.id)}
                  onMouseLeave={() => setHover(null)}
                  onClick={(e) => { e.stopPropagation(); setSelected(selected === gn.id ? null : gn.id); }}>

                  {/* Ambient halo — blooms on hover */}
                  <circle cx={gn.x} cy={gn.y}
                    r={isHovered ? s.r + 18 : s.r + 7}
                    fill={isOffline ? "transparent" : s.glow}
                    opacity={isHovered ? 0.42 : 0.2}
                    style={{ transition: "r .22s ease, opacity .22s ease" }}
                  />

                  {/* Pulse ring (online nodes only) */}
                  {isPulsing && (
                    <circle cx={gn.x} cy={gn.y} r={s.r + 3} fill="none"
                      stroke={s.ring} strokeWidth="1.5" opacity="0">
                      <animate attributeName="r"
                        values={`${s.r + 1};${s.r + 18};${s.r + 1}`}
                        dur={gn.kind === "user" ? "3.2s" : "2.6s"}
                        repeatCount="indefinite" />
                      <animate attributeName="opacity"
                        values="0.6;0;0.6"
                        dur={gn.kind === "user" ? "3.2s" : "2.6s"}
                        repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Drop shadow */}
                  <circle cx={gn.x} cy={gn.y + 2} r={s.r}
                    fill="rgba(15,23,42,0.18)" style={{ filter: "blur(4px)" }} />

                  {/* Main body */}
                  <circle cx={gn.x} cy={gn.y} r={s.r}
                    fill={isOffline ? OFFLINE_FILL : `url(#${s.gradId})`}
                    stroke={isOffline ? OFFLINE_STROKE : isHovered ? s.ring : s.stroke}
                    strokeWidth={gn.kind === "user" ? 3 : isHovered ? 2.8 : 2}
                    filter={`url(#glow-${gn.kind})`}
                    style={{ transition: "stroke .15s, stroke-width .15s" }}
                  />

                  {/* Inner frosted cap — lifts icon off the gradient */}
                  {!isOffline && (
                    <circle cx={gn.x} cy={gn.y} r={s.r * 0.65}
                      fill="rgba(255,255,255,0.2)" />
                  )}

                  {/* Rotating selection ring */}
                  {selected === gn.id && (
                    <circle cx={gn.x} cy={gn.y} r={s.r + 7} fill="none"
                      stroke="#F59E0B" strokeWidth="2.5"
                      strokeDasharray="5 4" strokeLinecap="round">
                      <animateTransform attributeName="transform" type="rotate"
                        from={`0 ${gn.x} ${gn.y}`} to={`360 ${gn.x} ${gn.y}`}
                        dur="9s" repeatCount="indefinite" />
                    </circle>
                  )}

                  {/* Icon — properly centred via SVG x/y, sized to stay inside circle */}
                  <svg x={gn.x - iHalf} y={gn.y - iHalf}
                    width={iSize} height={iSize}
                    viewBox="0 0 24 24" fill="none"
                    stroke={isOffline ? "#94A3B8" : "#fff"}
                    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    style={{ pointerEvents: "none", overflow: "hidden" }}>
                    <path d={KIND_ICON[gn.kind]}
                      fill={gn.kind === "honeypot" && !isOffline ? "rgba(255,255,255,0.3)" : "none"} />
                  </svg>

                  {/* Honeypot count badge */}
                  {gn.kind === "node" && (gn.potCount ?? 0) > 0 && (
                    <g transform={`translate(${gn.x + s.r * 0.72}, ${gn.y + s.r * 0.72})`}>
                      <circle r="9.5" fill={gn.online ? "#059669" : "#64748B"} stroke="#fff" strokeWidth="2" />
                      <text textAnchor="middle" y="3.5" fontSize="8.5" fontWeight="800" fill="#fff"
                        style={{ pointerEvents: "none", userSelect: "none", fontFamily: "ui-monospace,monospace" }}>
                        {gn.potCount}
                      </text>
                    </g>
                  )}

                  {/* Status dot */}
                  {gn.kind !== "user" && (
                    <circle cx={gn.x + s.r * 0.72} cy={gn.y - s.r * 0.72} r="5"
                      fill={gn.online ? "#22C55E" : isAgentWarn ? "#F59E0B" : "#94A3B8"}
                      stroke="#fff" strokeWidth="1.8" />
                  )}

                  {/* Label pill */}
                  <g style={{ pointerEvents: "none", userSelect: "none" }}>
                    <rect
                      x={gn.x - labelBgW / 2} y={gn.y + s.r + 7}
                      width={labelBgW} height={15} rx={7.5}
                      fill="rgba(255,255,255,0.92)"
                      stroke={s.stroke + "30"} strokeWidth="1"
                    />
                    <text x={gn.x} y={gn.y + s.r + 18}
                      textAnchor="middle"
                      fontSize={gn.kind === "user" ? 11 : gn.kind === "node" ? 10 : 9}
                      fontWeight="700"
                      fill={gn.kind === "user" ? "#92400E" : gn.kind === "node" ? "#1E40AF" : gn.kind === "loganalyzer" ? "#5B21B6" : "#065F46"}>
                      {labelTxt}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </svg>

        {/* ── Floating stats panel (top-left) ── */}
        <div style={{
          position: "absolute", top: 12, left: 12,
          background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(15,23,42,0.08)", borderRadius: 10,
          padding: "10px 14px", display: "flex", gap: 18, fontSize: 11.5,
          boxShadow: "0 4px 16px rgba(15,23,42,0.05)",
        }}>
          <div>
            <div style={{ color: "#94A3B8", fontWeight: 600, letterSpacing: 0.4 }}>NODES</div>
            <div style={{ color: "#0F172A", fontWeight: 700, fontSize: 16 }}>
              {nodeCount}
              <span style={{ fontSize: 11, color: "#22C55E", marginLeft: 6 }}>● {onlineNodes}</span>
            </div>
          </div>
          <div style={{ width: 1, background: "rgba(15,23,42,0.08)" }} />
          <div>
            <div style={{ color: "#94A3B8", fontWeight: 600, letterSpacing: 0.4 }}>HONEYPOTS</div>
            <div style={{ color: "#0F172A", fontWeight: 700, fontSize: 16 }}>
              {potCount}
              <span style={{ fontSize: 11, color: "#22C55E", marginLeft: 6 }}>● {runningPots}</span>
            </div>
          </div>
        </div>

        {/* ── Tooltip (rich detail card) ── */}
        {tooltipNode && (() => {
          const s = KIND_STYLE[tooltipNode.kind];
          const screenX = tooltipNode.x * view.scale + view.tx;
          const screenY = tooltipNode.y * view.scale + view.ty;
          const left = Math.min(Math.max(screenX + s.r * view.scale + 14, 12), dim.w - 230);
          const top = clamp(screenY - 30, 12, dim.h - 130);
          return (
            <div style={{
              position: "absolute", left, top,
              background: "rgba(15,23,42,0.96)", backdropFilter: "blur(6px)",
              color: "#F1F5F9", borderRadius: 10, padding: "10px 14px",
              fontSize: 12, minWidth: 200, maxWidth: 240,
              boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
              border: "1px solid rgba(255,255,255,0.08)",
              pointerEvents: "none", zIndex: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: tooltipNode.kind === "user" ? "#F59E0B" :
                              tooltipNode.online ? "#22C55E" : "#94A3B8",
                }} />
                <span style={{ fontWeight: 700, fontSize: 13 }}>{tooltipNode.label}</span>
              </div>
              <div style={{ color: "#94A3B8", textTransform: "uppercase", fontSize: 10, letterSpacing: 0.6, marginBottom: 4 }}>
                {tooltipNode.kind}
              </div>
              {tooltipNode.kind === "node" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 3, fontSize: 11.5 }}>
                  {tooltipNode.hostname && (<><span style={{ color: "#64748B" }}>host</span><span>{tooltipNode.hostname}</span></>)}
                  {tooltipNode.ip && (<><span style={{ color: "#64748B" }}>ip</span><span style={{ fontFamily: "monospace" }}>{tooltipNode.ip}</span></>)}
                  {tooltipNode.os && (<><span style={{ color: "#64748B" }}>os</span><span>{tooltipNode.os}</span></>)}
                  <span style={{ color: "#64748B" }}>pots</span><span>{tooltipNode.potCount ?? 0}</span>
                  <span style={{ color: "#64748B" }}>agent</span>
                  <span style={{ color: tooltipNode.online ? "#4ADE80" : "#F87171" }}>
                    {tooltipNode.online ? "online" : "offline"}
                  </span>
                  {!tooltipNode.online && (tooltipNode.runningPots ?? 0) > 0 && (
                    <><span style={{ color: "#64748B" }}>pots</span>
                    <span style={{ color: "#34D399" }}>{tooltipNode.runningPots} running</span></>
                  )}
                </div>
              )}
              {tooltipNode.kind === "honeypot" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 3, fontSize: 11.5 }}>
                  <span style={{ color: "#64748B" }}>type</span><span>{tooltipNode.potType}</span>
                  <span style={{ color: "#64748B" }}>id</span><span style={{ fontFamily: "monospace" }}>{tooltipNode.potId}</span>
                  <span style={{ color: "#64748B" }}>status</span>
                  <span style={{ color: tooltipNode.online ? "#4ADE80" : "#94A3B8" }}>
                    {tooltipNode.status}
                  </span>
                </div>
              )}
              {tooltipNode.kind === "loganalyzer" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 3, fontSize: 11.5 }}>
                  {tooltipNode.laWorkspaceName && (
                    <><span style={{ color: "#64748B" }}>workspace</span><span>{tooltipNode.laWorkspaceName}</span></>
                  )}
                  {tooltipNode.laWorkspaceUrl && (
                    <><span style={{ color: "#64748B" }}>url</span>
                    <a href={tooltipNode.laWorkspaceUrl} target="_blank" rel="noreferrer"
                      style={{ color: "#A78BFA", pointerEvents: "auto", fontFamily: "monospace", wordBreak: "break-all" }}>
                      open ↗
                    </a></>
                  )}
                  <span style={{ color: "#64748B" }}>status</span>
                  <span style={{ color: "#4ADE80" }}>active</span>
                </div>
              )}
              {tooltipNode.kind === "user" && email && (
                <div style={{ fontSize: 11.5, color: "#CBD5E1" }}>{email}</div>
              )}
            </div>
          );
        })()}

        {/* ── Legend (bottom-right) ── */}
        <div style={{
          position: "absolute", bottom: 12, right: 12,
          background: "rgba(255,255,255,0.85)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(15,23,42,0.08)", borderRadius: 10,
          padding: "8px 12px", display: "flex", gap: 14, fontSize: 11, color: "#475569",
          boxShadow: "0 4px 16px rgba(15,23,42,0.05)",
        }}>
          {[
            { color: "#F59E0B", label: "User" },
            { color: "#3B82F6", label: "Node" },
            { color: "#10B981", label: "Honeypot" },
            { color: "#F59E0B", label: "Agent offline + pots active", dot: true },
            { color: "#94A3B8", label: "Offline" },
            { color: "#7C3AED", label: "Log Analyser" },
          ].map(({ color, label, dot }) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 600 }}>
              <span style={{
                width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block",
                boxShadow: `0 0 6px ${color}66`,
                border: dot ? "1.5px dashed #92400E" : undefined,
              }} />
              {label}
            </span>
          ))}
        </div>

        {/* ── Help hint (bottom-left) ── */}
        <div style={{
          position: "absolute", bottom: 12, left: 12, fontSize: 10.5,
          color: "#94A3B8", letterSpacing: 0.3,
        }}>
          drag&nbsp;nodes&nbsp;·&nbsp;scroll&nbsp;to&nbsp;zoom&nbsp;·&nbsp;drag&nbsp;canvas&nbsp;to&nbsp;pan&nbsp;·&nbsp;click&nbsp;to&nbsp;focus
        </div>
      </div>
    </div>
  );
}

const ICON = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const I = {
  server:    "M5 12H3a2 2 0 01-2-2V5a2 2 0 012-2h18a2 2 0 012 2v5a2 2 0 01-2 2h-2M5 12h14M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7M7 7h.01M7 17h.01",
  online:    "M5 13l4 4L19 7",
  offline:   "M18 6L6 18M6 6l12 12",
  bolt:      "M13 2L3 14h7l-1 8 10-12h-7l1-8z",
  globe:     "M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20",
  shield:    "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
};

function StatCard({ label, value, sub, iconPath, tone = "amber" }:
  { label: string; value: any; sub?: string; iconPath: string; tone?: "amber" | "green" | "slate" | "red" | "blue" }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    amber: { bg: "linear-gradient(135deg,#FEF3C7,#FDE68A)", fg: "#B45309" },
    green: { bg: "#DCFCE7", fg: "#15803D" },
    slate: { bg: "#F1F5F9", fg: "#475569" },
    red:   { bg: "#FEE2E2", fg: "#B91C1C" },
    blue:  { bg: "#DBEAFE", fg: "#1E40AF" },
  };
  return (
    <div className="card-stat" style={{ padding: "20px 22px" }}>
      <div className="flex items-start justify-between gap-3">
        <p className="page-label">{label}</p>
        <div className="h-8 w-8 rounded-lg grid place-items-center" style={{ background: tones[tone].bg, color: tones[tone].fg }}>
          <ICON d={iconPath} />
        </div>
      </div>
      <p className="stat-number mt-3">{value ?? "—"}</p>
      {sub && <p className="text-[12px] mt-1.5" style={{ color: "#64748B" }}>{sub}</p>}
    </div>
  );
}

function fmtHour(bucket: string) {
  try { return new Date(bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return bucket; }
}

export default function DashboardPage() {
  const email = useAuthStore((s) => s.email);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => (await api.get("/events/stats")).data,
    refetchInterval: 10000,
  });
  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    refetchInterval: 10000,
  });
  const { data: deployments } = useQuery<Deployment[]>({
    queryKey: ["deployments"],
    queryFn: async () => (await api.get("/deployments")).data,
    refetchInterval: 15000,
  });
  const { data: alertCount } = useQuery({
    queryKey: ["alert-count"],
    queryFn: async () => (await api.get("/alerts/count")).data,
    refetchInterval: 10000,
  });
  const { connected } = useWebSocket(["events", "nodes"]);

  const total   = (nodes ?? []).length;
  const online  = (nodes ?? []).filter((n: any) => n.online).length;
  const offline = total - online;
  const timeline = stats?.timeline ?? [];

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Monitor your HoneyBee infrastructure</p>
        </div>
        <div className="flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold"
             style={connected
               ? { background: "#F0FDF4", border: "1px solid #86EFAC", color: "#15803D" }
               : { background: "#FFFBEB", border: "1px solid #FCD34D", color: "#92400E" }}>
          <span className={`w-1.5 h-1.5 ${connected ? "dot-online" : "dot-offline"}`} />
          {connected ? "System Online" : "Connecting…"}
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total nodes"  value={total}    sub={`${online} online · ${offline} offline`} iconPath={I.server}  tone="amber" />
        <StatCard label="Online"       value={online}   sub="Active nodes"                              iconPath={I.online}  tone="green" />
        <StatCard label="Offline"      value={offline}  sub="Disconnected"                              iconPath={I.offline} tone="slate" />
        <StatCard label="Total events" value={stats?.total_events} sub="Captured attacks"               iconPath={I.bolt}    tone="amber" />
        <StatCard label="Unique IPs"   value={stats?.unique_ips}   sub="Distinct attackers"             iconPath={I.globe}   tone="red" />
        <StatCard label="Alerts"       value={alertCount?.count ?? 0}  sub="Unacknowledged"             iconPath={I.shield}  tone="blue" />
      </div>

      {/* Timeline Chart */}
      {timeline.length > 0 && (
        <div className="card p-5">
          <p className="section-label">Attack Timeline (24h)</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline}>
                <defs>
                  <linearGradient id="dashGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="bucket" tickFormatter={fmtHour} tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Area type="monotone" dataKey="count" stroke="#F59E0B" strokeWidth={2} fill="url(#dashGrad)" name="Events" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Asset Topology */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between gap-3"
             style={{ borderBottom: "1px solid rgba(15,23,42,0.06)", background: "linear-gradient(180deg,#FFFFFF,#F8FAFC)" }}>
          <div className="flex items-center gap-3">
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "linear-gradient(135deg,#FEF3C7,#FDE68A)",
              display: "grid", placeItems: "center", color: "#B45309",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <circle cx="4" cy="4" r="2" />
                <circle cx="20" cy="4" r="2" />
                <circle cx="4" cy="20" r="2" />
                <circle cx="20" cy="20" r="2" />
                <path d="M12 12L4 4M12 12L20 4M12 12L4 20M12 12L20 20" />
              </svg>
            </div>
            <div>
              <p className="section-label" style={{ marginBottom: 0 }}>Asset Topology</p>
              <p className="text-[11px] mt-0.5" style={{ color: "#94A3B8" }}>
                Interactive map of your infrastructure
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-honey">{(nodes ?? []).length} nodes</span>
            <span className="badge" style={{
              background: "#DCFCE7", color: "#15803D", border: "1px solid #86EFAC",
              padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 700,
            }}>{(deployments ?? []).length} honeypots</span>
            <Link to="/topology"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition"
              style={{
                background: "linear-gradient(135deg,#FEF3C7,#FDE68A)",
                color: "#B45309",
                border: "1px solid rgba(180,83,9,0.25)",
                textDecoration: "none",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
              Open Designer
            </Link>
          </div>
        </div>
        <div className="p-4">
          <AssetTopologyGraph
            nodes={nodes ?? []}
            deployments={deployments ?? []}
            email={email}
          />
        </div>
      </div>
    </div>
  );
}
