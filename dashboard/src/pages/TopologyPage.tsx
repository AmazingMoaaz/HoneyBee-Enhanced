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
  | "loganalyzer"
  // network
  | "cloud"    | "loadbalancer" | "vpn"    | "waf"   | "proxy" | "accesspoint"
  // systems
  | "container"| "kubernetes"   | "webserver" | "mailserver" | "dns" | "storage" | "iot"
  // security
  | "ids"      | "siem"         | "bastion" | "sandbox" | "sensor";

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

type EdgeType = "link" | "allow" | "deny" | "trust" | "monitor";
interface TopoEdge { id: string; source: string; target: string; type?: EdgeType; label?: string }
interface Topology  { nodes: TopoNode[]; edges: TopoEdge[] }

/* Edge visual style + semantics per connection type */
const EDGE_STYLE: Record<EdgeType, { color: string; dash?: string; label: string; icon: string }> = {
  link:    { color: "var(--border-2)", label: "Link",    icon: Icons.link },
  allow:   { color: "#22C55E",         label: "Allow",   icon: Icons.check },
  deny:    { color: "#EF4444", dash: "7 4", label: "Deny",   icon: Icons.close },
  trust:   { color: "#3B82F6",         label: "Trust",   icon: Icons.shield },
  monitor: { color: "#A78BFA", dash: "2 5", label: "Monitor", icon: Icons.activity },
};
const EDGE_TYPES: EdgeType[] = ["link", "allow", "deny", "trust", "monitor"];
const edgeColor = (t?: EdgeType) => EDGE_STYLE[t ?? "link"].color;

/* ── Known honeypot types from PotStore ──────────────────────────── */
const KNOWN_POT_TYPES = [
  { id:"cowrie",      label:"Cowrie",       desc:"SSH / Telnet honeypot",         color:"#F59E0B" },
  { id:"honnypotter", label:"HonnyPotter",  desc:"WordPress login trap",           color:"#7C3AED" },
  { id:"webtrap",     label:"WebTrap",      desc:"HTTP deception traps",           color:"#0EA5E9" },
  { id:"dionaea",     label:"Dionaea",      desc:"Multi-protocol malware capture", color:"#EF4444" },
  { id:"heralding",   label:"Heralding",    desc:"Multi-service credential trap",  color:"#F97316" },
  { id:"elasticpot",  label:"ElasticPot",   desc:"Fake Elasticsearch endpoint",    color:"#06B6D4" },
  { id:"mailoney",    label:"Mailoney",     desc:"SMTP honeypot",                  color:"#22C55E" },
  { id:"custom",      label:"Custom…",      desc:"Type your own",                  color:"var(--text-faint)" },
];

/* ── Palette ──────────────────────────────────────────────────────── */
interface PaletteItem {
  kind:   NodeKind;
  label:  string;
  img?:   string;          // PNG asset; when absent the SVG fallback icon is used
  stroke: string;
  fill:   string;
  group:  "network" | "systems" | "security";
}

const PALETTE: PaletteItem[] = [
  { kind:"internet",    label:"Internet",    img:internetIcon,  stroke:"#3B82F6", fill:"rgba(59,130,246,0.12)", group:"network"  },
  { kind:"firewall",    label:"Firewall",    img:firewallIcon,  stroke:"#EF4444", fill:"rgba(239,68,68,0.13)", group:"network"  },
  { kind:"router",      label:"Router",      img:routerIcon,    stroke:"#D97706", fill:"rgba(245,158,11,0.13)", group:"network"  },
  { kind:"switch",      label:"Switch",      img:switchIcon,    stroke:"#8B5CF6", fill:"rgba(139,92,246,0.12)", group:"network"  },
  { kind:"dmz",         label:"DMZ",         img:dmzIcon,       stroke:"#EA580C", fill:"var(--warn-bg)", group:"network"  },
  { kind:"server",      label:"Server",      img:serverIcon,    stroke:"#10B981", fill:"rgba(34,197,94,0.12)", group:"systems"  },
  { kind:"linux",       label:"Linux",       img:linuxIcon,     stroke:"#0891B2", fill:"var(--info-bg)", group:"systems"  },
  { kind:"windows",     label:"Windows",     img:windowsIcon,   stroke:"#0078D4", fill:"rgba(59,130,246,0.12)", group:"systems"  },
  { kind:"workstation", label:"Workstation", img:macIcon,       stroke:"var(--text-muted)", fill:"var(--bg-2)", group:"systems"  },
  { kind:"database",    label:"Database",    img:databaseIcon,  stroke:"#0E7490", fill:"var(--info-bg)", group:"systems"  },
  { kind:"mysql",       label:"MySQL",       img:mysqlIcon,     stroke:"#DE6914", fill:"var(--warn-bg)", group:"systems"  },
  { kind:"honeypot",     label:"Honeypot",     img:honeypotIcon,     stroke:"#F59E0B", fill:"rgba(245,158,11,0.13)", group:"security" },
  { kind:"loganalyzer",  label:"Log Analyser", img:loganalyzerIcon,  stroke:"#7C3AED", fill:"rgba(139,92,246,0.12)", group:"security" },

  /* ── Extra modules (SVG-icon, no PNG asset) ─────────────────────────── */
  // Network
  { kind:"cloud",        label:"Cloud",        stroke:"#38BDF8", fill:"#38BDF81f", group:"network"  },
  { kind:"loadbalancer", label:"Load Balancer",stroke:"#14B8A6", fill:"#14B8A61f", group:"network"  },
  { kind:"vpn",          label:"VPN Gateway",  stroke:"#6366F1", fill:"#6366F11f", group:"network"  },
  { kind:"waf",          label:"WAF",          stroke:"#F43F5E", fill:"#F43F5E1f", group:"network"  },
  { kind:"proxy",        label:"Proxy",        stroke:"#A855F7", fill:"#A855F71f", group:"network"  },
  { kind:"accesspoint",  label:"Wireless AP",  stroke:"#0EA5E9", fill:"#0EA5E91f", group:"network"  },
  // Systems
  { kind:"webserver",    label:"Web Server",   stroke:"#10B981", fill:"#10B9811f", group:"systems"  },
  { kind:"mailserver",   label:"Mail Server",  stroke:"#F59E0B", fill:"#F59E0B1f", group:"systems"  },
  { kind:"dns",          label:"DNS Server",   stroke:"#6366F1", fill:"#6366F11f", group:"systems"  },
  { kind:"container",    label:"Container",    stroke:"#2496ED", fill:"#2496ED1f", group:"systems"  },
  { kind:"kubernetes",   label:"Kubernetes",   stroke:"#326CE5", fill:"#326CE51f", group:"systems"  },
  { kind:"storage",      label:"Storage / NAS",stroke:"#64748B", fill:"#64748B1f", group:"systems"  },
  { kind:"iot",          label:"IoT Device",   stroke:"#22C55E", fill:"#22C55E1f", group:"systems"  },
  // Security
  { kind:"ids",          label:"IDS / IPS",    stroke:"#EF4444", fill:"#EF44441f", group:"security" },
  { kind:"siem",         label:"SIEM",         stroke:"#7C3AED", fill:"#7C3AED1f", group:"security" },
  { kind:"bastion",      label:"Bastion Host", stroke:"#D97706", fill:"#D977061f", group:"security" },
  { kind:"sandbox",      label:"Sandbox",      stroke:"#06B6D4", fill:"#06B6D41f", group:"security" },
  { kind:"sensor",       label:"Sensor",       stroke:"#F97316", fill:"#F973161f", group:"security" },
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
  // network
  cloud:        "M17 18H7a4 4 0 0 1-1-7.9A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 0 9z",
  loadbalancer: Icons.network,
  vpn:          Icons.lock,
  waf:          Icons.shield,
  proxy:        Icons.external,
  accesspoint:  Icons.signal,
  // systems
  webserver:    Icons.web,
  mailserver:   Icons.mail,
  dns:          Icons.globe,
  container:    Icons.deploy,
  kubernetes:   Icons.hex,
  storage:      Icons.database,
  iot:          Icons.cpu,
  // security
  ids:          Icons.eye,
  siem:         Icons.chart,
  bastion:      Icons.key,
  sandbox:      Icons.honeycomb,
  sensor:       Icons.activity,
};

/* Renders a kind's PNG icon, or its SVG fallback when no PNG asset exists. */
function KindIcon({ kind, size = 22 }: { kind: NodeKind; size?: number }) {
  const m = KIND_META[kind];
  if (m.img) return <img src={m.img} alt="" style={{ width:size, height:size, objectFit:"contain", flexShrink:0 }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={m.stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink:0 }}>
      <path d={KIND_FALLBACK_ICON[kind]} />
    </svg>
  );
}

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
  ["internet", "cloud"],
  ["firewall", "waf", "vpn"],
  ["router", "dmz", "proxy"],
  ["switch", "loadbalancer", "accesspoint"],
  ["server", "linux", "windows", "workstation", "database", "mysql",
   "webserver", "mailserver", "dns", "container", "kubernetes", "storage", "iot"],
  ["loganalyzer", "siem", "ids", "sensor", "bastion", "sandbox"],
  ["honeypot"],
];

function autoLayout(nodes: TopoNode[]): TopoNode[] {
  const LAYER_H = 150;                       // vertical gap between layers
  const COL_W   = Math.max(140, NW + 56);    // horizontal slot per node
  const PAD_Y   = 48;

  // Bucket nodes into their layer (unknown kinds fall into the last layer).
  const layers: TopoNode[][] = LAYER_MAP.map(() => []);
  const extra: TopoNode[] = [];
  nodes.forEach(n => {
    const li = LAYER_MAP.findIndex(g => g.includes(n.kind));
    if (li >= 0) layers[li].push(n); else extra.push(n);
  });
  if (extra.length) layers[layers.length - 1].push(...extra);

  // Center every layer on a shared centre line so the diagram is symmetric.
  const widest  = Math.max(1, ...layers.map(l => l.length));
  const centreX = (widest * COL_W) / 2;

  const out: TopoNode[] = [];
  let visibleLayer = 0;
  layers.forEach(layerNodes => {
    if (!layerNodes.length) return;          // collapse empty layers (no vertical gaps)
    const startX = centreX - (layerNodes.length * COL_W) / 2;
    layerNodes
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
      .forEach((n, i) => out.push({
        ...n,
        x: Math.round(startX + i * COL_W + (COL_W - NW) / 2),
        y: PAD_Y + visibleLayer * LAYER_H,
      }));
    visibleLayer++;
  });
  return out;
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

  // Centralised logging / monitoring
  if (hasKind("loganalyzer"))
    out.push({ level:"good", title:"Centralised logging in place",
      detail:"A Log Analyser is collecting telemetry — you have visibility into attacker activity." });
  else if (hasKind("honeypot"))
    out.push({ level:"info", title:"No log analyser",
      detail:"Add a Log Analyser so honeypot events are aggregated and searchable." });

  // Edge-type semantics
  const idKind = (id:string) => nodes.find(n=>n.id===id)?.kind;
  const isInternal = (k?:string) => ["server","linux","windows","workstation","database","mysql"].includes(k??"");
  edges.forEach(e=>{
    const sk=idKind(e.source), tk=idKind(e.target);
    const touchesInternet = sk==="internet"||tk==="internet";
    const touchesInternal = isInternal(sk)||isInternal(tk);
    if (touchesInternet && touchesInternal) {
      if (e.type==="allow")
        out.push({ level:"critical", title:"Internet → internal marked Allow",
          detail:"An explicit Allow rule lets the internet reach an internal system directly. Restrict or deny it." });
      else if (e.type==="deny")
        out.push({ level:"good", title:"Internet → internal denied",
          detail:"Good — this path is explicitly blocked." });
    }
  });
  if (byKind("honeypot").length>0 && edges.some(e=>e.type==="monitor"))
    out.push({ level:"good", title:"Monitored honeypot paths",
      detail:"Monitor links show where traffic is being observed — strong detection posture." });

  // Single-firewall single point of failure
  if (byKind("firewall").length===1)
    out.push({ level:"info", title:"Single firewall",
      detail:"One firewall is a single point of failure — consider a redundant pair for HA." });

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

function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2,6)+Math.random().toString(36).slice(2,4); }

/* ── Starter templates ────────────────────────────────────────────── */
function tpl(spec:{k:NodeKind;l:string;pot?:string}[], links:[number,number,EdgeType?][]): Topology {
  const ids = spec.map(()=>uid());
  return {
    nodes: spec.map((s,i)=>({ id:ids[i], kind:s.k, label:s.l, x:0, y:0, fixed:false, potType:s.pot })),
    edges: links.map(([a,b,t])=>({ id:uid(), source:ids[a], target:ids[b], ...(t?{type:t}:{}) })),
  };
}
const TEMPLATES: { id:string; name:string; desc:string; tags:string[]; build:()=>Topology }[] = [
  { id:"perimeter", name:"Perimeter + DMZ", tags:["Firewall","DMZ","Honeypot"],
    desc:"Internet behind a firewall, a DMZ with a monitored honeypot, and an internal app + database tier.",
    build:()=>tpl(
      [{k:"internet",l:"Internet"},{k:"firewall",l:"Perimeter FW"},{k:"dmz",l:"DMZ"},
       {k:"honeypot",l:"Cowrie",pot:"cowrie"},{k:"switch",l:"Core Switch"},
       {k:"linux",l:"App Server"},{k:"database",l:"Database"}],
      [[0,1,"deny"],[1,2,"allow"],[2,3,"monitor"],[1,4],[4,5],[5,6,"trust"]]) },
  { id:"zerotrust", name:"Zero-Trust Segmented", tags:["Segmentation","Monitor"],
    desc:"Each segment sits behind its own firewall; honeypots and a log analyser watch every zone.",
    build:()=>tpl(
      [{k:"internet",l:"Internet"},{k:"firewall",l:"Edge FW"},{k:"router",l:"Router"},
       {k:"firewall",l:"Segment FW"},{k:"linux",l:"Workload"},{k:"honeypot",l:"WebTrap",pot:"webtrap"},
       {k:"loganalyzer",l:"Log Analyser"}],
      [[0,1,"deny"],[1,2],[2,3],[3,4,"allow"],[3,5,"monitor"],[5,6,"monitor"],[4,6,"monitor"]]) },
  { id:"threetier", name:"Classic 3-Tier", tags:["Web","App","DB"],
    desc:"Web, application and database tiers protected by a single perimeter firewall.",
    build:()=>tpl(
      [{k:"internet",l:"Internet"},{k:"firewall",l:"Firewall"},{k:"server",l:"Web Tier"},
       {k:"linux",l:"App Tier"},{k:"mysql",l:"DB Tier"}],
      [[0,1,"deny"],[1,2,"allow"],[2,3,"trust"],[3,4,"trust"]]) },
  { id:"honeynet", name:"Honeynet", tags:["Deception","Multi-pot"],
    desc:"A dedicated deception subnet of several honeypots, all feeding a central log analyser.",
    build:()=>tpl(
      [{k:"internet",l:"Internet"},{k:"firewall",l:"Firewall"},{k:"dmz",l:"Honeynet DMZ"},
       {k:"honeypot",l:"Cowrie",pot:"cowrie"},{k:"honeypot",l:"Dionaea",pot:"dionaea"},
       {k:"honeypot",l:"WebTrap",pot:"webtrap"},{k:"loganalyzer",l:"Log Analyser"}],
      [[0,1,"deny"],[1,2,"allow"],[2,3,"monitor"],[2,4,"monitor"],[2,5,"monitor"],[3,6,"monitor"],[4,6,"monitor"],[5,6,"monitor"]]) },
];

/* ── Level styles ─────────────────────────────────────────────────── */
const LVL: Record<Finding["level"], { bg:string; fg:string; dot:string; lbl:string }> = {
  good:     { bg:"var(--ok-bg)", fg:"var(--ok)", dot:"#10B981", lbl:"Good"     },
  warn:     { bg:"var(--warn-bg)", fg:"var(--warn)", dot:"#F59E0B", lbl:"Warning"  },
  critical: { bg:"var(--danger-bg)", fg:"var(--danger)", dot:"#EF4444", lbl:"Critical" },
  info:     { bg:"var(--info-bg)", fg:"var(--info)", dot:"#3B82F6", lbl:"Info"     },
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

  /* multi-select + marquee + edge menu + view toggles + search + templates */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee,      setMarquee    ] = useState<{x0:number;y0:number;x1:number;y1:number}|null>(null);
  const marqueeRef = useRef(false);
  const [edgeMenu,     setEdgeMenu   ] = useState<{x:number;y:number;eid:string}|null>(null);
  const [showGrid,     setShowGrid   ] = useState(true);
  const [snapOn,       setSnapOn     ] = useState(true);
  const [showTemplates,setShowTemplates] = useState(false);
  const [search,       setSearch     ] = useState("");
  const [exportMenu,   setExportMenu ] = useState(false);
  const clipboard = useRef<Topology|null>(null);

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

  /* ── Multi-selection ops (declared before the keyboard effect that uses them) ── */
  const selIds = () => selectedIds.length ? selectedIds : (selected ? [selected] : []);

  const deleteSelection = useCallback(() => {
    const ids = selectedIds.length ? selectedIds : (selected ? [selected] : []);
    if (!ids.length) return;
    const s = new Set(ids);
    push(nodes,edges);
    setNodes(p=>p.filter(n=>!s.has(n.id)));
    setEdges(p=>p.filter(e=>!s.has(e.source)&&!s.has(e.target)));
    setSelected(null); setSelectedIds([]);
  }, [selectedIds,selected,nodes,edges,push]);

  const selectAll = useCallback(() => { setSelectedIds(nodes.map(n=>n.id)); setSelected(null); }, [nodes]);

  const copySel = useCallback(() => {
    const ids=new Set(selectedIds.length?selectedIds:(selected?[selected]:[]));
    if (!ids.size) return;
    clipboard.current={
      nodes: nodes.filter(n=>ids.has(n.id)),
      edges: edges.filter(e=>ids.has(e.source)&&ids.has(e.target)),
    };
  }, [selectedIds,selected,nodes,edges]);

  const pasteSel = useCallback(() => {
    const cb=clipboard.current; if (!cb||!cb.nodes.length) return;
    const map=new Map<string,string>();
    const nn=cb.nodes.map(n=>{ const nid=uid(); map.set(n.id,nid); return {...n,id:nid,x:n.x+32,y:n.y+32,fixed:false}; });
    const ne=cb.edges.map(e=>({id:uid(),source:map.get(e.source)!,target:map.get(e.target)!,type:e.type,label:e.label}));
    push(nodes,edges);
    setNodes(p=>[...p,...nn]); setEdges(p=>[...p,...ne]);
    setSelectedIds(nn.map(n=>n.id)); setSelected(nn.length===1?nn[0].id:null);
  }, [nodes,edges,push]);

  /* ── Coord helpers ── */
  const svgPt = useCallback((cx:number, cy:number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x:0, y:0 };
    return { x:(cx-r.left-pan.x)/scale, y:(cy-r.top-pan.y)/scale };
  }, [pan,scale]);

  const snap = useCallback((v:number) => snapOn ? Math.round(v/GRID)*GRID : Math.round(v), [snapOn]);

  /* ── Keyboard ── */
  useEffect(() => {
    const h = (e:KeyboardEvent) => {
      const tag = (e.target as Element)?.tagName;
      if (tag==="INPUT"||tag==="TEXTAREA") return;
      const mod = e.ctrlKey||e.metaKey;
      if (e.key==="Delete"||e.key==="Backspace") { e.preventDefault(); deleteSelection(); }
      else if (e.key==="Escape") { setSelected(null); setSelectedIds([]); setConnectFirst(null); setConnectMode(false); setCtxMenu(null); setEdgeMenu(null); setMarquee(null); marqueeRef.current=false; }
      else if (mod&&e.key==="z") { e.preventDefault(); undo(); }
      else if (mod&&(e.key==="y"||(e.shiftKey&&(e.key==="Z"||e.key==="z")))) { e.preventDefault(); redo(); }
      else if (mod&&e.key==="a") { e.preventDefault(); selectAll(); }
      else if (mod&&e.key==="c") { e.preventDefault(); copySel(); }
      else if (mod&&e.key==="v") { e.preventDefault(); pasteSel(); }
    };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  }, [deleteSelection,undo,redo,selectAll,copySel,pasteSel]);

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
    if (ctxMenu||edgeMenu) { setCtxMenu(null); setEdgeMenu(null); return; }
    const tgt=e.target as Element;
    const isCanvas=tgt===canvasRef.current||tgt.getAttribute("data-bg")==="1";
    if (!isCanvas) return;
    setSelected(null); setSelectedIds([]); setConnectFirst(null);
    if (connectMode) return;
    if (e.shiftKey) {
      const pt=svgPt(e.clientX,e.clientY);
      marqueeRef.current=true;
      setMarquee({x0:pt.x,y0:pt.y,x1:pt.x,y1:pt.y});
    } else {
      isPanning.current=true;
      panStart.current={mx:e.clientX,my:e.clientY,tx:pan.x,ty:pan.y};
    }
  }, [pan,connectMode,ctxMenu,edgeMenu,svgPt]);

  const onMouseMove = useCallback((e:React.MouseEvent) => {
    const pt=svgPt(e.clientX,e.clientY);
    setMousePos(pt);
    if (marqueeRef.current) { setMarquee(m=>m?{...m,x1:pt.x,y1:pt.y}:m); return; }
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
        // Group move: if the grabbed node is part of a multi-selection, move
        // the whole selection rigidly (no spring pull).
        if (selectedIds.length>1 && selectedIds.includes(id)) {
          const sel=new Set(selectedIds);
          return prev.map(n=> n.id===id ? {...n,x:newX,y:newY}
                            : (sel.has(n.id)&&!n.fixed) ? {...n,x:n.x+dx,y:n.y+dy} : n);
        }
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
  }, [svgPt,snap,edges,selectedIds]);

  const onMouseUp = useCallback(()=>{
    if (marqueeRef.current) {
      marqueeRef.current=false;
      setMarquee(m=>{
        if (m) {
          const x0=Math.min(m.x0,m.x1), x1=Math.max(m.x0,m.x1);
          const y0=Math.min(m.y0,m.y1), y1=Math.max(m.y0,m.y1);
          if (Math.abs(x1-x0)>6 && Math.abs(y1-y0)>6) {
            const hit=nodes.filter(n=>n.x+NW>x0&&n.x<x1&&n.y+NH>y0&&n.y<y1).map(n=>n.id);
            setSelectedIds(hit);
            setSelected(hit.length===1?hit[0]:null);
          }
        }
        return null;
      });
    }
    isPanning.current=false; draggingNode.current=null;
  },[nodes]);

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
    if (e.shiftKey) {
      setSelectedIds(ids=>ids.includes(node.id)?ids.filter(i=>i!==node.id):[...ids,node.id]);
      setSelected(node.id);
      return;
    }
    setSelected(node.id);
    if (!selectedIds.includes(node.id)) setSelectedIds([node.id]);
    if (!node.fixed) {
      const pt=svgPt(e.clientX,e.clientY);
      draggingNode.current={id:node.id,ox:pt.x-node.x,oy:pt.y-node.y};
    }
  }, [connectMode,connectFirst,edges,nodes,push,svgPt,selectedIds]);

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

  /* ── Align / distribute (operate on current selection) ── */
  const alignSel = (mode:"left"|"hcenter"|"right"|"top"|"vcenter"|"bottom") => {
    const ids=selIds(); if (ids.length<2) return;
    const sel=nodes.filter(n=>ids.includes(n.id));
    const minX=Math.min(...sel.map(n=>n.x)), maxX=Math.max(...sel.map(n=>n.x+NW));
    const minY=Math.min(...sel.map(n=>n.y)), maxY=Math.max(...sel.map(n=>n.y+NH));
    const cX=(minX+maxX)/2, cY=(minY+maxY)/2;
    const s=new Set(ids);
    push(nodes,edges);
    setNodes(p=>p.map(n=>{
      if (!s.has(n.id)) return n;
      switch(mode){
        case "left":    return {...n,x:minX};
        case "right":   return {...n,x:maxX-NW};
        case "hcenter": return {...n,x:Math.round(cX-NW/2)};
        case "top":     return {...n,y:minY};
        case "bottom":  return {...n,y:maxY-NH};
        case "vcenter": return {...n,y:Math.round(cY-NH/2)};
      }
    }));
  };
  const distributeSel = (axis:"h"|"v") => {
    const ids=selIds(); if (ids.length<3) return;
    const sel=nodes.filter(n=>ids.includes(n.id)).sort((a,b)=>axis==="h"?a.x-b.x:a.y-b.y);
    const first=sel[0], last=sel[sel.length-1];
    const span=axis==="h"?(last.x-first.x):(last.y-first.y);
    const step=span/(sel.length-1);
    const pos=new Map(sel.map((n,i)=>[n.id, axis==="h"?Math.round(first.x+i*step):Math.round(first.y+i*step)]));
    push(nodes,edges);
    setNodes(p=>p.map(n=>pos.has(n.id)?(axis==="h"?{...n,x:pos.get(n.id)!}:{...n,y:pos.get(n.id)!}):n));
  };

  /* ── Edge type + label ── */
  const setEdgeType = (eid:string, type:EdgeType) => { push(nodes,edges); setEdges(p=>p.map(e=>e.id===eid?{...e,type}:e)); };
  const setEdgeLabel = (eid:string, label:string) => setEdges(p=>p.map(e=>e.id===eid?{...e,label:label||undefined}:e));

  /* ── Templates + image export ── */
  const loadTemplate = (topo:Topology) => {
    push(nodes,edges);
    const laid=autoLayout(topo.nodes);
    setNodes(laid); setEdges(topo.edges);
    setSelected(null); setSelectedIds([]); setShowTemplates(false);
    setTimeout(fitView, 30);
  };

  const findNode = (q:string) => {
    const t=q.trim().toLowerCase(); if (!t) return;
    const n=nodes.find(nd=>nd.label.toLowerCase().includes(t)||nd.ip?.toLowerCase().includes(t)||nd.kind.includes(t));
    if (!n) return;
    setSelected(n.id); setSelectedIds([n.id]);
    setScale(1);
    setPan({x:dim.w/2-(n.x+NW/2), y:dim.h/2-(n.y+NH/2)});
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

  /* ── Build a standalone SVG string of the full graph (theme-aware) ── */
  const buildExportSVG = async (): Promise<{ svg:string; w:number; h:number }|null> => {
    const svg = canvasRef.current;
    if (!svg || !nodes.length) return null;
    const PAD = 64;
    const xs = nodes.map(n=>n.x), ys = nodes.map(n=>n.y);
    const bx = Math.min(...xs), by = Math.min(...ys);
    const bw = Math.max(...xs) + NW + PAD*2 - bx;
    const bh = Math.max(...ys) + NH + PAD*2 - by;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns",       "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width",  String(Math.round(bw)));
    clone.setAttribute("height", String(Math.round(bh)));
    clone.removeAttribute("viewBox");

    const cs = getComputedStyle(document.documentElement);
    const bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
    bg.setAttribute("width",  String(Math.round(bw)));
    bg.setAttribute("height", String(Math.round(bh)));
    bg.setAttribute("fill", (cs.getPropertyValue("--bg-2").trim()) || "#F0F4F8");
    clone.insertBefore(bg, clone.firstChild);

    const mainG = clone.querySelector<SVGGElement>("g[transform]");
    if (mainG) mainG.setAttribute("transform", `translate(${PAD-bx},${PAD-by}) scale(1)`);

    // Embed PNG icons as base64 so they appear in the standalone file
    const imgs = Array.from(clone.querySelectorAll("image"));
    await Promise.all(imgs.map(async (img) => {
      const href = img.getAttribute("href") ?? img.getAttribute("xlink:href") ?? "";
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

    // Resolve CSS var() tokens to concrete colors — they don't resolve in a
    // standalone file outside the app's stylesheet.
    const svgStr = clone.outerHTML.replace(/var\((--[a-z0-9-]+)\)/g,
      (_m, name) => cs.getPropertyValue(name).trim() || "#94A3B8");
    return { svg: svgStr, w: Math.round(bw), h: Math.round(bh) };
  };

  const exportSVG = async () => {
    setExportMenu(false);
    const built = await buildExportSVG(); if (!built) return;
    const blob = new Blob([built.svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "topology.svg"; a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportPNG = async () => {
    setExportMenu(false);
    const built = await buildExportSVG(); if (!built) return;
    const SCALE = 2;
    const url = URL.createObjectURL(new Blob([built.svg], { type:"image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = built.w*SCALE; c.height = built.h*SCALE;
      const ctx = c.getContext("2d"); if (!ctx) { URL.revokeObjectURL(url); return; }
      ctx.scale(SCALE,SCALE); ctx.drawImage(img,0,0);
      URL.revokeObjectURL(url);
      c.toBlob(b=>{ if(!b) return; const a=document.createElement("a"); a.href=URL.createObjectURL(b); a.download="topology.png"; a.click(); URL.revokeObjectURL(a.href); },"image/png");
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
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
      style={{
        // Pin to the viewport (minus topbar + page padding) so the editor fills
        // the screen and pans internally instead of scrolling the whole page.
        height: isFullscreen ? "100%" : "calc(100vh - 120px)",
        minHeight:0, overflow:"hidden",
        ...(isFullscreen && { background:"var(--bg)", padding:"20px 24px", position:"fixed", inset:0, zIndex:9999 })
      }}
      onClick={()=>{setCtxMenu(null);setEdgeMenu(null);setExportMenu(false);}}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-shrink-0 flex-wrap">
        <div>
          <p className="page-label">Design</p>
          <h1 className="page-title">Draft Topology</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-xl overflow-hidden"
            style={{border:"1px solid var(--border-2)"}}>
            <button onClick={undo} disabled={!history.length}
              className="icon-btn px-2.5 py-1.5 disabled:opacity-30" title="Undo (Ctrl+Z)">
              <Icon d="M3 7v6h6M3.51 13A9 9 0 1021 12" size={14}/>
            </button>
            <div style={{width:1,height:20,background:"var(--border)"}}/>
            <button onClick={redo} disabled={!future.length}
              className="icon-btn px-2.5 py-1.5 disabled:opacity-30" title="Redo (Ctrl+Y)">
              <Icon d="M21 7v6h-6M20.49 13A9 9 0 113 12" size={14}/>
            </button>
          </div>
          <button onClick={()=>setShowTemplates(true)}
            className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5">
            <Icon d={Icons.deploy} size={13}/> Templates
          </button>
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
          <div className="relative">
            <button onClick={()=>setExportMenu(v=>!v)} disabled={!nodes.length}
              className="btn btn-secondary text-xs py-1.5 px-3 gap-1.5 disabled:opacity-40">
              <Icon d={Icons.arrow} size={13}/> Export <Icon d={Icons.arrowDown} size={11}/>
            </button>
            {exportMenu&&(
              <div className="menu absolute right-0 mt-1 z-50"
                style={{minWidth:140}}
                onMouseLeave={()=>setExportMenu(false)}>
                <button onClick={exportPNG} className="menu-item">
                  <Icon d={Icons.install} size={13} color="var(--text-muted)"/> Export PNG
                </button>
                <button onClick={exportSVG} className="menu-item">
                  <Icon d={Icons.copy} size={13} color="var(--text-muted)"/> Export SVG
                </button>
              </div>
            )}
          </div>
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
          style={{background:"var(--ok-bg)",border:"1px solid var(--ok)",color:"var(--ok)"}}>
          <Icon d={Icons.check} size={16} color="var(--ok)"/>
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
          <p className="text-xs font-bold text-[var(--text-faint)] uppercase tracking-widest px-1 mb-3">
            Components
          </p>
          {PALETTE_GROUPS.map(g=>(
            <div key={g.id} className="mb-3">
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <Icon d={g.icon} size={11} color="var(--text-faint)"/>
                <span style={{fontSize:9.5,fontWeight:700,color:"var(--text-faint)",textTransform:"uppercase",letterSpacing:"0.07em"}}>
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
                    <KindIcon kind={item.kind} size={22}/>
                    <span style={{fontSize:11,fontWeight:600,color:item.stroke,lineHeight:1.2}}>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* ── Canvas column ── */}
        <div className="flex flex-col flex-1 min-w-0 gap-2">

          {/* Toolbar */}
          <div className="card flex-shrink-0 flex items-center gap-2 px-3 py-2 flex-wrap"
            style={{borderRadius:12}}>
            <button onClick={()=>{setConnectMode(false);setConnectFirst(null);}}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition"
              style={{background:!connectMode?"#F59E0B":"var(--bg-2)",color:!connectMode?"#FFF":"var(--text-muted)"}}>
              <Icon d={Icons.arrow} size={12}/> Select
            </button>
            <button onClick={()=>{setConnectMode(true);setSelected(null);}}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg transition"
              style={{background:connectMode?"#3B82F6":"var(--bg-2)",color:connectMode?"#FFF":"var(--text-muted)"}}>
              <Icon d={Icons.link} size={12}/> Connect
            </button>
            {connectMode&&(
              <span className="text-xs font-semibold" style={{color:"var(--info)"}}>
                {connectFirst?"→ click 2nd node":"→ click 1st node"}
              </span>
            )}
            <div style={{width:1,height:18,background:"var(--border)",margin:"0 2px"}}/>
            <button onClick={doAutoLayout} disabled={!nodes.length}
              className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg transition disabled:opacity-40"
              style={{background:"var(--violet-bg)",color:"var(--violet)",border:"1px solid var(--violet-border)"}}>
              <Icon d={Icons.spark} size={12}/> Auto Layout
            </button>
            {/* grid + snap toggles */}
            <button onClick={()=>setShowGrid(g=>!g)} title="Toggle grid"
              className="icon-btn" style={{color:showGrid?"var(--accent)":"var(--text-faint)"}}>
              <Icon d={Icons.deploy} size={14}/>
            </button>
            <button onClick={()=>setSnapOn(s=>!s)} title="Toggle snap-to-grid"
              className="icon-btn" style={{color:snapOn?"var(--accent)":"var(--text-faint)"}}>
              <Icon d={Icons.hash} size={14}/>
            </button>
            {/* search */}
            <div className="relative" style={{width:148}}>
              <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"var(--text-faint)"}}>
                <Icon d={Icons.search} size={12}/>
              </span>
              <input value={search} onChange={e=>setSearch(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")findNode(search);}}
                placeholder="Find node…"
                className="input" style={{padding:"4px 8px 4px 26px",fontSize:11,height:28}}/>
            </div>
            <div className="flex-1"/>
            {/* multi-select align tools */}
            {selIds().length>1&&(
              <>
                <span className="text-xs font-bold px-1.5" style={{color:"var(--info)"}}>{selIds().length} selected</span>
                {([["left","Align left","M4 4v16M8 7h12M8 12h8M8 17h12"],
                   ["hcenter","Align centre","M12 4v16M6 9h12M8 14h8"],
                   ["right","Align right","M20 4v16M4 7h12M8 12h8M4 17h12"],
                   ["top","Align top","M4 4h16M7 8v12M12 8v8M17 8v12"],
                   ["vcenter","Align middle","M4 12h16M9 6v12M14 8v8"],
                   ["bottom","Align bottom","M4 20h16M7 4v12M12 8v8M17 4v12"]] as const).map(([m,title,d])=>(
                  <button key={m} onClick={()=>alignSel(m as any)} title={title} className="icon-btn" style={{width:26,height:26}}>
                    <Icon d={d} size={13}/>
                  </button>
                ))}
                <button onClick={()=>distributeSel("h")} title="Distribute horizontally" className="icon-btn" style={{width:26,height:26}}><Icon d="M4 4v16M20 4v16M9 9h6v6H9z" size={13}/></button>
                <button onClick={()=>distributeSel("v")} title="Distribute vertically" className="icon-btn" style={{width:26,height:26}}><Icon d="M4 4h16M4 20h16M9 9h6v6H9z" size={13}/></button>
                <button onClick={deleteSelection} className="icon-btn text-xs flex items-center gap-1" style={{color:"var(--danger)"}}>
                  <Icon d={Icons.trash} size={13}/> Delete
                </button>
                <div style={{width:1,height:18,background:"var(--border)",margin:"0 2px"}}/>
              </>
            )}
            {selected&&selNode&&selIds().length<=1&&(
              <>
                <button onClick={()=>startEdit(selNode)}
                  className="icon-btn text-xs flex items-center gap-1">
                  <Icon d={Icons.key} size={13}/> Rename
                </button>
                <button onClick={()=>toggleFixed(selNode.id)}
                  className="icon-btn text-xs flex items-center gap-1"
                  style={{color:selNode.fixed?"var(--accent)":"var(--text-muted)"}}>
                  <Icon d={Icons.lock} size={13}/> {selNode.fixed?"Unpin":"Pin"}
                </button>
                <button onClick={deleteSelected}
                  className="icon-btn text-xs flex items-center gap-1" style={{color:"var(--danger)"}}>
                  <Icon d={Icons.trash} size={13}/> Delete
                </button>
                <div style={{width:1,height:18,background:"var(--border)",margin:"0 2px"}}/>
              </>
            )}
            <button onClick={()=>setScale(s=>Math.min(3,s*1.2))} className="icon-btn" title="Zoom in">
              <Icon d={Icons.plus} size={14}/>
            </button>
            <span className="text-xs font-mono text-[var(--text-faint)] w-9 text-center select-none">
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
              background:"var(--bg-2)",
              border:"1px solid var(--border)",
              cursor:connectMode?"crosshair":"default",
            }}
            onDragOver={e=>e.preventDefault()}
            onDrop={onDrop}
          >
            {/* Dot grid */}
            {showGrid&&(
            <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
              <defs>
                <pattern id="dotgrid" width={GRID} height={GRID} patternUnits="userSpaceOnUse"
                  patternTransform={`translate(${((pan.x%GRID)+GRID)%GRID},${((pan.y%GRID)+GRID)%GRID})`}>
                  <circle cx={GRID/2} cy={GRID/2} r={1} fill="var(--border-2)"/>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#dotgrid)"/>
            </svg>
            )}

            {/* Empty hint */}
            {nodes.length===0&&(
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <img src={routerIcon} alt="" style={{width:72,height:72,opacity:0.15}}/>
                <p className="text-sm font-semibold mt-5" style={{color:"var(--border-2)"}}>
                  Drag components from the palette to begin
                </p>
                <p className="text-xs mt-1.5 text-center px-12" style={{color:"var(--text-faint)"}}>
                  Or use "Import Live" to load your current deployed system topology
                </p>
                <div className="flex gap-2 mt-4">
                  {["Drag to place","Connect mode to wire","Right-click for options"].map(t=>(
                    <span key={t} className="text-xs px-2.5 py-1 rounded-full"
                      style={{background:"var(--bg-2)",color:"var(--text-faint)"}}>{t}</span>
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
                  <feDropShadow dx="0" dy="3" stdDeviation="6" floodColor="var(--shadow)"/>
                </filter>
                <filter id="shadow-sel" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="var(--shadow)"/>
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
                  const est=EDGE_STYLE[edge.type??"link"];
                  const col=est.color;
                  const labelTxt=edge.label || (edge.type&&edge.type!=="link"?est.label:"");
                  return (
                    <g key={edge.id}
                      onMouseEnter={()=>setHoveredEdge(edge.id)}
                      onMouseLeave={()=>setHoveredEdge(null)}
                      onContextMenu={e=>{e.preventDefault();e.stopPropagation();setEdgeMenu({x:e.clientX,y:e.clientY,eid:edge.id});}}>
                      {/* Wide transparent hit area */}
                      <path d={path} fill="none" stroke="transparent" strokeWidth={18}
                        style={{cursor:"pointer"}}/>
                      {/* Visible edge line — colored + dashed per connection type */}
                      <path d={path} fill="none"
                        stroke={col}
                        strokeWidth={isHov?3:2.2}
                        strokeDasharray={est.dash}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={isHov?1:0.9}
                        style={{pointerEvents:"none",transition:"stroke-width 0.15s,opacity 0.15s"}}/>
                      {/* Type / custom label chip */}
                      {labelTxt&&!isHov&&(
                        <g transform={`translate(${mx},${my})`} style={{pointerEvents:"none"}}>
                          <rect x={-labelTxt.length*3.3-6} y={-8} width={labelTxt.length*6.6+12} height={16} rx={8}
                            fill="var(--surface)" stroke={col} strokeWidth={1} opacity={0.96}/>
                          <text x={0} y={3.5} textAnchor="middle" fontSize={8.5} fontWeight="700"
                            fill={col} fontFamily="Inter,sans-serif">{labelTxt}</text>
                        </g>
                      )}
                      {/* Hover actions: edit (right-click hint) + delete */}
                      {isHov&&(
                        <g transform={`translate(${mx},${my})`}>
                          <g transform="translate(-12,0)" style={{cursor:"pointer"}}
                            onClick={e=>{e.stopPropagation();setEdgeMenu({x:(e as any).clientX,y:(e as any).clientY,eid:edge.id});}}>
                            <circle r={9} fill="var(--elevated)" stroke={col} strokeWidth={1.5}
                              style={{filter:"drop-shadow(0 2px 8px rgba(0,0,0,0.15))"}}/>
                            <svg x={-5} y={-5} width={10} height={10} viewBox="0 0 24 24" fill="none"
                              stroke={col} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d={Icons.settings}/></svg>
                          </g>
                          <g transform="translate(12,0)" style={{cursor:"pointer"}}
                            onClick={e=>{e.stopPropagation();deleteEdge(edge.id);}}>
                            <circle r={9} fill="var(--elevated)" stroke="var(--danger)" strokeWidth={1.5}
                              style={{filter:"drop-shadow(0 2px 8px rgba(0,0,0,0.15))"}}/>
                            <line x1={-4} y1={-4} x2={4} y2={4} stroke="var(--danger)" strokeWidth={2}/>
                            <line x1={4}  y1={-4} x2={-4} y2={4} stroke="var(--danger)" strokeWidth={2}/>
                          </g>
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
                  const isMulti=selectedIds.length>1&&selectedIds.includes(node.id);
                  const isCF=node.id===connectFirst;
                  const matchSearch=search.trim()!==""&&(node.label.toLowerCase().includes(search.trim().toLowerCase())||(node.ip?.toLowerCase().includes(search.trim().toLowerCase())));
                  const potMeta=node.potType
                    ? (KNOWN_POT_TYPES.find(p=>p.id===node.potType)||{color:"var(--text-faint)"})
                    : null;
                  return (
                    <g key={node.id}
                      transform={`translate(${node.x},${node.y})`}
                      style={{cursor:node.fixed?"not-allowed":connectMode?"pointer":"grab"}}
                      onMouseDown={e=>onNodeMD(e,node)}
                      onDoubleClick={()=>startEdit(node)}
                      onContextMenu={e=>onNodeRClick(e,node)}
                    >
                      {/* Search match halo */}
                      {matchSearch&&(
                        <rect x={-4} y={-4} width={NW+8} height={NH+8} rx={18}
                          fill="none" stroke="#F59E0B" strokeWidth={3} opacity={0.9}>
                          <animate attributeName="opacity" values="0.9;0.35;0.9" dur="1.2s" repeatCount="indefinite"/>
                        </rect>
                      )}
                      {/* Selection glow — inset within card bounds to avoid SVG-viewport clip artefacts */}
                      {(isSel||isCF||isMulti)&&(
                        <rect x={3} y={3} width={NW-6} height={NH-6} rx={13}
                          fill="none"
                          stroke={isCF?"#3B82F6":isMulti?"#3B82F6":m.stroke}
                          strokeWidth={2}
                          strokeDasharray={isCF?"7 3":undefined}
                          opacity={0.65}/>
                      )}

                      {/* Card shadow */}
                      <rect x={2} y={6} width={NW} height={NH} rx={16}
                        fill={isSel?`${m.stroke}18`:"var(--shadow)"}
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
                          stroke="var(--surface)" strokeWidth={1.5}/>
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

                      {/* PNG icon (kinds without a PNG asset keep the SVG fallback) */}
                      {m.img && (
                        <image href={m.img}
                          x={(NW-ICON)/2} y={10}
                          width={ICON} height={ICON}
                          style={{pointerEvents:"none"}}
                          onLoad={()=>setImgLoaded(p=>new Set([...p, node.kind]))}
                          onError={()=>{/* keep fallback visible */}}/>
                      )}

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
                          textAnchor="middle" fontSize={7.5} fill="var(--text-faint)"
                          fontFamily="Inter,sans-serif"
                          style={{pointerEvents:"none",userSelect:"none"}}>
                          {node.ip}
                        </text>
                      )}

                      {/* Honeypot type badge */}
                      {node.kind==="honeypot"&&node.potType&&editingId!==node.id&&(
                        <g>
                          <rect x={4} y={NH-9} width={NW-8} height={11} rx={5.5}
                            fill={potMeta?.color??"var(--text-faint)"} opacity={0.18}/>
                          <text x={NW/2} y={NH-2}
                            textAnchor="middle" fontSize={7} fontWeight="700"
                            fill={potMeta?.color??"var(--text-faint)"}
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

                {/* Marquee selection rectangle */}
                {marquee&&(
                  <rect
                    x={Math.min(marquee.x0,marquee.x1)} y={Math.min(marquee.y0,marquee.y1)}
                    width={Math.abs(marquee.x1-marquee.x0)} height={Math.abs(marquee.y1-marquee.y0)}
                    fill="rgba(59,130,246,0.10)" stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="5 3"
                    style={{pointerEvents:"none"}}/>
                )}
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
            <Stat label="honeypots" value={nodes.filter(n=>n.kind==="honeypot").length} color="var(--accent)"/>
            <Stat label="firewalls" value={nodes.filter(n=>n.kind==="firewall").length}  color="var(--danger)"/>
            <Stat label="pinned"    value={nodes.filter(n=>n.fixed).length}              color="var(--accent)"/>
            {nodes.some(n=>n.kind==="loganalyzer")&&(
              <Stat label="log analyzers" value={nodes.filter(n=>n.kind==="loganalyzer").length} color="var(--violet)"/>
            )}
            {nodes.some(n=>n.online!=null)&&(
              <Stat label="online" value={nodes.filter(n=>n.online===true).length}        color="var(--ok)"/>
            )}
            <div className="flex-1"/>
            <span className="text-xs text-[var(--text-faint)] hidden lg:block">
              Double-click rename · Shift-drag to box-select · Right-click edge to set type · Ctrl+C/V copy
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
                  style={{borderBottom:"1px solid var(--border)"}}>
                  <div className="flex items-center gap-2.5">
                    <KindIcon kind={selNode.kind} size={32}/>
                    <div>
                      <p className="text-sm font-bold text-[var(--text)] leading-tight">{selNode.label}</p>
                      <p className="text-xs font-semibold" style={{color:KIND_META[selNode.kind].stroke}}>
                        {KIND_META[selNode.kind].label}
                      </p>
                    </div>
                  </div>
                  <button onClick={()=>setSelected(null)} className="icon-btn" style={{color:"var(--text-faint)"}}>
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
                      background:selNode.fixed?"var(--warn-bg)":"var(--bg-2)",
                      border:`1px solid ${selNode.fixed?"var(--warn-border)":"var(--border)"}`,
                    }}>
                    <div>
                      <p className="text-xs font-semibold text-[var(--text)]">Pin position</p>
                      <p className="text-xs text-[var(--text-faint)]">Prevent accidental moves</p>
                    </div>
                    <button onClick={()=>toggleFixed(selNode.id)}
                      style={{
                        width:38,height:22,borderRadius:11,position:"relative",
                        background:selNode.fixed?"#F59E0B":"var(--border-2)",flexShrink:0,
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
                        background:selNode.online?"var(--ok-bg)":"var(--danger-bg)",
                        border:`1px solid ${selNode.online?"var(--ok)":"var(--danger)"}`,
                      }}>
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{background:selNode.online?"#10B981":"#EF4444"}}/>
                      <div>
                        <p className="text-xs font-semibold"
                          style={{color:selNode.online?"var(--ok)":"var(--danger)"}}>
                          {selNode.online?"Online — live node":"Offline"}
                        </p>
                        <p className="text-xs" style={{color:selNode.online?"var(--ok)":"var(--danger)"}}>
                          Imported from system
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 p-4 flex-shrink-0"
                  style={{borderTop:"1px solid var(--border)"}}>
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
                  style={{borderBottom:"1px solid var(--border)"}}>
                  <div className="flex items-center gap-2">
                    <div className="rounded-lg flex items-center justify-center"
                      style={{width:28,height:28,background:"var(--warn-bg)"}}>
                      <Icon d={Icons.spark} size={14} color="var(--accent)"/>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-[var(--text)]">System Opinion</p>
                      <p className="text-xs text-[var(--text-faint)]">Heuristic analysis</p>
                    </div>
                  </div>
                  <button onClick={()=>setShowOpinion(false)} className="icon-btn" style={{color:"var(--text-faint)"}}>
                    <Icon d={Icons.close} size={15}/>
                  </button>
                </div>

                {/* Score ring */}
                <div className="flex flex-col items-center py-4"
                  style={{borderBottom:"1px solid var(--border)"}}>
                  <svg width={88} height={88} viewBox="0 0 88 88">
                    <circle cx={44} cy={44} r={RING_R} fill="none" stroke="var(--border)" strokeWidth={8}/>
                    <circle cx={44} cy={44} r={RING_R} fill="none"
                      stroke={rColor} strokeWidth={8} strokeLinecap="round"
                      strokeDasharray={CIRC} strokeDashoffset={ringOff}
                      transform="rotate(-90 44 44)"
                      style={{transition:"stroke-dashoffset 0.9s ease,stroke 0.4s"}}/>
                    <text x={44} y={49} textAnchor="middle" fontSize={22} fontWeight="800"
                      fill={rColor} fontFamily="Inter,sans-serif">{score}</text>
                    <text x={44} y={62} textAnchor="middle" fontSize={8} fill="var(--text-faint)"
                      fontFamily="Inter,sans-serif">/ 100</text>
                  </svg>
                  <p className="text-xs font-bold mt-1" style={{color:rColor}}>
                    {score>=70?"Solid design":score>=45?"Needs work":"High risk"}
                  </p>
                  <div className="flex gap-2 mt-2 flex-wrap justify-center">
                    {crit>0&&<Badge bg="var(--danger-bg)" fg="var(--danger)">{crit} Critical</Badge>}
                    {warn>0&&<Badge bg="var(--warn-bg)" fg="var(--warn)">{warn} Warning</Badge>}
                    {good>0&&<Badge bg="var(--ok-bg)" fg="var(--ok)">{good} Good</Badge>}
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
                  style={{borderTop:"1px solid var(--border)"}}>
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
              background:"var(--elevated)",
              border:"1px solid var(--border-2)",
              boxShadow:"0 8px 32px var(--shadow),0 2px 8px var(--shadow)",
              minWidth:190,
            }}
            onClick={e=>e.stopPropagation()}>
            <div className="flex items-center gap-2.5 px-3 py-2.5"
              style={{borderBottom:"1px solid var(--border)",background:"var(--bg-2)"}}>
              <KindIcon kind={n.kind} size={22}/>
              <div>
                <p className="text-xs font-bold text-[var(--text)]">{n.label}</p>
                <p className="text-xs" style={{color:KIND_META[n.kind].stroke}}>
                  {KIND_META[n.kind].label}
                  {n.potType&&` · ${n.potType}`}
                </p>
              </div>
            </div>
            {[
              {label:"Rename",                    icon:Icons.key,  col:undefined,   act:()=>{startEdit(n);setCtxMenu(null);}},
              {label:n.fixed?"Unpin":"Pin position",icon:Icons.lock,col:n.fixed?"var(--accent)":undefined,act:()=>{toggleFixed(n.id);setCtxMenu(null);}},
              {label:"Connect from here",          icon:Icons.link, col:undefined,   act:()=>{setConnectMode(true);setConnectFirst(n.id);setCtxMenu(null);}},
              {label:"Duplicate",                  icon:Icons.copy, col:undefined,   act:()=>{duplicateNode(n.id);setCtxMenu(null);}},
              null as null,
              {label:"Delete node",                icon:Icons.trash,col:"var(--danger)",   act:()=>{deleteSelected();setCtxMenu(null);}},
            ].map((item,i)=>
              item===null?(
                <div key={i} style={{height:1,background:"var(--border)",margin:"2px 0"}}/>
              ):(
                <button key={i} onClick={item.act}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold transition"
                  style={{color:item.col??"var(--text)"}}
                  onMouseEnter={e=>(e.currentTarget.style.background="var(--bg-2)")}
                  onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                  <Icon d={item.icon} size={13} color={item.col??"var(--text-muted)"}/>
                  {item.label}
                </button>
              )
            )}
          </div>
        );
      })()}

      {/* ══ Edge context menu — set connection type + label ══════════ */}
      {edgeMenu&&(()=>{
        const ed=edges.find(e=>e.id===edgeMenu.eid); if (!ed) return null;
        return (
          <div className="fixed z-50 rounded-2xl overflow-hidden"
            style={{left:edgeMenu.x,top:edgeMenu.y,background:"var(--elevated)",border:"1px solid var(--border-2)",
              boxShadow:"0 8px 32px var(--shadow)",minWidth:200,padding:8}}
            onClick={e=>e.stopPropagation()}>
            <p className="text-xs font-bold px-1.5 pb-1.5" style={{color:"var(--text-faint)"}}>CONNECTION TYPE</p>
            <div className="grid grid-cols-1 gap-0.5">
              {EDGE_TYPES.map(t=>{
                const st=EDGE_STYLE[t]; const on=(ed.type??"link")===t;
                return (
                  <button key={t} onClick={()=>{setEdgeType(ed.id,t);}}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-xs font-semibold"
                    style={{background:on?`${st.color}1f`:"transparent",color:on?st.color:"var(--text)"}}
                    onMouseEnter={e=>{if(!on)e.currentTarget.style.background="var(--bg-2)";}}
                    onMouseLeave={e=>{if(!on)e.currentTarget.style.background="transparent";}}>
                    <span style={{width:18,height:0,borderTop:`2.5px ${st.dash?"dashed":"solid"} ${st.color}`}}/>
                    {st.label}
                    {on&&<Icon d={Icons.check} size={12} color={st.color} style={{marginLeft:"auto"}}/>}
                  </button>
                );
              })}
            </div>
            <div style={{height:1,background:"var(--border)",margin:"6px 0"}}/>
            <input className="input text-xs" placeholder="Label (e.g. 2222 / SSH)…" defaultValue={ed.label??""}
              onChange={e=>setEdgeLabel(ed.id,e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")setEdgeMenu(null);}}/>
            <button onClick={()=>{deleteEdge(ed.id);setEdgeMenu(null);}}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-semibold mt-1.5"
              style={{color:"var(--danger)"}}
              onMouseEnter={e=>e.currentTarget.style.background="var(--danger-bg)"}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              <Icon d={Icons.trash} size={13} color="var(--danger)"/> Delete connection
            </button>
          </div>
        );
      })()}

      {/* ══ Templates dialog ══════════════════════════════════════ */}
      {showTemplates&&(
        <Modal onClose={()=>setShowTemplates(false)} title="Start from a Template"
          sub="Pick a reference architecture — it loads onto the canvas, auto-arranged and ready to edit.">
          <div className="grid grid-cols-1 gap-2.5">
            {TEMPLATES.map(t=>(
              <button key={t.id} onClick={()=>loadTemplate(t.build())}
                className="text-left rounded-xl p-3.5 transition"
                style={{background:"var(--bg-2)",border:"1px solid var(--border)"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--accent)";e.currentTarget.style.background="var(--warn-bg)";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.background="var(--bg-2)";}}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-bold" style={{color:"var(--text)"}}>{t.name}</p>
                  <Icon d={Icons.arrow} size={14} color="var(--accent)"/>
                </div>
                <p className="text-xs mb-2" style={{color:"var(--text-muted)"}}>{t.desc}</p>
                <div className="flex gap-1.5 flex-wrap">
                  {t.tags.map(tag=>(
                    <span key={tag} className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{background:"var(--warn-bg)",color:"var(--accent)"}}>{tag}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
          <p className="text-xs mt-3" style={{color:"var(--text-faint)"}}>Loading a template replaces the current canvas — save your draft first if needed.</p>
        </Modal>
      )}

      {/* ══ Import Live dialog ════════════════════════════════════ */}
      {showImport&&(
        <Modal onClose={()=>{setShowImport(false);setImportErr("");}}
          title="Import Live System Topology"
          sub="Fetches your registered nodes and deployments and builds a topology automatically.">
          <div className="rounded-xl p-4 mb-4"
            style={{background:"var(--bg-2)",border:"1px solid var(--border)"}}>
            <p className="text-xs font-semibold text-[var(--text)] mb-1">What will be imported:</p>
            <ul className="text-xs text-[var(--text-muted)] leading-relaxed list-disc pl-4">
              <li>A starting Internet + Firewall + Router chain</li>
              <li>One server card per registered node (Linux / Windows based on OS)</li>
              <li>One honeypot card per active deployment, linked to its node</li>
              <li>IP addresses, hostnames, and online status from your agents</li>
            </ul>
          </div>
          <p className="text-xs text-[var(--text-faint)] mb-4">
            Existing canvas content will be replaced. Save your draft first if needed.
          </p>
          {importErr&&(
            <div className="text-xs rounded-xl px-3 py-2 mb-3"
              style={{color:"var(--danger)",background:"var(--danger-bg)",border:"1px solid var(--danger-border)"}}>
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
              <div className="rounded-xl p-8 text-center" style={{background:"var(--bg-2)"}}>
                <p className="text-sm font-medium text-[var(--text-faint)]">No saved topologies yet</p>
              </div>
            )}
            {savedList.map(s=>(
              <div key={s.id} className="flex items-center gap-3 rounded-xl p-3"
                style={{background:"var(--bg-2)",border:"1px solid var(--border)"}}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--text)] truncate">{s.name}</p>
                  <p className="text-xs text-[var(--text-faint)]">
                    {new Date(s.savedAt).toLocaleString(undefined,
                      {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                    {" · "}{s.data.nodes.length}n, {s.data.edges.length}e
                  </p>
                </div>
                <button onClick={()=>loadTopo(s)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold flex-shrink-0"
                  style={{background:"var(--warn-bg)",color:"var(--accent)",border:"1px solid var(--warn-border)"}}>
                  Load
                </button>
                <button onClick={()=>deleteSaved(s.id)} className="icon-btn flex-shrink-0"
                  style={{color:"var(--danger)"}}>
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
      background:"var(--glass-strong)",
      border:"1px solid var(--border-2)",
      borderRadius:12,overflow:"hidden",
      backdropFilter:"blur(10px)",
      boxShadow:"0 2px 14px var(--shadow)",
    }}>
      <svg width={W} height={H}>
        {edges.map(e=>{
          const s=nodes.find(n=>n.id===e.source), t=nodes.find(n=>n.id===e.target);
          if(!s||!t) return null;
          return <line key={e.id}
            x1={s.x*ms+ox+NW*ms/2} y1={s.y*ms+oy+NH*ms/2}
            x2={t.x*ms+ox+NW*ms/2} y2={t.y*ms+oy+NH*ms/2}
            stroke="var(--border-2)" strokeWidth={0.9}/>;
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
    <span className="text-xs text-[var(--text-muted)]">
      <strong style={{color:color??"var(--text)"}}>{value}</strong> {label}
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
      style={{background:"var(--overlay)",backdropFilter:"blur(6px)"}}
      onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="card rounded-2xl p-6 shadow-2xl"
        style={{width:440,maxHeight:"82vh",display:"flex",flexDirection:"column",
                background:"var(--surface)",border:"1px solid var(--border-2)"}}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-[var(--text)]">{title}</h2>
            {sub&&<p className="text-xs text-[var(--text-faint)] mt-0.5">{sub}</p>}
          </div>
          <button onClick={onClose} className="icon-btn -mt-1" style={{color:"var(--text-faint)"}}>
            <Icon d={Icons.close} size={16}/>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
