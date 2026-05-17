import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client";
import { Icon, Icons } from "../components/Icons";

/* ── PNG icon imports ─────────────────────────────────────────────── */
import internetIcon   from "../../icons/Internet.png";
import firewallIcon   from "../../icons/firewall.png";
import routerIcon     from "../../icons/router.png";
import switchIcon     from "../../icons/switch.png";
import serverIcon     from "../../icons/server.png";
import linuxIcon      from "../../icons/linux-server-100.png";
import windowsIcon    from "../../icons/server-windows-100.png";
import macIcon        from "../../icons/mac-studio-50.png";
import honeypotIcon   from "../../icons/honeyPot.png";
import dmzIcon        from "../../icons/dmz.png";
import databaseIcon   from "../../icons/database.png";
import mysqlIcon      from "../../icons/mysql.png";
import loganalyzerIcon from "../../icons/icons8-logs-64.png";

/* ══════════════════════════════════════════════════════════════════
   Types
══════════════════════════════════════════════════════════════════ */
type NodeKind =
  | "internet" | "firewall"  | "router"   | "switch"
  | "server"   | "linux"     | "windows"  | "workstation"
  | "honeypot" | "dmz"       | "database" | "mysql"
  | "loganalyzer";

interface TopoNode {
  id:       string;
  kind:     NodeKind;
  label:    string;
  x:        number;
  y:        number;
  fixed:    boolean;
  ip?:      string;
  notes?:   string;
  potType?: string;   // for honeypot kind – cowrie / honnypotter / webtrap / etc.
  online?:  boolean;  // for live-imported nodes
}

interface TopoEdge { id: string; source: string; target: string }
interface Topology  { nodes: TopoNode[]; edges: TopoEdge[] }

/* ── Known honeypot types from PotStore ──────────────────────────── */
const KNOWN_POT_TYPES = [
  { id:"cowrie",      label:"Cowrie",       desc:"SSH / Telnet honeypot",         color:"#F59E0B" },
  { id:"honnypotter", label:"HonnyPotter",  desc:"WordPress login trap",           color:"#7C3AED" },
  { id:"webtrap",     label:"WebTrap",      desc:"HTTP deception traps",           color:"#0EA5E9" },
  { id:"dionaea",     label:"Dionaea",      desc:"Multi-protocol malware capture", color:"#EF4444" },
  { id:"heralding",   label:"Heralding",    desc:"Multi-service credential trap",  color:"#F97316" },
  { id:"elasticpot",  label:"ElasticPot",   desc:"Fake Elasticsearch endpoint",    color:"#06B6D4" },
  { id:"mailoney",    label:"Mailoney",     desc:"SMTP honeypot",                  color:"#22C55E" },
  { id:"custom",      label:"Custom…",      desc:"Type your own",                  color:"#94A3B8" },
];

/* ── Palette ──────────────────────────────────────────────────────── */
interface PaletteItem {
  kind:   NodeKind;
  label:  string;
  img:    string;
  stroke: string;
  fill:   string;
  group:  "network" | "systems" | "security";
}

const PALETTE: PaletteItem[] = [
  { kind:"internet",    label:"Internet",    img:internetIcon,  stroke:"#3B82F6", fill:"#EFF6FF", group:"network"  },
  { kind:"firewall",    label:"Firewall",    img:firewallIcon,  stroke:"#EF4444", fill:"#FEF2F2", group:"network"  },
  { kind:"router",      label:"Router",      img:routerIcon,    stroke:"#D97706", fill:"#FFFBEB", group:"network"  },
  { kind:"switch",      label:"Switch",      img:switchIcon,    stroke:"#8B5CF6", fill:"#F5F3FF", group:"network"  },
  { kind:"dmz",         label:"DMZ",         img:dmzIcon,       stroke:"#EA580C", fill:"#FFF7ED", group:"network"  },
  { kind:"server",      label:"Server",      img:serverIcon,    stroke:"#059669", fill:"#ECFDF5", group:"systems"  },
  { kind:"linux",       label:"Linux",       img:linuxIcon,     stroke:"#0891B2", fill:"#ECFEFF", group:"systems"  },
  { kind:"windows",     label:"Windows",     img:windowsIcon,   stroke:"#0078D4", fill:"#EFF6FF", group:"systems"  },
  { kind:"workstation", label:"Workstation", img:macIcon,       stroke:"#64748B", fill:"#F8FAFC", group:"systems"  },
  { kind:"database",    label:"Database",    img:databaseIcon,  stroke:"#0E7490", fill:"#ECFEFF", group:"systems"  },
  { kind:"mysql",       label:"MySQL",       img:mysqlIcon,     stroke:"#DE6914", fill:"#FFF7ED", group:"systems"  },
  { kind:"honeypot",     label:"Honeypot",     img:honeypotIcon,     stroke:"#F59E0B", fill:"#FFFBEB", group:"security" },
  { kind:"loganalyzer",  label:"Log Analyser", img:loganalyzerIcon,  stroke:"#7C3AED", fill:"#F5F3FF", group:"security" },
];

const KIND_META: Record<NodeKind, PaletteItem> = Object.fromEntries(
  PALETTE.map(p => [p.kind, p]),
) as Record<NodeKind, PaletteItem>;

/* SVG fallback icons — shown when PNG fails to load (viewBox 0 0 24 24) */
const KIND_FALLBACK_ICON: Record<NodeKind, string> = {
  internet:    "M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 0c-3 4-3 16 0 20m0-20c3 4 3 16 0 20M2 12h20",
  firewall:    "M12 2L4 6v6c0 5.25 3.5 10.15 8 11.25C16.5 22.15 20 17.25 20 12V6l-8-4z",
  router:      "M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01",
  switch:      "M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01",
  dmz:         "M3 3h18v6H3zM3 15h18v6H3zM12 9v6",
  server:      "M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01",
  linux:       "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 14.5l-4-4 1.4-1.4L10 13.7l6.6-6.6L18 8.5l-8 8z",
  windows:     "M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z",
  workstation: "M2 3h20v14H2zM8 21h8M12 17v4",
  database:    "M12 2C7 2 3 4.3 3 7v10c0 2.7 4 5 9 5s9-2.3 9-5V7c0-2.7-4-5-9-5zm0 0C7 2 3 4.3 3 7m18 0c0 2.7-4 5-9 5S3 9.7 3 7m18 6c0 2.7-4 5-9 5S3 15.7 3 13",
  mysql:       "M12 2C7 2 3 4.3 3 7v10c0 2.7 4 5 9 5s9-2.3 9-5V7c0-2.7-4-5-9-5zm0 0C7 2 3 4.3 3 7m18 0c0 2.7-4 5-9 5S3 9.7 3 7",
  honeypot:    "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  loganalyzer: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4",
};

const PALETTE_GROUPS = [
  { id:"network"  as const, label:"Network",  icon:Icons.network },
  { id:"systems"  as const, label:"Systems",  icon:Icons.server  },
  { id:"security" as const, label:"Security", icon:Icons.shield  },
];

/* ── Dimensions ───────────────────────────────────────────────────── */
const NW   = 100;   // node card width
const NH   = 110;   // node card height
const ICON = 48;    // icon image size
const GRID = 24;    // snap-to-grid

/* ── Auto-layout ──────────────────────────────────────────────────── */
const LAYER_MAP: NodeKind[][] = [
  ["internet"],
  ["firewall"],
  ["router", "dmz"],
  ["switch"],
  ["server", "linux", "windows", "workstation", "database", "mysql"],
  ["loganalyzer"],
  ["honeypot"],
];

function autoLayout(nodes: TopoNode[]): TopoNode[] {
  const LAYER_H  = 145;   // vertical gap between layers
  const MIN_COL  = 130;   // minimum horizontal gap between nodes in same layer
  const PAD_X    = 90;
  const PAD_Y    = 50;

  return nodes.map(n => {
    const li = LAYER_MAP.findIndex(g => g.includes(n.kind));
    const layer = li >= 0 ? li : LAYER_MAP.length - 1;
    const peers = nodes.filter(nn => {
      const ll = LAYER_MAP.findIndex(g => g.includes(nn.kind));
      return (ll >= 0 ? ll : LAYER_MAP.length - 1) === layer;
    });
    const pos = peers.indexOf(n);
    const colW = Math.max(MIN_COL, NW + 60);
    const totalW = peers.length * colW;
    return {
      ...n,
      x: PAD_X + pos * colW + (colW - NW) / 2 - totalW / 2 + totalW / 2,
      y: PAD_Y + layer * LAYER_H,
    };
  });
}

/* ── Port-based edge routing ─────────────────────────────────────── */
type PortSide = "top" | "bottom" | "left" | "right";

function nodePort(node: TopoNode, targetCX: number, targetCY: number): { x: number; y: number; side: PortSide } {
  const cx = node.x + NW / 2, cy = node.y + NH / 2;
  const dx = targetCX - cx,   dy = targetCY - cy;
  // Compare slopes against card aspect ratio to pick the right port
  if (Math.abs(dy) * NW >= Math.abs(dx) * NH) {
    return dy > 0
      ? { x: cx, y: node.y + NH, side: "bottom" }
      : { x: cx, y: node.y,      side: "top"    };
  }
  return dx > 0
    ? { x: node.x + NW, y: cy, side: "right" }
    : { x: node.x,      y: cy, side: "left"  };
}

function smartPath(sx: number, sy: number, tx: number, ty: number, ss: PortSide, ts: PortSide) {
  const dist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
  const bend = Math.max(32, Math.min(dist * 0.42, 90));
  let c1x = sx, c1y = sy, c2x = tx, c2y = ty;
  if      (ss === "bottom") c1y = sy + bend;
  else if (ss === "top")    c1y = sy - bend;
  else if (ss === "right")  c1x = sx + bend;
  else                      c1x = sx - bend;
  if      (ts === "top")    c2y = ty - bend;
  else if (ts === "bottom") c2y = ty + bend;
  else if (ts === "left")   c2x = tx - bend;
  else                      c2x = tx + bend;
  return `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`;
}

/* ── Analysis ─────────────────────────────────────────────────────── */
interface Finding { level:"good"|"warn"|"critical"|"info"; title:string; detail:string }

function analyzeTopology({ nodes, edges }: Topology): Finding[] {
  const out: Finding[] = [];
  if (nodes.length === 0) return [{ level:"info", title:"Empty canvas", detail:"Add nodes to start." }];
  const byKind  = (k:NodeKind) => nodes.filter(n=>n.kind===k);
  const hasKind = (k:NodeKind) => byKind(k).length > 0;
  const nbrs    = (id:string) =>
    edges.filter(e=>e.source===id||e.target===id)
         .map(e=>e.source===id?e.target:e.source)
         .map(tid=>nodes.find(n=>n.id===tid)!);

  if (!hasKind("firewall"))
    out.push({ level:"critical", title:"No firewall present",
      detail:"Every network design needs at least one firewall between untrusted and trusted segments." });
  else if (byKind("firewall").length >= 2)
    out.push({ level:"good", title:"Redundant firewalls",
      detail:"Two or more firewalls offer high-availability and defence-in-depth." });

  byKind("internet").forEach(inet =>
    nbrs(inet.id).forEach(n => {
      if (!n) return;
      if (["server","linux","windows","workstation"].includes(n.kind))
        out.push({ level:"critical", title:`"${n.label}" directly on internet`,
          detail:"Internal systems should sit behind a firewall or router, not directly on the internet." });
    })
  );

  byKind("honeypot").forEach(hp => {
    const nb = nbrs(hp.id);
    const segmented = nb.some(n=>["firewall","router","dmz"].includes(n?.kind??""));
    if (!segmented)
      out.push({ level:"warn", title:`Honeypot "${hp.label}" not segmented`,
        detail:"Place honeypots behind a DMZ or firewall to control blast radius." });
    else
      out.push({ level:"good", title:`Honeypot "${hp.label}" correctly placed`,
        detail:"This honeypot sits behind a controlled boundary — attacker reach is limited." });
  });

  if (!hasKind("honeypot"))
    out.push({ level:"info", title:"No honeypots in design",
      detail:"Add honeypots in DMZ or internal subnets to detect lateral movement." });

  byKind("dmz").forEach(dmz => {
    const guarded = nbrs(dmz.id).some(n=>["firewall","router"].includes(n?.kind??""));
    if (!guarded)
      out.push({ level:"warn", title:`DMZ "${dmz.label}" unguarded`,
        detail:"Connect this DMZ to a firewall or router to isolate it properly." });
    else
      out.push({ level:"good", title:`DMZ "${dmz.label}" correctly guarded`, detail:"" });
  });

  byKind("database").concat(byKind("mysql")).forEach(db => {
    if (nbrs(db.id).some(n=>n?.kind==="internet"))
      out.push({ level:"critical", title:`Database "${db.label}" exposed to internet`,
        detail:"Databases must never be directly reachable from the internet." });
  });

  nodes.filter(n=>!edges.some(e=>e.source===n.id||e.target===n.id))
       .forEach(n=>out.push({ level:"warn", title:`"${n.label}" isolated`, detail:"Node has no connections." }));

  if (hasKind("firewall")&&hasKind("honeypot")&&hasKind("dmz")&&!out.some(f=>f.level==="critical"))
    out.unshift({ level:"good", title:"Solid deception architecture",
      detail:"Firewalls + DMZ + honeypots in place — excellent layered defence." });

  return out;
}

function computeScore(findings: Finding[]) {
  let s = 80;
  findings.forEach(f => {
    if (f.level==="critical") s -= 25;
    else if (f.level==="warn") s -= 10;
    else if (f.level==="good") s += 6;
  });
  return Math.max(0, Math.min(100, s));
}

/* ── Persist ──────────────────────────────────────────────────────── */
const STORE_KEY = "honeybee_drafts_v3";
interface Saved { id:string; name:string; savedAt:string; data:Topology }
const loadSaved  = (): Saved[] => { try { return JSON.parse(localStorage.getItem(STORE_KEY)??"[]"); } catch { return []; } };
const persistAll = (list:Saved[]) => localStorage.setItem(STORE_KEY, JSON.stringify(list));

function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6); }

/* ── Level styles ─────────────────────────────────────────────────── */
const LVL: Record<Finding["level"], { bg:string; fg:string; dot:string; lbl:string }> = {
  good:     { bg:"#ECFDF5", fg:"#065F46", dot:"#10B981", lbl:"Good"     },
  warn:     { bg:"#FFFBEB", fg:"#92400E", dot:"#F59E0B", lbl:"Warning"  },
  critical: { bg:"#FEF2F2", fg:"#991B1B", dot:"#EF4444", lbl:"Critical" },
  info:     { bg:"#EFF6FF", fg:"#1E40AF", dot:"#3B82F6", lbl:"Info"     },
};

const scoreColor = (s:number) => s>=70?"#10B981":s>=45?"#F59E0B":"#EF4444";

/* ── Live API types ───────────────────────────────────────────────── */
interface LiveNode {
  id:number; name:string; online:boolean;
  os?:string; ip_address?:string; hostname?:string;
  la_enabled?:boolean; la_workspace_name?:string; la_workspace_url?:string;
}
interface LiveDeployment {
  id:number; node_id:number; honeypot_type:string; pot_id:string; status:string;
}

/* ══════════════════════════════════════════════════════════════════
   Main component
══════════════════════════════════════════════════════════════════ */
interface CtxMenu { x:number; y:number; nid:string }

export default function TopologyPage() {
  /* canvas state */
  const [nodes,        setNodes       ] = useState<TopoNode[]>([]);
  const [edges,        setEdges       ] = useState<TopoEdge[]>([]);
  const [selected,     setSelected    ] = useState<string|null>(null);
  const [connectMode,  setConnectMode ] = useState(false);
  const [connectFirst, setConnectFirst] = useState<string|null>(null);
  const [editingId,    setEditingId   ] = useState<string|null>(null);
  const [labelDraft,   setLabelDraft  ] = useState("");
  const [ctxMenu,      setCtxMenu     ] = useState<CtxMenu|null>(null);
  const [imgLoaded,    setImgLoaded   ] = useState<Set<NodeKind>>(new Set());
  const [draggingKind, setDraggingKind] = useState<NodeKind|null>(null);
  const [hoveredEdge,  setHoveredEdge  ] = useState<string|null>(null);

  /* pan / zoom */
  const [pan,   setPan  ] = useState({ x:80, y:40 });
  const [scale, setScale] = useState(0.9);
  const isPanning    = useRef(false);
  const panStart     = useRef({ mx:0, my:0, tx:0, ty:0 });
  const draggingNode = useRef<{ id:string; ox:number; oy:number }|null>(null);
  const [mousePos,   setMousePos] = useState({ x:0, y:0 });

  /* properties panel */
  const [propIp,      setPropIp     ] = useState("");
  const [propNotes,   setPropNotes  ] = useState("");
  const [propPotType, setPropPotType] = useState("");
  const [customPot,   setCustomPot  ] = useState("");

  /* panels */
  const [showOpinion,    setShowOpinion   ] = useState(false);
  const [showSave,       setShowSave      ] = useState(false);
  const [showLoad,       setShowLoad      ] = useState(false);
  const [showImport,     setShowImport    ] = useState(false);
  const [saveName,       setSaveName      ] = useState("");
  const [savedList,      setSavedList     ] = useState<Saved[]>(loadSaved);
  const [analysis,       setAnalysis      ] = useState<Finding[]>([]);
  const [score,          setScore         ] = useState(0);
  const [importing,      setImporting     ] = useState(false);
  const [importResult,   setImportResult  ] = useState<{nodes:number;deps:number}|null>(null);
  const [importErr,      setImportErr     ] = useState("");

  /* undo/redo */
  const [history, setHistory] = useState<Topology[]>([]);
  const [future,  setFuture ] = useState<Topology[]>([]);

  /* canvas dimensions */
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<SVGSVGElement>(null);
  const pageRef      = useRef<HTMLDivElement>(null);
  const [dim, setDim] = useState({ w:1000, h:600 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(es => {
      for (const e of es) setDim({ w:e.contentRect.width, h:e.contentRect.height });
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
    if (!document.fullscreenElement) {
      pageRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  /* sync props when selection changes */
  useEffect(() => {
    const n = nodes.find(n=>n.id===selected);
    setPropIp(n?.ip??"");
    setPropNotes(n?.notes??"");
    const pt = n?.potType??"";
    const isKnown = KNOWN_POT_TYPES.some(t=>t.id===pt&&t.id!=="custom");
    setPropPotType(pt && !isKnown ? "custom" : pt);
    setCustomPot(pt && !isKnown ? pt : "");
  }, [selected]); // eslint-disable-line

  /* ── History ── */
  const push = useCallback((pn:TopoNode[], pe:TopoEdge[]) => {
    setHistory(h=>[...h.slice(-49),{nodes:pn,edges:pe}]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length-1];
      setFuture(f=>[{nodes,edges},...f]);
      setNodes(prev.nodes); setEdges(prev.edges);
      return h.slice(0,-1);
    });
  // eslint-disable-next-line
  }, [nodes,edges]);

  const redo = useCallback(() => {
    setFuture(f => {
      if (!f.length) return f;
      const next = f[0];
      setHistory(h=>[...h,{nodes,edges}]);
      setNodes(next.nodes); setEdges(next.edges);
      return f.slice(1);
    });
  // eslint-disable-next-line
  }, [nodes,edges]);

  /* ── Coord helpers ── */
  const svgPt = useCallback((cx:number, cy:number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x:0, y:0 };
    return { x:(cx-r.left-pan.x)/scale, y:(cy-r.top-pan.y)/scale };
  }, [pan,scale]);

  const snap = useCallback((v:number) => Math.round(v/GRID)*GRID, []);

  /* ── Keyboard ── */
  useEffect(() => {
    const h = (e:KeyboardEvent) => {
      const tag = (e.target as Element)?.tagName;
      if (tag==="INPUT"||tag==="TEXTAREA") return;
      if (e.key==="Delete"||e.key==="Backspace") {
        if (selected) {
          push(nodes,edges);
          setNodes(p=>p.filter(n=>n.id!==selected));
          setEdges(p=>p.filter(e=>e.source!==selected&&e.target!==selected));
          setSelected(null);
        }
      }
      if (e.key==="Escape") { setSelected(null); setConnectFirst(null); setConnectMode(false); setCtxMenu(null); }
      if ((e.ctrlKey||e.metaKey)&&e.key==="z") { e.preventDefault(); undo(); }
      if ((e.ctrlKey||e.metaKey)&&(e.key==="y"||(e.shiftKey&&e.key==="Z"))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  }, [selected,nodes,edges,push,undo,redo]);

  /* ── Wheel zoom ── */
  const onWheel = useCallback((e:React.WheelEvent) => {
    e.preventDefault();
    const f = e.deltaY<0?1.12:1/1.12;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx=e.clientX-rect.left, my=e.clientY-rect.top;
    setScale(s=>{
      const ns=Math.min(3,Math.max(0.2,s*f));
      setPan(p=>({x:mx-(mx-p.x)*(ns/s), y:my-(my-p.y)*(ns/s)}));
      return ns;
    });
  }, []);

  /* ── Canvas mousedown ── */
  const onCanvasMD = useCallback((e:React.MouseEvent) => {
    if (ctxMenu) { setCtxMenu(null); return; }
    const tgt=e.target as Element;
    const isCanvas=tgt===canvasRef.current||tgt.getAttribute("data-bg")==="1";
    if (!isCanvas) return;
    setSelected(null); setConnectFirst(null);
    if (!connectMode) {
      isPanning.current=true;
      panStart.current={mx:e.clientX,my:e.clientY,tx:pan.x,ty:pan.y};
    }
  }, [pan,connectMode,ctxMenu]);

  const onMouseMove = useCallback((e:React.MouseEvent) => {
    const pt=svgPt(e.clientX,e.clientY);
    setMousePos(pt);
    if (isPanning.current)
      setPan({x:panStart.current.tx+e.clientX-panStart.current.mx,
              y:panStart.current.ty+e.clientY-panStart.current.my});
    if (draggingNode.current) {
      const {id,ox,oy}=draggingNode.current;
      const newX=snap(pt.x-ox), newY=snap(pt.y-oy);
      setNodes(prev=>{
        const node=prev.find(n=>n.id===id);
        if (!node) return prev;
        const dx=newX-node.x, dy=newY-node.y;
        if (dx===0&&dy===0) return prev;
        // Spring pull: 1-hop neighbours follow at 60%, 2-hop at 22%
        const hop1=new Set(
          edges.filter(e=>e.source===id||e.target===id)
               .map(e=>e.source===id?e.target:e.source)
        );
        const hop2=new Set(
          edges
            .filter(e=>(hop1.has(e.source)||hop1.has(e.target))&&e.source!==id&&e.target!==id)
            .flatMap(e=>[e.source,e.target])
            .filter(nid=>!hop1.has(nid)&&nid!==id)
        );
        return prev.map(n=>{
          if (n.id===id)       return {...n,x:newX,y:newY};
          if (n.fixed)        return n;
          if (hop1.has(n.id)) return {...n,x:n.x+dx*0.6, y:n.y+dy*0.6};
          if (hop2.has(n.id)) return {...n,x:n.x+dx*0.22,y:n.y+dy*0.22};
          return n;
        });
      });
    }
  }, [svgPt,snap,edges]);

  const onMouseUp = useCallback(()=>{
    isPanning.current=false; draggingNode.current=null;
  },[]);

  /* ── Node mousedown ── */
  const onNodeMD = useCallback((e:React.MouseEvent, node:TopoNode) => {
    e.stopPropagation(); setCtxMenu(null);
    if (connectMode) {
      if (!connectFirst) { setConnectFirst(node.id); }
      else if (connectFirst!==node.id) {
        const dup=edges.some(ed=>
          (ed.source===connectFirst&&ed.target===node.id)||
          (ed.source===node.id&&ed.target===connectFirst));
        if (!dup) { push(nodes,edges); setEdges(p=>[...p,{id:uid(),source:connectFirst,target:node.id}]); }
        setConnectFirst(null);
      }
      return;
    }
    setSelected(node.id);
    if (!node.fixed) {
      const pt=svgPt(e.clientX,e.clientY);
      draggingNode.current={id:node.id,ox:pt.x-node.x,oy:pt.y-node.y};
    }
  }, [connectMode,connectFirst,edges,nodes,push,svgPt]);

  const onNodeRClick = useCallback((e:React.MouseEvent, node:TopoNode)=>{
    e.preventDefault(); e.stopPropagation();
    setSelected(node.id); setCtxMenu({x:e.clientX,y:e.clientY,nid:node.id});
  },[]);

  /* ── Drop from palette ── */
  const onDrop = useCallback((e:React.DragEvent) => {
    e.preventDefault();
    if (!draggingKind) return;
    const pt=svgPt(e.clientX,e.clientY);
    const meta=KIND_META[draggingKind];
    const count=nodes.filter(n=>n.kind===draggingKind).length+1;
    push(nodes,edges);
    setNodes(p=>[...p,{
      id:uid(),kind:draggingKind,label:`${meta.label} ${count}`,
      x:snap(pt.x-NW/2),y:snap(pt.y-NH/2),fixed:false,
    }]);
    setDraggingKind(null);
  }, [draggingKind,nodes,edges,push,svgPt,snap]);

  /* ── Click palette to add ── */
  const addNode = (kind:NodeKind) => {
    const meta=KIND_META[kind];
    const count=nodes.filter(n=>n.kind===kind).length+1;
    // Place in a grid to avoid clustering
    const idx=nodes.length;
    const col=idx%4, row=Math.floor(idx/4);
    const cx=snap((dim.w/2-pan.x)/scale - NW/2 + (col-1.5)*(NW+80));
    const cy=snap((dim.h/2-pan.y)/scale - NH/2 + (row-1)*(NH+80));
    push(nodes,edges);
    setNodes(p=>[...p,{id:uid(),kind,label:`${meta.label} ${count}`,x:cx,y:cy,fixed:false}]);
  };

  const deleteSelected = useCallback(()=>{
    if (!selected) return;
    push(nodes,edges);
    setNodes(p=>p.filter(n=>n.id!==selected));
    setEdges(p=>p.filter(e=>e.source!==selected&&e.target!==selected));
    setSelected(null);
  },[selected,nodes,edges,push]);

  const duplicateNode = (id:string) => {
    const src=nodes.find(n=>n.id===id); if (!src) return;
    push(nodes,edges);
    setNodes(p=>[...p,{...src,id:uid(),x:src.x+NW+20,y:src.y+20,fixed:false}]);
  };

  const toggleFixed = (id:string) =>
    setNodes(p=>p.map(n=>n.id===id?{...n,fixed:!n.fixed}:n));

  const startEdit = (node:TopoNode) => { setEditingId(node.id); setLabelDraft(node.label); };
  const commitEdit = () => {
    if (!editingId) return;
    setNodes(p=>p.map(n=>n.id===editingId?{...n,label:labelDraft.trim()||n.label}:n));
    setEditingId(null);
  };

  const commitProps = () => {
    if (!selected) return;
    const finalPotType = propPotType==="custom" ? customPot.trim() : propPotType;
    setNodes(p=>p.map(n=>n.id===selected
      ? {...n,
          ip:propIp.trim()||undefined,
          notes:propNotes.trim()||undefined,
          potType:finalPotType||undefined,
        }
      : n));
  };

  const deleteEdge = (id:string) => { push(nodes,edges); setEdges(p=>p.filter(e=>e.id!==id)); };

  /* ── Fit view ── */
  const fitView = () => {
    if (!nodes.length) { setPan({x:80,y:40}); setScale(1); return; }
    const xs=nodes.map(n=>n.x), ys=nodes.map(n=>n.y);
    const bx=Math.min(...xs)-60, by=Math.min(...ys)-60;
    const bw=Math.max(...xs)+NW+60-bx, bh=Math.max(...ys)+NH+60-by;
    const s=Math.min(dim.w/bw,dim.h/bh,1.5);
    setScale(s);
    setPan({x:(dim.w-bw*s)/2-bx*s, y:(dim.h-bh*s)/2-by*s});
  };

  /* ── Save / load ── */
  const saveTopo = () => {
    if (!saveName.trim()) return;
    const entry:Saved={id:uid(),name:saveName.trim(),savedAt:new Date().toISOString(),data:{nodes,edges}};
    const u=[...savedList,entry]; setSavedList(u); persistAll(u); setSaveName(""); setShowSave(false);
  };
  const loadTopo = (e:Saved) => {
    setNodes(e.data.nodes); setEdges(e.data.edges);
    setSelected(null); setConnectFirst(null); setShowLoad(false); setShowOpinion(false);
  };
  const deleteSaved = (id:string) => { const u=savedList.filter(s=>s.id!==id); setSavedList(u); persistAll(u); };

  /* ── Analysis ── */
  const getOpinion = () => {
    const f=analyzeTopology({nodes,edges});
    setAnalysis(f); setScore(computeScore(f)); setShowOpinion(true); setSelected(null);
  };
  const clearCanvas = () => {
    push(nodes,edges); setNodes([]); setEdges([]); setSelected(null);
    setConnectFirst(null); setShowOpinion(false);
  };
  const doAutoLayout = () => {
    if (!nodes.length) return;
    push(nodes,edges); setNodes(autoLayout(nodes));
  };

  /* ── Import live topology ── */
  const importLive = async () => {
    setImporting(true); setImportErr("");
    try {
      const [nodesResp, depsResp] = await Promise.all([
        api.get<LiveNode[]>("/nodes"),
        api.get<LiveDeployment[]>("/deployments"),
      ]);
      const liveNodes = nodesResp.data ?? [];
      const liveDeps  = depsResp.data  ?? [];

      const newNodes:TopoNode[]=[];
      const newEdges:TopoEdge[]=[];

      // Internet
      const inetId=uid();
      newNodes.push({id:inetId,kind:"internet",label:"Internet",x:0,y:0,fixed:false});

      // Firewall (representative)
      const fwId=uid();
      newNodes.push({id:fwId,kind:"firewall",label:"Perimeter Firewall",x:0,y:0,fixed:false});
      newEdges.push({id:uid(),source:inetId,target:fwId});

      // Router
      const routerId=uid();
      newNodes.push({id:routerId,kind:"router",label:"Gateway Router",x:0,y:0,fixed:false});
      newEdges.push({id:uid(),source:fwId,target:routerId});

      // DMZ (if there are deployments)
      let dmzId:string|null=null;
      if (liveDeps.length>0) {
        dmzId=uid();
        newNodes.push({id:dmzId,kind:"dmz",label:"DMZ",x:0,y:0,fixed:false});
        newEdges.push({id:uid(),source:routerId,target:dmzId});
      }

      // Live nodes → server cards
      liveNodes.forEach(n=>{
        const os=n.os?.toLowerCase()??"";
        const kind:NodeKind=os.includes("windows")?"windows":os.includes("darwin")?"workstation":"linux";
        const nodeId=uid();
        newNodes.push({
          id:nodeId, kind, label:n.name, x:0, y:0, fixed:false,
          ip:n.ip_address||undefined,
          notes:n.hostname?`Hostname: ${n.hostname}`:undefined,
          online:n.online,
        });
        newEdges.push({id:uid(),source:routerId,target:nodeId});

        // Log Analyser node (sits between this server node and its honeypots)
        const nodeDeps = liveDeps.filter(d=>d.node_id===n.id);
        let laNodeId:string|null = null;
        if (n.la_enabled && nodeDeps.length > 0) {
          laNodeId = uid();
          newNodes.push({
            id:laNodeId, kind:"loganalyzer",
            label:n.la_workspace_name||"Log Analyser",
            x:0, y:0, fixed:false,
            notes:n.la_workspace_url?`Workspace: ${n.la_workspace_url}`:undefined,
          });
          newEdges.push({id:uid(),source:nodeId,target:laNodeId});
        }

        // Honeypots on this node
        nodeDeps.forEach(d=>{
          const hpId=uid();
          newNodes.push({
            id:hpId, kind:"honeypot",
            label:d.pot_id||`${d.honeypot_type}-1`,
            x:0, y:0, fixed:false,
            potType:d.honeypot_type,
            online:d.status==="running",
          });
          // Route through LA if available, else direct from node; DMZ also connects if present
          const hpSrc = laNodeId ?? (dmzId ?? nodeId);
          newEdges.push({id:uid(),source:hpSrc,target:hpId});
          if (dmzId && !laNodeId) newEdges.push({id:uid(),source:nodeId,target:hpId});
        });
      });

      // Remove duplicate edges (node→hp if dmz→hp already exists)
      const uniqEdges = newEdges.filter((e,i,arr)=>
        arr.findIndex(x=>(x.source===e.source&&x.target===e.target)||
                         (x.source===e.target&&x.target===e.source))===i);

      push(nodes,edges);
      const laid=autoLayout(newNodes);
      setNodes(laid); setEdges(uniqEdges);
      setShowImport(false);
      setImportResult({nodes:liveNodes.length,deps:liveDeps.length});
      setTimeout(()=>{ setImportResult(null); fitView(); },3500);
    } catch {
      setImportErr("Failed to reach the API. Make sure the backend is running.");
    } finally {
      setImporting(false);
    }
  };

  /* ── Export SVG — full graph, not just current view ── */
  const exportSVG = async () => {
    const svg = canvasRef.current;
    if (!svg || !nodes.length) return;

    // Compute bounding box of all nodes
    const PAD = 64;
    const xs  = nodes.map(n=>n.x), ys = nodes.map(n=>n.y);
    const bx  = Math.min(...xs),   by = Math.min(...ys);
    const bw  = Math.max(...xs) + NW + PAD*2 - bx;
    const bh  = Math.max(...ys) + NH + PAD*2 - by;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns",       "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width",  String(Math.round(bw)));
    clone.setAttribute("height", String(Math.round(bh)));
    clone.removeAttribute("viewBox");

    // Add a background fill
    const bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
    bg.setAttribute("width",  String(Math.round(bw)));
    bg.setAttribute("height", String(Math.round(bh)));
    bg.setAttribute("fill",   "#F0F4F8");
    clone.insertBefore(bg, clone.firstChild);

    // Reset the pan/zoom group so all nodes are visible at natural scale
    const mainG = clone.querySelector<SVGGElement>("g[transform]");
    if (mainG) mainG.setAttribute("transform", `translate(${PAD-bx},${PAD-by}) scale(1)`);

    // Embed PNG icons as base64 so they appear in the standalone SVG file
    const imgs = Array.from(clone.querySelectorAll("image"));
    await Promise.all(imgs.map(async (img) => {
      const href = img.getAttribute("href") ?? "";
      if (!href || href.startsWith("data:")) return;
      try {
        const resp = await fetch(href);
        const blob = await resp.blob();
        const b64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader();
          reader.onload  = () => res(reader.result as string);
          reader.onerror = rej;
          reader.readAsDataURL(blob);
        });
        img.setAttribute("href", b64);
      } catch { /* keep original href if fetch fails */ }
    }));

    const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "topology.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* derived */
  const selNode  = nodes.find(n=>n.id===selected);
  const crit     = analysis.filter(f=>f.level==="critical").length;
  const warn     = analysis.filter(f=>f.level==="warn").length;
  const good     = analysis.filter(f=>f.level==="good").length;
  const RING_R   = 32;
  const CIRC     = 2*Math.PI*RING_R;
  const ringOff  = CIRC*(1-score/100);
  const rColor   = scoreColor(score);
  const showRight= !!selected||showOpinion;

  /* ══════════════════════════════════════════════════════════════
     Render
  ══════════════════════════════════════════════════════════════ */
  return (
    <div ref={pageRef} className="flex flex-col animate-fade-in"
      style={{height:"100%",minHeight:0,
        ...(isFullscreen && { background:"#F0F4F8", padding:"20px 24px", position:"fixed", inset:0, zIndex:9999 })
      }}
      onClick={()=>setCtxMenu(null)}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-shrink-0 flex-wrap">
        <div>
          <p className="page-label">Design</p>
          <h1 className="page-title">Draft Topology</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-xl overflow-hidden"
            style={{border:"1px solid rgba(15,23,42,0.11)"}}>
            <button onClick={undo} disabled={!history.length}
              className="icon-btn px-2.5 py-1.5 disabled:opacity-30" title="Undo (Ctrl+Z)">
              <Icon d="M3 7v6h6M3.51 13A9 9 0 1021 12" size={14}/>
            </button>
            <div style={{width:1,height:20,background:"rgba(15,23,42,0.09)"}}/>
            <button onClick={redo} disabled={!future.length}
              className="icon-btn px-2.5 py-1.5 disabled:opacity-30" title="Redo (Ctrl+Y)">
              <Icon d="M21 7v6h-6M20.49 13A9 9 0 113 12" size={14}/>
            </button>
          </div>
          <button onClick={()=>setShowImport(true)}
            className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5">
            <Icon d={Icons.network} size={13}/> Import Live
          </button>
          <button onClick={clearCanvas}
            className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5">
            <Icon d={Icons.trash} size={13}/> Clear
          </button>
          <button onClick={()=>setShowLoad(true)}
            className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5">
            <Icon d={Icons.install} size={13}/> Load
          </button>
          <button onClick={()=>setShowSave(true)}
            className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5">
            <Icon d={Icons.copy} size={13}/> Save Draft
          </button>
          <button onClick={exportSVG}
            className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5">
            <Icon d={Icons.arrow} size={13}/> Export SVG
          </button>
          <button onClick={toggleFullscreen}
            className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5"
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
            <Icon d={isFullscreen
              ? "M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"
              : "M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"}
              size={13}/>
            {isFullscreen ? "Exit" : "Fullscreen"}
          </button>
          <button onClick={getOpinion}
            className="btn btn-primary text-xs py-1.5 px-3.5 gap-1.5">
            <Icon d={Icons.spark} size={13}/> System Opinion
          </button>
        </div>
      </div>

      {/* ── Import success toast ── */}
      {importResult && (
        <div className="flex-shrink-0 mb-2 rounded-xl px-4 py-2.5 flex items-center gap-3 animate-fade-in"
          style={{background:"#ECFDF5",border:"1px solid #A7F3D0",color:"#065F46"}}>
          <Icon d={Icons.check} size={16} color="#10B981"/>
          <span className="text-sm font-semibold">
            Live topology imported — {importResult.nodes} node{importResult.nodes!==1?"s":""} and{" "}
            {importResult.deps} deployment{importResult.deps!==1?"s":""} loaded.
          </span>
        </div>
      )}

      {/* ── Body ───────────────────────────────────────────── */}
      <div className="flex gap-3 flex-1 min-h-0">

        {/* ── Palette ── */}
        <div className="card flex-shrink-0 flex flex-col overflow-y-auto"
          style={{width:164,padding:"14px 10px"}}>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest px-1 mb-3">
            Components
          </p>
          {PALETTE_GROUPS.map(g=>(
            <div key={g.id} className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <Icon d={g.icon} size={11} color="#94A3B8"/>
                <span style={{fontSize:9.5,fontWeight:700,color:"#94A3B8",textTransform:"uppercase",letterSpacing:"0.07em"}}>
                  {g.label}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {PALETTE.filter(p=>p.group===g.id).map(item=>(
                  <button key={item.kind}
                    draggable
                    onDragStart={()=>setDraggingKind(item.kind)}
                    onDragEnd={()=>setDraggingKind(null)}
                    onClick={()=>addNode(item.kind)}
                    className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition cursor-grab active:cursor-grabbing"
                    style={{
                      background:item.fill,
                      border:`1.5px solid ${draggingKind===item.kind?item.stroke:item.stroke+"30"}`,
                      boxShadow:draggingKind===item.kind?`0 0 0 3px ${item.stroke}35`:"none",
                    }}
                    title={`Click or drag to add ${item.label}`}
                  >
                    <img src={item.img} alt={item.label} style={{width:22,height:22,objectFit:"contain",flexShrink:0}}/>
                    <span style={{fontSize:11,fontWeight:600,color:item.stroke,lineHeight:1.2}}>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-auto pt-3" style={{borderTop:"1px solid rgba(15,23,42,0.07)"}}>
            <p style={{fontSize:9.5,color:"#94A3B8",lineHeight:1.55}}>
              Drag onto canvas or click to place. Right-click for options.
            </p>
          </div>
        </div>

        {/* ── Canvas column ── */}
        <div className="flex flex-col flex-1 min-w-0 gap-2">

          {/* Toolbar */}
          <div className="card flex-shrink-0 flex items-center gap-2 px-3 py-2 flex-wrap"
            style={{borderRadius:12}}>
            <button onClick={()=>{setConnectMode(false);setConnectFirst(null);}}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition"
              style={{background:!connectMode?"#F59E0B":"#F1F5F9",color:!connectMode?"#FFF":"#64748B"}}>
              <Icon d={Icons.arrow} size={12}/> Select
            </button>
            <button onClick={()=>{setConnectMode(true);setSelected(null);}}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition"
              style={{background:connectMode?"#3B82F6":"#F1F5F9",color:connectMode?"#FFF":"#64748B"}}>
              <Icon d={Icons.link} size={12}/> Connect
            </button>
            {connectMode&&(
              <span className="text-xs font-semibold" style={{color:"#3B82F6"}}>
                {connectFirst?"→ click 2nd node":"→ click 1st node"}
              </span>
            )}
            <div style={{width:1,height:18,background:"rgba(15,23,42,0.09)",margin:"0 2px"}}/>
            <button onClick={doAutoLayout} disabled={!nodes.length}
              className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition disabled:opacity-40"
              style={{background:"#F5F3FF",color:"#7C3AED",border:"1px solid #DDD6FE"}}>
              <Icon d={Icons.spark} size={12}/> Auto Layout
            </button>
            <div className="flex-1"/>
            {selected&&selNode&&(
              <>
                <button onClick={()=>startEdit(selNode)}
                  className="icon-btn text-xs flex items-center gap-1">
                  <Icon d={Icons.key} size={13}/> Rename
                </button>
                <button onClick={()=>toggleFixed(selNode.id)}
                  className="icon-btn text-xs flex items-center gap-1"
                  style={{color:selNode.fixed?"#F59E0B":"#64748B"}}>
                  <Icon d={Icons.lock} size={13}/> {selNode.fixed?"Unpin":"Pin"}
                </button>
                <button onClick={deleteSelected}
                  className="icon-btn text-xs flex items-center gap-1" style={{color:"#EF4444"}}>
                  <Icon d={Icons.trash} size={13}/> Delete
                </button>
                <div style={{width:1,height:18,background:"rgba(15,23,42,0.09)",margin:"0 2px"}}/>
              </>
            )}
            <button onClick={()=>setScale(s=>Math.min(3,s*1.2))} className="icon-btn" title="Zoom in">
              <Icon d={Icons.plus} size={14}/>
            </button>
            <span className="text-xs font-mono text-slate-400 w-9 text-center select-none">
              {Math.round(scale*100)}%
            </span>
            <button onClick={()=>setScale(s=>Math.max(0.2,s/1.2))} className="icon-btn" title="Zoom out">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M5 12h14"/>
              </svg>
            </button>
            <button onClick={fitView} className="icon-btn" title="Fit view">
              <Icon d={Icons.refresh} size={14}/>
            </button>
          </div>

          {/* Canvas */}
          <div ref={containerRef}
            className="flex-1 min-h-0 relative rounded-2xl overflow-hidden"
            style={{
              background:"#F0F4F8",
              border:"1px solid rgba(15,23,42,0.08)",
              cursor:connectMode?"crosshair":"default",
            }}
            onDragOver={e=>e.preventDefault()}
            onDrop={onDrop}
          >
            {/* Dot grid */}
            <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
              <defs>
                <pattern id="dotgrid" width={GRID} height={GRID} patternUnits="userSpaceOnUse"
                  patternTransform={`translate(${((pan.x%GRID)+GRID)%GRID},${((pan.y%GRID)+GRID)%GRID})`}>
                  <circle cx={GRID/2} cy={GRID/2} r={1} fill="rgba(15,23,42,0.08)"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#dotgrid)"/>
            </svg>

            {/* Empty hint */}
            {nodes.length===0&&(
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <img src={routerIcon} alt="" style={{width:72,height:72,opacity:0.15}}/>
                <p className="text-sm font-semibold mt-5" style={{color:"#CBD5E1"}}>
                  Drag components from the palette to begin
                </p>
                <p className="text-xs mt-1.5 text-center px-12" style={{color:"#DDE4EE"}}>
                  Or use "Import Live" to load your current deployed system topology
                </p>
                <div className="flex gap-2 mt-4">
                  {["Drag to place","Connect mode to wire","Right-click for options"].map(t=>(
                    <span key={t} className="text-xs px-2.5 py-1 rounded-full"
                      style={{background:"rgba(15,23,42,0.05)",color:"#94A3B8"}}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* SVG layer */}
            <svg ref={canvasRef} width="100%" height="100%"
              onMouseDown={onCanvasMD}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onWheel={onWheel}
            >
              <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="6" floodColor="rgba(15,23,42,0.14)"/>
                </filter>
                <filter id="shadow-sel" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="rgba(15,23,42,0.22)"/>
                </filter>
              </defs>

              <rect data-bg="1" x="0" y="0" width="100%" height="100%"
                fill="transparent" onMouseDown={onCanvasMD}/>

              <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>

                {/* Edges */}
                {edges.map(edge=>{
                  const s=nodes.find(n=>n.id===edge.source);
                  const t=nodes.find(n=>n.id===edge.target);
                  if (!s||!t) return null;
                  const sp=nodePort(s,t.x+NW/2,t.y+NH/2);
                  const tp=nodePort(t,s.x+NW/2,s.y+NH/2);
                  const mx=(sp.x+tp.x)/2, my=(sp.y+tp.y)/2;
                  const path=smartPath(sp.x,sp.y,tp.x,tp.y,sp.side,tp.side);
                  const isHov=hoveredEdge===edge.id;
                  return (
                    <g key={edge.id}
                      onMouseEnter={()=>setHoveredEdge(edge.id)}
                      onMouseLeave={()=>setHoveredEdge(null)}>
                      {/* Wide transparent hit area */}
                      <path d={path} fill="none" stroke="transparent" strokeWidth={18}
                        style={{cursor:"pointer"}} onClick={()=>deleteEdge(edge.id)}/>
                      {/* Visible edge line — no arrows, clean rounded caps */}
                      <path d={path} fill="none"
                        stroke={isHov?"rgba(59,130,246,0.82)":"rgba(100,116,139,0.52)"}
                        strokeWidth={isHov?2.8:2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{pointerEvents:"none",transition:"stroke 0.15s,stroke-width 0.15s"}}/>
                      {/* Delete button — hover only */}
                      {isHov&&(
                        <g transform={`translate(${mx},${my})`}
                          style={{cursor:"pointer"}} onClick={()=>deleteEdge(edge.id)}>
                          <circle r={9} fill="white" stroke="#FECACA" strokeWidth={1.5}
                            style={{filter:"drop-shadow(0 2px 8px rgba(0,0,0,0.15))"}}/>
                          <line x1={-4} y1={-4} x2={4} y2={4} stroke="#EF4444" strokeWidth={2}/>
                          <line x1={4}  y1={-4} x2={-4} y2={4} stroke="#EF4444" strokeWidth={2}/>
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Connect preview wire */}
                {connectMode&&connectFirst&&(()=>{
                  const s=nodes.find(n=>n.id===connectFirst);
                  if (!s) return null;
                  const sp=nodePort(s,mousePos.x,mousePos.y);
                  return (
                    <path d={`M${sp.x},${sp.y} L${mousePos.x},${mousePos.y}`}
                      fill="none" stroke="#3B82F6" strokeWidth={2}
                      strokeDasharray="6 3" opacity={0.8}
                      style={{pointerEvents:"none"}}/>
                  );
                })()}

                {/* Nodes */}
                {nodes.map(node=>{
                  const m=KIND_META[node.kind];
                  const isSel=node.id===selected;
                  const isCF=node.id===connectFirst;
                  const potMeta=node.potType
                    ? (KNOWN_POT_TYPES.find(p=>p.id===node.potType)||{color:"#94A3B8"})
                    : null;
                  return (
                    <g key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      style={{cursor:node.fixed?"not-allowed":connectMode?"pointer":"grab"}}
                      onMouseDown={e=>onNodeMD(e,node)}
                      onDoubleClick={()=>startEdit(node)}
                      onContextMenu={e=>onNodeRClick(e,node)}
                    >
                      {/* Selection glow */}
                      {(isSel||isCF)&&(
                        <rect x={-7} y={-7} width={NW+14} height={NH+14} rx={20}
                          fill="none"
                          stroke={isCF?"#3B82F6":m.stroke}
                          strokeWidth={2.5}
                          strokeDasharray={isCF?"8 3":undefined}
                          opacity={0.55}/>
                      )}

                      {/* Card shadow */}
                      <rect x={2} y={6} width={NW} height={NH} rx={16}
                        fill={isSel?`${m.stroke}18`:"rgba(15,23,42,0.08)"}
                        filter={isSel?"url(#shadow-sel)":"url(#shadow)"}
                        style={{pointerEvents:"none"}}/>

                      {/* Card */}
                      <rect width={NW} height={NH} rx={16}
                        fill={m.fill}
                        stroke={isSel?m.stroke:`${m.stroke}55`}
                        strokeWidth={isSel?2.5:1.5}/>

                      {/* Icon halo */}
                      <rect x={(NW-ICON)/2-5} y={5} width={ICON+10} height={ICON+10} rx={14}
                        fill={`${m.stroke}12`} style={{pointerEvents:"none"}}/>

                      {/* Top accent stripe */}
                      <rect x={18} y={0} width={NW-36} height={4} rx={2}
                        fill={m.stroke} opacity={0.8}/>

                      {/* Online/offline dot for live nodes */}
                      {node.online!=null&&(
                        <circle cx={NW-12} cy={NH-12} r={5}
                          fill={node.online?"#10B981":"#EF4444"}
                          stroke="#FFF" strokeWidth={1.5}/>
                      )}

                      {/* Fallback icon — only shown while PNG hasn't loaded yet or failed */}
                      {!imgLoaded.has(node.kind) && (
                        <g transform={`translate(${(NW-ICON)/2},10)`} style={{pointerEvents:"none"}}>
                          <rect width={ICON} height={ICON} rx={10}
                            fill={m.fill} stroke={m.stroke} strokeWidth={1.5} opacity={0.7}/>
                          <svg x={7} y={7} width={ICON-14} height={ICON-14}
                            viewBox="0 0 24 24" fill="none"
                            stroke={m.stroke} strokeWidth="1.6"
                            strokeLinecap="round" strokeLinejoin="round">
                            <path d={KIND_FALLBACK_ICON[node.kind]}/>
                          </svg>
                        </g>
                      )}

                      {/* PNG icon */}
                      <image href={m.img}
                        x={(NW-ICON)/2} y={10}
                        width={ICON} height={ICON}
                        style={{pointerEvents:"none"}}
                        onLoad={()=>setImgLoaded(p=>new Set([...p, node.kind]))}
                        onError={()=>{/* keep fallback visible */}}/>

                      {/* Label */}
                      {editingId!==node.id&&(
                        <text x={NW/2} y={NH-20}
                          textAnchor="middle" fontSize={10.5} fontWeight="700"
                          fill={m.stroke} fontFamily="Inter,sans-serif"
                          style={{pointerEvents:"none",userSelect:"none"}}>
                          {node.label.length>13?node.label.slice(0,12)+"…":node.label}
                        </text>
                      )}

                      {/* IP sub-label */}
                      {node.ip&&editingId!==node.id&&(
                        <text x={NW/2} y={NH-8}
                          textAnchor="middle" fontSize={7.5} fill="#94A3B8"
                          fontFamily="Inter,sans-serif"
                          style={{pointerEvents:"none",userSelect:"none"}}>
                          {node.ip}
                        </text>
                      )}

                      {/* Honeypot type badge */}
                      {node.kind==="honeypot"&&node.potType&&editingId!==node.id&&(
                        <g>
                          <rect x={4} y={NH-9} width={NW-8} height={11} rx={5.5}
                            fill={potMeta?.color??"#94A3B8"} opacity={0.18}/>
                          <text x={NW/2} y={NH-2}
                            textAnchor="middle" fontSize={7} fontWeight="700"
                            fill={potMeta?.color??"#94A3B8"}
                            fontFamily="Inter,sans-serif"
                            style={{pointerEvents:"none",userSelect:"none"}}>
                            {node.potType.length>14?node.potType.slice(0,13)+"…":node.potType}
                          </text>
                        </g>
                      )}

                      {/* Fixed pin badge */}
                      {node.fixed&&(
                        <g transform={`translate(${NW-15},7)`}>
                          <circle r={7.5} fill={m.stroke} opacity={0.95}/>
                          <svg x={-5.5} y={-5.5} width={11} height={11} viewBox="0 0 24 24"
                            fill="none" stroke="#FFF" strokeWidth={2.5}
                            strokeLinecap="round" strokeLinejoin="round">
                            <path d={Icons.lock}/>
                          </svg>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>

            {/* Inline rename input */}
            {editingId&&(()=>{
              const n=nodes.find(n=>n.id===editingId); if (!n) return null;
              const m=KIND_META[n.kind];
              const left=n.x*scale+pan.x+NW*scale/2;
              const top=n.y*scale+pan.y+(NH-20)*scale;
              return (
                <input autoFocus value={labelDraft}
                  onChange={e=>setLabelDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={e=>{if(e.key==="Enter")commitEdit();if(e.key==="Escape")setEditingId(null);}}
                  style={{
                    position:"absolute",left:left-62,top,
                    width:124,fontSize:11,fontWeight:700,textAlign:"center",
                    border:`2px solid ${m.stroke}`,borderRadius:7,padding:"2px 6px",
                    background:m.fill,color:m.stroke,outline:"none",zIndex:20,
                    boxShadow:`0 0 0 3px ${m.stroke}20`,
                  }}
                />
              );
            })()}

            {/* Mini-map */}
            {nodes.length>1&&(
              <MiniMap nodes={nodes} edges={edges} pan={pan} scale={scale} dim={dim}/>
            )}
          </div>

          {/* Status bar */}
          <div className="card flex-shrink-0 flex items-center gap-4 px-4 py-2" style={{borderRadius:10}}>
            <Stat label="nodes"     value={nodes.length}/>
            <Stat label="edges"     value={edges.length}/>
            <Stat label="honeypots" value={nodes.filter(n=>n.kind==="honeypot").length} color="#D97706"/>
            <Stat label="firewalls" value={nodes.filter(n=>n.kind==="firewall").length}  color="#EF4444"/>
            <Stat label="pinned"    value={nodes.filter(n=>n.fixed).length}              color="#F59E0B"/>
            {nodes.some(n=>n.online!=null)&&(
              <Stat label="online" value={nodes.filter(n=>n.online===true).length}        color="#10B981"/>
            )}
            <div className="flex-1"/>
            <span className="text-xs text-slate-400 hidden lg:block">
              Double-click to rename · Del to delete · Right-click for more
            </span>
          </div>
        </div>

        {/* ── Right panel ── */}
        {showRight&&(
          <div className="card flex-shrink-0 flex flex-col overflow-hidden"
            style={{width:282,padding:0,borderRadius:16}}>

            {selected&&selNode ? (
              /* Properties panel */
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3"
                  style={{borderBottom:"1px solid rgba(15,23,42,0.07)"}}>
                  <div className="flex items-center gap-2.5">
                    <img src={KIND_META[selNode.kind].img} alt=""
                      style={{width:32,height:32,objectFit:"contain"}}/>
                    <div>
                      <p className="text-sm font-bold text-slate-800 leading-tight">{selNode.label}</p>
                      <p className="text-xs font-semibold" style={{color:KIND_META[selNode.kind].stroke}}>
                        {KIND_META[selNode.kind].label}
                      </p>
                    </div>
                  </div>
                  <button onClick={()=>setSelected(null)} className="icon-btn" style={{color:"#94A3B8"}}>
                    <Icon d={Icons.close} size={15}/>
                  </button>
                </div>

                <div className="flex flex-col gap-3.5 p-4 overflow-y-auto flex-1">
                  <div>
                    <label className="input-label">Label</label>
                    <input className="input text-xs"
                      value={selNode.label}
                      onChange={e=>setNodes(p=>p.map(n=>n.id===selNode.id?{...n,label:e.target.value}:n))}/>
                  </div>
                  <div>
                    <label className="input-label">IP / CIDR</label>
                    <input className="input text-xs" placeholder="e.g. 192.168.1.1/24"
                      value={propIp} onChange={e=>setPropIp(e.target.value)}
                      onBlur={commitProps}/>
                  </div>

                  {/* Honeypot type picker */}
                  {selNode.kind==="honeypot"&&(
                    <div>
                      <label className="input-label">Honeypot Type</label>
                      <select className="input text-xs"
                        value={propPotType}
                        onChange={e=>{ setPropPotType(e.target.value); if(e.target.value!=="custom") setCustomPot(""); }}
                        onBlur={commitProps}
                        style={{cursor:"pointer"}}>
                        <option value="">— select type —</option>
                        {KNOWN_POT_TYPES.map(t=>(
                          <option key={t.id} value={t.id}>{t.label} — {t.desc}</option>
                        ))}
                      </select>
                      {propPotType==="custom"&&(
                        <input className="input text-xs mt-2"
                          placeholder="Type custom honeypot name…"
                          value={customPot}
                          onChange={e=>setCustomPot(e.target.value)}
                          onBlur={commitProps}/>
                      )}
                      {propPotType&&propPotType!=="custom"&&(()=>{
                        const pm=KNOWN_POT_TYPES.find(t=>t.id===propPotType);
                        return pm?(
                          <div className="flex items-center gap-2 mt-2 rounded-lg px-2.5 py-2"
                            style={{background:`${pm.color}15`,border:`1px solid ${pm.color}40`}}>
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:pm.color}}/>
                            <span className="text-xs font-medium" style={{color:pm.color}}>{pm.desc}</span>
                          </div>
                        ):null;
                      })()}
                    </div>
                  )}

                  <div>
                    <label className="input-label">Notes</label>
                    <textarea className="input text-xs resize-none" rows={3}
                      placeholder="Describe the role of this device…"
                      value={propNotes} onChange={e=>setPropNotes(e.target.value)}
                      onBlur={commitProps}/>
                  </div>

                  {/* Pin toggle */}
                  <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                    style={{
                      background:selNode.fixed?"#FFFBEB":"#F8FAFC",
                      border:`1px solid ${selNode.fixed?"#FDE68A":"rgba(15,23,42,0.08)"}`,
                    }}>
                    <div>
                      <p className="text-xs font-semibold text-slate-700">Pin position</p>
                      <p className="text-xs text-slate-400">Prevent accidental moves</p>
                    </div>
                    <button onClick={()=>toggleFixed(selNode.id)}
                      style={{
                        width:38,height:22,borderRadius:11,position:"relative",
                        background:selNode.fixed?"#F59E0B":"#CBD5E1",flexShrink:0,
                      }}>
                      <span style={{
                        display:"block",width:16,height:16,borderRadius:"50%",background:"#FFF",
                        position:"absolute",top:3,left:selNode.fixed?18:3,
                        transition:"left 0.15s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)",
                      }}/>
                    </button>
                  </div>

                  {/* Live status */}
                  {selNode.online!=null&&(
                    <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                      style={{
                        background:selNode.online?"#ECFDF5":"#FEF2F2",
                        border:`1px solid ${selNode.online?"#A7F3D0":"#FECACA"}`,
                      }}>
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{background:selNode.online?"#10B981":"#EF4444"}}/>
                      <div>
                        <p className="text-xs font-semibold"
                          style={{color:selNode.online?"#065F46":"#991B1B"}}>
                          {selNode.online?"Online — live node":"Offline"}
                        </p>
                        <p className="text-xs" style={{color:selNode.online?"#6EE7B7":"#FCA5A5"}}>
                          Imported from system
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 p-4 flex-shrink-0"
                  style={{borderTop:"1px solid rgba(15,23,42,0.07)"}}>
                  <button onClick={()=>duplicateNode(selNode.id)}
                    className="btn btn-secondary text-xs flex-1 py-1.5 gap-1">
                    <Icon d={Icons.copy} size={12}/> Duplicate
                  </button>
                  <button onClick={deleteSelected}
                    className="btn btn-danger text-xs flex-1 py-1.5 gap-1">
                    <Icon d={Icons.trash} size={12}/> Delete
                  </button>
                </div>
              </div>

            ) : showOpinion ? (
              /* Analysis panel */
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-4 py-3"
                  style={{borderBottom:"1px solid rgba(15,23,42,0.07)"}}>
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg flex items-center justify-center"
                      style={{width:28,height:28,background:"#FFFBEB"}}>
                      <Icon d={Icons.spark} size={14} color="#F59E0B"/>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">System Opinion</p>
                      <p className="text-xs text-slate-400">Heuristic analysis</p>
                    </div>
                  </div>
                  <button onClick={()=>setShowOpinion(false)} className="icon-btn" style={{color:"#94A3B8"}}>
                    <Icon d={Icons.close} size={15}/>
                  </button>
                </div>

                {/* Score ring */}
                <div className="flex flex-col items-center py-4"
                  style={{borderBottom:"1px solid rgba(15,23,42,0.07)"}}>
                  <svg width={88} height={88} viewBox="0 0 88 88">
                    <circle cx={44} cy={44} r={RING_R} fill="none" stroke="#E2E8F0" strokeWidth={8}/>
                    <circle cx={44} cy={44} r={RING_R} fill="none"
                      stroke={rColor} strokeWidth={8} strokeLinecap="round"
                      strokeDasharray={CIRC} strokeDashoffset={ringOff}
                      transform="rotate(-90 44 44)"
                      style={{transition:"stroke-dashoffset 0.9s ease,stroke 0.4s"}}/>
                    <text x={44} y={49} textAnchor="middle" fontSize={22} fontWeight="800"
                      fill={rColor} fontFamily="Inter,sans-serif">{score}</text>
                    <text x={44} y={62} textAnchor="middle" fontSize={8} fill="#94A3B8"
                      fontFamily="Inter,sans-serif">/ 100</text>
                  </svg>
                  <p className="text-xs font-bold mt-1" style={{color:rColor}}>
                    {score>=70?"Solid design":score>=45?"Needs work":"High risk"}
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap justify-center">
                    {crit>0&&<Badge bg="#FEF2F2" fg="#EF4444">{crit} Critical</Badge>}
                    {warn>0&&<Badge bg="#FFFBEB" fg="#D97706">{warn} Warning</Badge>}
                    {good>0&&<Badge bg="#ECFDF5" fg="#059669">{good} Good</Badge>}
                  </div>
                </div>

                <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-2">
                  {analysis.map((f,i)=>{
                    const s=LVL[f.level];
                    return (
                      <div key={i} className="rounded-xl p-3"
                        style={{background:s.bg,border:`1px solid ${s.dot}33`}}>
                        <div className="flex items-start gap-2">
                          <span className="rounded-full flex-shrink-0 mt-1"
                            style={{width:7,height:7,background:s.dot,display:"inline-block"}}/>
                          <div>
                            <p className="text-xs font-semibold leading-tight mb-1" style={{color:s.fg}}>
                              <span className="text-xs px-1.5 py-0.5 rounded-full font-bold mr-1"
                                style={{background:`${s.dot}22`,color:s.dot,fontSize:8}}>
                                {s.lbl.toUpperCase()}
                              </span>
                              {f.title}
                            </p>
                            {f.detail&&(
                              <p className="text-xs leading-relaxed" style={{color:s.fg,opacity:0.85}}>
                                {f.detail}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 flex-shrink-0"
                  style={{borderTop:"1px solid rgba(15,23,42,0.07)"}}>
                  <button onClick={getOpinion}
                    className="btn btn-primary text-xs w-full gap-1.5 py-1.5">
                    <Icon d={Icons.refresh} size={13}/> Re-analyse
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ══ Context menu ══════════════════════════════════════════ */}
      {ctxMenu&&(()=>{
        const n=nodes.find(nd=>nd.id===ctxMenu.nid); if (!n) return null;
        return (
          <div className="fixed z-50 rounded-2xl overflow-hidden"
            style={{
              left:ctxMenu.x,top:ctxMenu.y,
              background:"#FFF",
              border:"1px solid rgba(15,23,42,0.1)",
              boxShadow:"0 8px 32px rgba(15,23,42,0.18),0 2px 8px rgba(15,23,42,0.08)",
              minWidth:190,
            }}
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-2.5 px-3 py-2.5"
              style={{borderBottom:"1px solid rgba(15,23,42,0.07)",background:"#F8FAFC"}}>
              <img src={KIND_META[n.kind].img} alt="" style={{width:22,height:22,objectFit:"contain"}}/>
              <div>
                <p className="text-xs font-bold text-slate-800">{n.label}</p>
                <p className="text-xs" style={{color:KIND_META[n.kind].stroke}}>
                  {KIND_META[n.kind].label}
                  {n.potType&&` · ${n.potType}`}
                </p>
              </div>
            </div>
            {[
              {label:"Rename",                    icon:Icons.key,  col:undefined,   act:()=>{startEdit(n);setCtxMenu(null);}},
              {label:n.fixed?"Unpin":"Pin position",icon:Icons.lock,col:n.fixed?"#F59E0B":undefined,act:()=>{toggleFixed(n.id);setCtxMenu(null);}},
              {label:"Connect from here",          icon:Icons.link, col:undefined,   act:()=>{setConnectMode(true);setConnectFirst(n.id);setCtxMenu(null);}},
              {label:"Duplicate",                  icon:Icons.copy, col:undefined,   act:()=>{duplicateNode(n.id);setCtxMenu(null);}},
              null as null,
              {label:"Delete node",                icon:Icons.trash,col:"#EF4444",   act:()=>{deleteSelected();setCtxMenu(null);}},
            ].map((item,i)=>
              item===null?(
                <div key={i} style={{height:1,background:"rgba(15,23,42,0.07)",margin:"2px 0"}}/>
              ):(
                <button key={i} onClick={item.act}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold transition"
                  style={{color:item.col??"#0F172A"}}
                  onMouseEnter={e=>(e.currentTarget.style.background="#F8FAFC")}
                  onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                  <Icon d={item.icon} size={13} color={item.col??"#64748B"}/>
                  {item.label}
                </button>
              )
            )}
          </div>
        );
      })()}

      {/* ══ Import Live dialog ════════════════════════════════════ */}
      {showImport&&(
        <Modal onClose={()=>{setShowImport(false);setImportErr("");}}
          title="Import Live System Topology"
          sub="Fetches your registered nodes and deployments and builds a topology automatically.">
          <div className="rounded-xl p-4 mb-4"
            style={{background:"#F8FAFC",border:"1px solid rgba(15,23,42,0.08)"}}>
            <p className="text-xs font-semibold text-slate-700 mb-1">What will be imported:</p>
            <ul className="text-xs text-slate-500 leading-relaxed list-disc pl-4">
              <li>A starting Internet + Firewall + Router chain</li>
              <li>One server card per registered node (Linux / Windows based on OS)</li>
              <li>One honeypot card per active deployment, linked to its node</li>
              <li>IP addresses, hostnames, and online status from your agents</li>
            </ul>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Existing canvas content will be replaced. Save your draft first if needed.
          </p>
          {importErr&&(
            <div className="text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2 mb-3 border border-red-100">
              {importErr}
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <button onClick={()=>{setShowImport(false);setImportErr("");}}
              className="btn btn-secondary text-xs py-1.5 px-3">Cancel</button>
            <button onClick={importLive} disabled={importing}
              className="btn btn-primary text-xs py-1.5 px-4 gap-1.5 disabled:opacity-60">
              {importing?(
                <>
                  <svg className="animate-spin" width={13} height={13} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2}>
                    <path d="M12 2a10 10 0 1 0 10 10"/>
                  </svg>
                  Importing…
                </>
              ):(
                <><Icon d={Icons.network} size={13}/> Import Now</>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* ══ Save dialog ══════════════════════════════════════════ */}
      {showSave&&(
        <Modal onClose={()=>setShowSave(false)} title="Save Draft Topology"
               sub="Name this topology to load it later.">
          <input autoFocus className="input text-sm mb-4"
            placeholder="e.g. Production DMZ Layout v2"
            value={saveName} onChange={e=>setSaveName(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")saveTopo();}}/>
          <div className="flex gap-2 justify-end">
            <button onClick={()=>setShowSave(false)}
              className="btn btn-secondary text-xs py-1.5 px-3">Cancel</button>
            <button onClick={saveTopo} disabled={!saveName.trim()}
              className="btn btn-primary text-xs py-1.5 px-4">Save</button>
          </div>
        </Modal>
      )}

      {/* ══ Load dialog ══════════════════════════════════════════ */}
      {showLoad&&(
        <Modal onClose={()=>setShowLoad(false)} title="Saved Topologies"
               sub={`${savedList.length} draft${savedList.length!==1?"s":""} saved locally`}>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {savedList.length===0&&(
              <div className="rounded-xl p-8 text-center" style={{background:"#F8FAFC"}}>
                <p className="text-sm font-medium text-slate-400">No saved topologies yet</p>
              </div>
            )}
            {savedList.map(s=>(
              <div key={s.id} className="flex items-center gap-3 rounded-xl p-3"
                style={{background:"#F8FAFC",border:"1px solid rgba(15,23,42,0.07)"}}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(s.savedAt).toLocaleString(undefined,
                      {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                    {" · "}{s.data.nodes.length}n, {s.data.edges.length}e
                  </p>
                </div>
                <button onClick={()=>loadTopo(s)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
                  style={{background:"#FFFBEB",color:"#D97706",border:"1px solid #FDE68A"}}>
                  Load
                </button>
                <button onClick={()=>deleteSaved(s.id)} className="icon-btn flex-shrink-0"
                  style={{color:"#EF4444"}}>
                  <Icon d={Icons.trash} size={14}/>
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Mini-map
══════════════════════════════════════════════════════════════════ */
function MiniMap({ nodes, edges, pan, scale, dim }:
  { nodes:TopoNode[]; edges:TopoEdge[]; pan:{x:number;y:number}; scale:number; dim:{w:number;h:number} }) {
  const W=144, H=86;
  if (!nodes.length) return null;
  const xs=nodes.map(n=>n.x), ys=nodes.map(n=>n.y);
  const bx=Math.min(...xs)-20, by=Math.min(...ys)-20;
  const bw=Math.max(...xs)+NW+20-bx||1, bh=Math.max(...ys)+NH+20-by||1;
  const ms=Math.min((W-8)/bw,(H-8)/bh);
  const ox=4-bx*ms, oy=4-by*ms;
  const vx=-pan.x/scale, vy=-pan.y/scale;
  const vw=dim.w/scale, vh=dim.h/scale;
  return (
    <div style={{
      position:"absolute",bottom:12,right:12,
      background:"rgba(255,255,255,0.9)",
      border:"1px solid rgba(15,23,42,0.1)",
      borderRadius:12,overflow:"hidden",
      backdropFilter:"blur(10px)",
      boxShadow:"0 2px 14px rgba(15,23,42,0.1)",
    }}>
      <svg width={W} height={H}>
        {edges.map(e=>{
          const s=nodes.find(n=>n.id===e.source), t=nodes.find(n=>n.id===e.target);
          if(!s||!t) return null;
          return <line key={e.id}
            x1={s.x*ms+ox+NW*ms/2} y1={s.y*ms+oy+NH*ms/2}
            x2={t.x*ms+ox+NW*ms/2} y2={t.y*ms+oy+NH*ms/2}
            stroke="rgba(15,23,42,0.2)" strokeWidth={0.9}/>;
        })}
        {nodes.map(n=>{
          const m=KIND_META[n.kind];
          return <rect key={n.id}
            x={n.x*ms+ox} y={n.y*ms+oy}
            width={NW*ms} height={NH*ms} rx={3}
            fill={m.stroke} opacity={0.45}/>;
        })}
        <rect x={vx*ms+ox} y={vy*ms+oy} width={vw*ms} height={vh*ms} rx={2}
          fill="rgba(59,130,246,0.06)"
          stroke="rgba(59,130,246,0.55)" strokeWidth={1.5}/>
      </svg>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Helpers
══════════════════════════════════════════════════════════════════ */
function Stat({ label, value, color }:{ label:string; value:number; color?:string }) {
  return (
    <span className="text-xs text-slate-500">
      <strong style={{color:color??"#0F172A"}}>{value}</strong> {label}
    </span>
  );
}

function Badge({ children, bg, fg }:{ children:React.ReactNode; bg:string; fg:string }) {
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{background:bg,color:fg}}>
      {children}
    </span>
  );
}

function Modal({ children, onClose, title, sub }:
  { children:React.ReactNode; onClose:()=>void; title:string; sub?:string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50"
      style={{background:"rgba(15,23,42,0.45)",backdropFilter:"blur(6px)"}}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="card rounded-2xl p-6 shadow-2xl"
        style={{width:440,maxHeight:"82vh",display:"flex",flexDirection:"column",
                background:"#FFF",border:"1px solid rgba(15,23,42,0.1)"}}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-800">{title}</h2>
            {sub&&<p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
          </div>
          <button onClick={onClose} className="icon-btn -mt-1" style={{color:"#94A3B8"}}>
            <Icon d={Icons.close} size={16}/>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
