import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ComposableMap, Geographies, Geography, Graticule, Sphere } from "react-simple-maps";
import { geoMercator } from "d3-geo";
import api from "../api/client";
import { useWebSocket } from "../hooks/useWebSocket";
import { Icon, Icons } from "../components/Icons";

/* ════════════════════════════════════════════════════════════════════
   Live Attack Map — a dark "cyber threat map": geolocated honeypot hits
   plotted on a glowing world map, with animated attack arcs streaming from
   each attacker origin toward the defended honeypot grid in real time.

   • Seeds from GET /events (recent geo-tagged hits) so it's populated on load,
     then streams live over the "pot_events" WS topic.
   • Geolocation is enriched server-side via MaxMind GeoLite2-City; events with
     no lat/lon (loopback / private / unresolved IPs) are skipped.
   ──────────────────────────────────────────────────────────────────── */

const GEO_URL = "https://unpkg.com/world-atlas@2.0.2/countries-110m.json";

// Map canvas geometry + projection. The projection here MUST match the props
// passed to <ComposableMap> (same center/scale, translate = [W/2, H/2]) so the
// raw SVG arcs we draw line up exactly with the rendered geographies.
const MAP_W = 980;
const MAP_H = 520;
const CENTER: [number, number] = [10, 22];
const SCALE = 165;
// Defended honeypot grid — attack arcs converge here.
const TARGET: [number, number] = [31.2357, 30.0444]; // Cairo, Egypt

interface GeoEvent {
  id: number;
  source_ip: string;
  event_type: string;
  honeypot_type: string;
  event_time: string;
  country_code: string;
  city: string;
  lat: number;
  lon: number;
}

interface Flash { key: string; lon: number; lat: number; }

// Windows has no flag-emoji glyphs (it renders the bare letters, e.g. "US"), so
// we render real flag images from flagcdn — these display identically on every
// platform. countryName resolves the ISO code to a human name via the built-in
// Intl API.
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function countryName(cc: string): string {
  if (!cc || cc.length !== 2) return "Unknown";
  try { return regionNames.of(cc.toUpperCase()) || cc.toUpperCase(); } catch { return cc.toUpperCase(); }
}

function Flag({ cc, size = 20 }: { cc: string; size?: number }) {
  const code = (cc || "").toLowerCase();
  const h = Math.round(size * 0.75);
  if (code.length !== 2) {
    return (
      <span style={{ width: size, height: h, display: "inline-grid", placeItems: "center", borderRadius: 3, background: "var(--bg-2)", fontSize: size * 0.55 }}>🌐</span>
    );
  }
  return (
    <img
      src={`https://flagcdn.com/${code}.svg`}
      alt={cc.toUpperCase()}
      width={size}
      height={h}
      loading="lazy"
      style={{ borderRadius: 3, objectFit: "cover", display: "block", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", background: "var(--bg-2)" }}
    />
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${Math.max(s, 1)}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function hasGeo(e: any): e is GeoEvent {
  return e && typeof e.lat === "number" && typeof e.lon === "number" && (e.lat !== 0 || e.lon !== 0);
}

// Quadratic bezier bowing upward from a source point to the target point.
function arcPath([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2 - Math.min(dist * 0.42, 190);
  return `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
}

export default function AttackMapPage() {
  const { connected, lastMessage } = useWebSocket(["pot_events"]);

  const { data: seeded = [] } = useQuery<GeoEvent[]>({
    queryKey: ["attack-map-seed"],
    queryFn: async () => {
      const rows = (await api.get("/events?limit=400")).data ?? [];
      return (Array.isArray(rows) ? rows : []).filter(hasGeo);
    },
    refetchInterval: 30_000,
  });

  const [live, setLive] = useState<GeoEvent[]>([]);
  const [flashes, setFlashes] = useState<Flash[]>([]);
  const flashSeq = useRef(0);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "event_new") return;
    const ev = lastMessage.payload as GeoEvent | undefined;
    if (!hasGeo(ev)) return;

    setLive((prev) => (prev.some((p) => p.id === ev.id) ? prev : [ev, ...prev].slice(0, 80)));

    const key = `f${flashSeq.current++}`;
    setFlashes((prev) => [...prev.slice(-17), { key, lon: ev.lon, lat: ev.lat }]);
    const t = setTimeout(() => setFlashes((prev) => prev.filter((f) => f.key !== key)), 3600);
    return () => clearTimeout(t);
  }, [lastMessage]);

  const projection = useMemo(
    () => geoMercator().center(CENTER).scale(SCALE).translate([MAP_W / 2, MAP_H / 2]),
    [],
  );
  const targetXY = useMemo(() => projection(TARGET) as [number, number] | null, [projection]);

  const feed = useMemo<GeoEvent[]>(() => {
    const byId = new Map<number, GeoEvent>();
    for (const e of [...live, ...seeded]) if (!byId.has(e.id)) byId.set(e.id, e);
    return Array.from(byId.values())
      .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime())
      .slice(0, 50);
  }, [live, seeded]);

  const dots = useMemo(() => {
    const byKey = new Map<string, GeoEvent>();
    for (const e of [...seeded, ...live]) {
      const k = `${e.lat.toFixed(2)},${e.lon.toFixed(2)}`;
      if (!byKey.has(k)) byKey.set(k, e);
    }
    return Array.from(byKey.values()).slice(0, 300);
  }, [seeded, live]);

  const stats = useMemo(() => {
    const byId = new Map<number, GeoEvent>();
    for (const e of [...live, ...seeded]) byId.set(e.id, e);
    const unique = Array.from(byId.values());
    const countries = new Map<string, number>();
    for (const e of unique) {
      const cc = e.country_code || "??";
      countries.set(cc, (countries.get(cc) ?? 0) + 1);
    }
    const top = Array.from(countries.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { located: unique.length, countries: countries.size, top };
  }, [live, seeded]);

  const empty = feed.length === 0;

  return (
    <div className="space-y-6 animate-fade-up">
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <p className="page-label">Monitoring</p>
          <h1 className="page-title" style={{ marginBottom: 2 }}>Live Attack Map</h1>
          <p style={{ fontSize: 12, color: "var(--text-faint)" }}>
            Geolocated honeypot hits streaming to the defended grid in real time
          </p>
        </div>
      </div>

      {/* ════════ Dark cyber map canvas ════════ */}
      <div
        style={{
          position: "relative",
          borderRadius: 18,
          overflow: "hidden",
          border: "1px solid #1c3a5e",
          background: "radial-gradient(130% 95% at 50% 18%, #0e2440 0%, #081628 52%, #04090f 100%)",
          boxShadow: "0 24px 70px rgba(0,0,0,0.45), inset 0 1px 0 rgba(120,170,230,0.12)",
        }}
      >
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ center: CENTER, scale: SCALE }}
          width={MAP_W}
          height={MAP_H}
          style={{ width: "100%", height: "auto", display: "block" }}
        >
          <defs>
            <filter id="amberGlow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="dotGrad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="100%" stopColor="#F59E0B" />
            </radialGradient>
          </defs>

          <Sphere id="sphere" fill="#08182b" stroke="transparent" strokeWidth={0} />
          <Graticule stroke="rgba(70,110,165,0.16)" strokeWidth={0.4} />

          <Geographies geography={GEO_URL}>
            {({ geographies }: { geographies: any[] }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="#11294a"
                  stroke="rgba(86,140,205,0.45)"
                  strokeWidth={0.5}
                  style={{
                    default: { outline: "none" },
                    hover: { outline: "none", fill: "#173763" },
                    pressed: { outline: "none" },
                  }}
                />
              ))
            }
          </Geographies>

          {/* Static origin nodes — every known geo origin */}
          {dots.map((d, i) => {
            const p = projection([d.lon, d.lat]) as [number, number] | null;
            if (!p) return null;
            return <circle key={`d${i}`} cx={p[0]} cy={p[1]} r={1.8} fill="url(#dotGrad)" opacity={0.55} />;
          })}

          {/* Defended grid (target) — converging arcs land here */}
          {targetXY && (
            <g>
              {[0, 1, 2].map((i) => (
                <circle key={i} cx={targetXY[0]} cy={targetXY[1]} r={6} fill="none" stroke="#34D399" strokeWidth={1.1}>
                  <animate attributeName="r" from="6" to="30" dur="2.6s" begin={`${i * 0.85}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.65" to="0" dur="2.6s" begin={`${i * 0.85}s`} repeatCount="indefinite" />
                </circle>
              ))}
              <circle cx={targetXY[0]} cy={targetXY[1]} r={4} fill="#34D399" filter="url(#amberGlow)" />
              <text x={targetXY[0] + 9} y={targetXY[1] + 4} fontSize={9} fontWeight={700} fill="#6EE7B7" style={{ letterSpacing: "0.08em" }}>
                GRID
              </text>
            </g>
          )}

          {/* Live attack arcs: source flare → drawn arc → traveling pulse */}
          {flashes.map((f) => {
            const s = projection([f.lon, f.lat]) as [number, number] | null;
            if (!s || !targetXY) return null;
            const d = arcPath(s, targetXY);
            return (
              <g key={f.key}>
                <circle cx={s[0]} cy={s[1]} r={4} fill="none" stroke="#FCA311" strokeWidth={1.2}>
                  <animate attributeName="r" from="3" to="20" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" from="0.85" to="0" dur="2s" repeatCount="indefinite" />
                </circle>
                <circle cx={s[0]} cy={s[1]} r={2.6} fill="#FDE68A" filter="url(#amberGlow)" />
                <path
                  d={d}
                  pathLength={1}
                  fill="none"
                  stroke="#FBBF24"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                  strokeDasharray={1}
                  filter="url(#amberGlow)"
                >
                  <animate attributeName="stroke-dashoffset" from="1" to="0" dur="1s" fill="freeze" />
                  <animate attributeName="opacity" from="0.95" to="0.12" begin="1.4s" dur="1.9s" fill="freeze" />
                </path>
                <circle r={2.8} fill="#fff" filter="url(#amberGlow)">
                  <animateMotion path={d} dur="1s" fill="freeze" />
                  <animate attributeName="opacity" from="1" to="0" begin="1s" dur="0.6s" fill="freeze" />
                </circle>
              </g>
            );
          })}
        </ComposableMap>

        {/* ── Overlay: title + live status (top-left) ── */}
        <div style={{ position: "absolute", top: 14, left: 16, display: "flex", alignItems: "center", gap: 10, pointerEvents: "none" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999,
            background: "rgba(8,20,34,0.7)", border: "1px solid rgba(86,140,205,0.3)", backdropFilter: "blur(8px)",
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: connected ? "#34D399" : "#64748B",
              boxShadow: connected ? "0 0 0 3px rgba(52,211,153,0.25)" : "none",
              animation: connected ? "pulse-green 2s infinite" : "none",
            }} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", color: "#CBD5E1", textTransform: "uppercase" }}>
              {connected ? "Live" : "Offline"}
            </span>
          </span>
        </div>

        {/* ── Overlay: recent-origins feed (top-right) ── */}
        <div className="map-feed" style={{
          position: "absolute", top: 14, right: 14, width: 280, maxHeight: MAP_H - 130,
          display: "flex", flexDirection: "column",
          background: "rgba(7,17,29,0.74)", border: "1px solid rgba(86,140,205,0.28)",
          borderRadius: 13, backdropFilter: "blur(10px)", overflow: "hidden",
          boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
        }}>
          <div style={{ padding: "10px 13px", borderBottom: "1px solid rgba(86,140,205,0.2)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "#93C5FD" }}>Incoming</span>
            <span style={{ fontSize: 10.5, color: "#64748B" }}>{feed.length}</span>
          </div>
          <div style={{ overflowY: "auto" }}>
            {empty ? (
              <div style={{ padding: 18, textAlign: "center", fontSize: 11.5, color: "#64748B" }}>No geo-located hits yet.</div>
            ) : (
              feed.map((e, i) => (
                <div key={e.id} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "8px 13px",
                  borderBottom: "1px solid rgba(86,140,205,0.12)",
                  animation: i === 0 ? "fadeIn .4s ease" : undefined,
                }}>
                  <Flag cc={e.country_code} size={18} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: "#E2E8F0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.city ? `${e.city}, ` : ""}{e.country_code || "Unknown"}
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10.5, color: "#7C93AD", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e.source_ip} · <span style={{ color: "#FBBF24" }}>{e.honeypot_type || e.event_type}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "#5B7088", whiteSpace: "nowrap" }}>{relativeTime(e.event_time)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Overlay: stat chips (bottom-left) ── */}
        <div style={{ position: "absolute", left: 16, bottom: 14, display: "flex", gap: 8, flexWrap: "wrap", pointerEvents: "none" }}>
          <MapChip label="Hits" value={stats.located.toLocaleString()} />
          <MapChip label="Countries" value={String(stats.countries)} />
          <MapChip label="Live" value={live.length.toLocaleString()} accent />
          {stats.top[0] && <MapChip label="Top" value={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Flag cc={stats.top[0][0]} size={15} />{stats.top[0][0]}</span>} />}
        </div>

        {/* ── Overlay: legend (bottom-right) ── */}
        <div style={{ position: "absolute", right: 16, bottom: 14, display: "flex", gap: 12, pointerEvents: "none",
          fontSize: 10.5, fontWeight: 600, color: "#8FA8C2" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#F59E0B", boxShadow: "0 0 6px #F59E0B" }} /> Origin
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#34D399", boxShadow: "0 0 6px #34D399" }} /> Defended grid
          </span>
        </div>

        {empty && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
            <div style={{ textAlign: "center", maxWidth: 380, padding: 24 }}>
              <Icon d={Icons.globe} size={34} color="#3B6090" />
              <p style={{ marginTop: 10, fontWeight: 700, color: "#93C5FD" }}>Waiting for geo-located attacks</p>
              <p style={{ marginTop: 4, fontSize: 12, color: "#5B7088" }}>
                Public-IP hits appear here once events with coordinates arrive. Make sure you're viewing the org that's
                receiving traffic and that <code>GeoLite2-City.mmdb</code> is loaded.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Top attack origins (SOC threat-intel data grid) ── */}
      <div className="card">
        <div style={{ marginBottom: 14 }}>
          <h3 className="section-title">Top attack origins</h3>
          <p style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 2 }}>
            Geo-located honeypot hits by source country
          </p>
        </div>

        <div className="to-grid" role="table" aria-label="Top attack origins">
          <div className="to-head" role="row">
            <span className="to-h" role="columnheader">Rank</span>
            <span className="to-h" role="columnheader">Origin</span>
            <span className="to-h" role="columnheader">Distribution</span>
            <span className="to-h to-h-num" role="columnheader">Hits</span>
            <span className="to-h to-h-num to-h-share" role="columnheader">Share</span>
          </div>

          {stats.top.length === 0 ? (
            <div className="to-empty">
              No geo-located origins yet — waiting for attacks with public-IP geolocation in this organization.
            </div>
          ) : (
            stats.top.map(([cc, count], i) => {
              const max = stats.top[0][1] || 1;
              const pct = Math.max((count / max) * 100, 1.5);
              const share = stats.located ? (count / stats.located) * 100 : 0;
              const lead = i === 0;
              return (
                <div key={cc} className={"to-row" + (lead ? " to-row-lead" : "")} role="row">
                  <span className="to-rank" role="cell">{String(i + 1).padStart(2, "0")}</span>

                  <span className="to-origin" role="cell">
                    <Flag cc={cc} size={20} />
                    <span className="to-name" title={countryName(cc)}>{countryName(cc)}</span>
                    <span className="to-iso">{cc.toUpperCase()}</span>
                  </span>

                  <span className="to-dist" role="cell">
                    <span className="to-track"><span className="to-fill" style={{ width: `${pct}%` }} /></span>
                  </span>

                  <span className="to-num to-hits" role="cell">{count.toLocaleString()}</span>

                  <span className="to-num to-share" role="cell">
                    {share.toFixed(1)}<span className="to-pct">%</span>
                  </span>
                </div>
              );
            })
          )}

          {stats.top.length > 0 && (
            <div className="to-foot">
              <span>{stats.top.length} of {stats.countries} origins</span>
              <span>{stats.located.toLocaleString()} located hits</span>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media (max-width: 820px) { .map-feed { display: none !important; } }

        .to-grid { display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface); }
        .to-head, .to-row { display: grid; grid-template-columns: 44px minmax(120px, max-content) minmax(110px, 1fr) 84px 60px; align-items: center; column-gap: 16px; padding: 0 14px; }
        .to-head { height: 32px; background: var(--bg-2); border-bottom: 1px solid var(--border); }
        .to-h { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-faint); white-space: nowrap; }
        .to-h-num { text-align: right; }

        .to-empty { padding: 22px 16px; text-align: center; font-size: 12px; color: var(--text-faint); }
        .to-row { height: 44px; border-bottom: 1px solid var(--border); transition: background .12s ease; }
        .to-row:hover { background: var(--bg-2); }
        .to-row-lead { box-shadow: inset 2px 0 0 var(--accent); }

        .to-rank { font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-faint); }
        .to-row-lead .to-rank { color: var(--accent); }

        .to-origin { display: flex; align-items: center; gap: 9px; min-width: 0; }
        .to-name { min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .to-iso { flex-shrink: 0; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 9.5px; font-weight: 700; letter-spacing: 0.05em; color: var(--text-muted); background: var(--bg-2); border: 1px solid var(--border-2); border-radius: 4px; padding: 1px 5px; }

        .to-num { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
        .to-hits { font-size: 12.5px; font-weight: 600; color: var(--text); }
        .to-share { font-size: 11.5px; font-weight: 500; color: var(--text-muted); }
        .to-pct { font-size: 9.5px; color: var(--text-faint); margin-left: 1px; }

        .to-dist { display: flex; align-items: center; }
        .to-track { position: relative; width: 100%; height: 5px; border-radius: 2px; background: var(--bg-2); overflow: hidden; box-shadow: inset 0 0 0 1px var(--border); }
        .to-fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 2px; background: color-mix(in srgb, var(--text-muted) 50%, transparent); }
        .to-row-lead .to-fill { background: var(--accent); }

        .to-foot { display: flex; align-items: center; justify-content: space-between; height: 32px; padding: 0 14px; background: var(--bg-2); font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-faint); }
        .to-foot span:last-child { font-family: ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }

        @media (max-width: 640px) {
          .to-head, .to-row { grid-template-columns: 38px minmax(96px, max-content) minmax(70px, 1fr) 70px; column-gap: 12px; }
          .to-h-share, .to-share { display: none; }
        }
      `}</style>
    </div>
  );
}

function MapChip({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 10,
      background: "rgba(8,20,34,0.72)", border: `1px solid ${accent ? "rgba(251,191,36,0.4)" : "rgba(86,140,205,0.28)"}`,
      backdropFilter: "blur(8px)",
    }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#7C93AD" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: accent ? "#FBBF24" : "#E2E8F0" }}>{value}</span>
    </span>
  );
}
