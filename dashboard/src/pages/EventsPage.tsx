import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { useState, useMemo, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Icon, Icons } from "../components/Icons";

// ── Type colour map ─────────────────────────────────────────────────────────
const TYPE_META: Record<string, { bg: string; fg: string; border: string; bar: string; label: string }> = {
  login:       { bg: "#FFFBEB", fg: "#B45309", border: "#FDE68A", bar: "#F59E0B", label: "Login" },
  "ssh.login": { bg: "#FFFBEB", fg: "#B45309", border: "#FDE68A", bar: "#F59E0B", label: "SSH Login" },
  command:     { bg: "#ECFDF5", fg: "#065F46", border: "#A7F3D0", bar: "#10B981", label: "Command" },
  connect:     { bg: "#EFF6FF", fg: "#1D4ED8", border: "#BFDBFE", bar: "#3B82F6", label: "Connect" },
  disconnect:  { bg: "#F5F3FF", fg: "#6D28D9", border: "#DDD6FE", bar: "#8B5CF6", label: "Disconnect" },
  error:       { bg: "#FEF2F2", fg: "#B91C1C", border: "#FECACA", bar: "#EF4444", label: "Error" },
  scan:        { bg: "#FFF7ED", fg: "#C2410C", border: "#FED7AA", bar: "#F97316", label: "Scan" },
};

function typeMeta(t: string) {
  return TYPE_META[t] ?? { bg: "#F8FAFC", fg: "#475569", border: "#E2E8F0", bar: "#94A3B8", label: t };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtRelative(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function TypeBadge({ type }: { type: string }) {
  const m = typeMeta(type);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 99,
      fontSize: 11, fontWeight: 700, letterSpacing: "0.02em",
      background: m.bg, color: m.fg, border: `1px solid ${m.border}`,
    }}>
      {m.label}
    </span>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color }: { label: string; value: any; icon: string; color: string }) {
  return (
    <div style={{
      background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14,
      padding: "16px 20px", display: "flex", alignItems: "center", gap: 14,
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0,
        background: `${color}18`, border: `1px solid ${color}30`,
      }}>
        <Icon d={icon} size={18} color={color} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", lineHeight: 1.1 }}>{value ?? "—"}</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TYPE_PILLS = ["login", "ssh.login", "connect", "disconnect", "command", "error", "scan"];

export default function EventsPage() {
  const [typeFilter, setTypeFilter]     = useState("");
  const [ipFilter, setIpFilter]         = useState("");
  const [potFilter, setPotFilter]       = useState("");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // build server-side query string (type only – others are client-filtered for snappiness)
  const serverQuery = typeFilter ? `event_type=${encodeURIComponent(typeFilter)}` : "";

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["events", serverQuery],
    queryFn: async () => (await api.get(`/events?limit=300${serverQuery ? "&" + serverQuery : ""}`)).data,
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    refetchOnWindowFocus: refreshInterval > 0,
  });

  const { data: nodesData } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    staleTime: 60_000,
  });
  const nodeMap = useMemo(() => {
    const m: Record<number, string> = {};
    (nodesData ?? []).forEach((n: any) => { m[n.id] = n.name; });
    return m;
  }, [nodesData]);

  // reset to page 0 whenever filters change
  useEffect(() => { setPage(0); }, [typeFilter, ipFilter, potFilter]);

  const raw: any[] = data ?? [];

  // client-side filtering for ip / pot
  const list = useMemo(() => {
    let r = raw;
    if (ipFilter.trim())  r = r.filter((e) => e.source_ip?.includes(ipFilter.trim()));
    if (potFilter.trim()) r = r.filter((e) => e.pot_id?.includes(potFilter.trim()));
    return r;
  }, [raw, ipFilter, potFilter]);

  // stats
  const uniqueIPs   = useMemo(() => new Set(list.map((e) => e.source_ip)).size, [list]);
  const topType     = useMemo(() => {
    const counts: Record<string, number> = {};
    list.forEach((e) => { counts[e.event_type] = (counts[e.event_type] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
  }, [list]);

  const hasFilters = typeFilter || ipFilter || potFilter;

  const clearFilters = useCallback(() => {
    setTypeFilter(""); setIpFilter(""); setPotFilter("");
  }, []);

  const [exportOpen, setExportOpen] = useState(false);

  // close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const handler = () => setExportOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [exportOpen]);

  const handleExportCSV = () => {
    if (!list.length) return;
    const hdr = ["Time","Node","Pot","Type","Source IP","Src Port","Dst Port"];
    const rows = list.map((e: any) =>
      [e.event_time, e.node_id, e.pot_id, e.event_type, e.source_ip, e.source_port, e.dest_port].join(",")
    );
    const blob = new Blob([[hdr.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `honeybee-events-${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click(); URL.revokeObjectURL(a.href);
    setExportOpen(false);
  };

  const handleExportExcel = () => {
    if (!list.length) return;
    // Build a simple XML-based Excel (SpreadsheetML) workbook
    const hdr = ["Time","Node","Pot","Type","Source IP","Src Port","Dst Port"];
    const escape = (v: any) => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
    const headerRow = hdr.map((h) => `<Cell><Data ss:Type="String">${escape(h)}</Data></Cell>`).join("");
    const dataRows = list.map((e: any) => {
      const cells = [e.event_time, e.node_id, e.pot_id, e.event_type, e.source_ip, e.source_port, e.dest_port]
        .map((v) => `<Cell><Data ss:Type="String">${escape(v)}</Data></Cell>`).join("");
      return `<Row>${cells}</Row>`;
    }).join("\n");
    const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Events">
  <Table>
   <Row>${headerRow}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>`;
    const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `honeybee-events-${new Date().toISOString().slice(0,10)}.xls`,
    });
    a.click(); URL.revokeObjectURL(a.href);
    setExportOpen(false);
  };

  const handleExportLog = () => {
    if (!list.length) return;
    const lines = list.map((e: any) =>
      `[${e.event_time}] type=${e.event_type} node=${e.node_id} pot=${e.pot_id} src=${e.source_ip}:${e.source_port ?? "-"} dst_port=${e.dest_port ?? "-"}`
    );
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(blob),
      download: `honeybee-events-${new Date().toISOString().slice(0,10)}.log`,
    });
    a.click(); URL.revokeObjectURL(a.href);
    setExportOpen(false);
  };

  return (
    <>
    <div className="space-y-6 animate-fade-up">

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <p className="page-label">Live feed</p>
          <h1 className="page-title" style={{ marginBottom: 2 }}>Events Explorer</h1>
          <p style={{ fontSize: 12, color: "#94A3B8", display: "flex", alignItems: "center", gap: 6 }}>
            {refreshInterval > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981", display: "inline-block",
                               boxShadow: "0 0 0 3px rgba(16,185,129,0.15)", animation: "pulse 2s infinite" }} />
                Live
              </span>
            )}
            {list.length.toLocaleString()} events
            {hasFilters && <span style={{ color: "#F59E0B", fontWeight: 600 }}> · filtered</span>}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* refresh interval */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "0 4px 0 12px", height: 36,
            background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10,
          }}>
            <Icon d={Icons.clock} size={13} color="#94A3B8" />
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              style={{ fontSize: 12, fontWeight: 600, color: "#475569", background: "transparent", border: "none", outline: "none", paddingRight: 20, cursor: "pointer" }}
            >
              <option value={0}>Manual</option>
              <option value={1000}>1 s</option>
              <option value={5000}>5 s</option>
              <option value={15000}>15 s</option>
              <option value={60000}>1 min</option>
            </select>
          </div>

          <button onClick={() => refetch()} disabled={isFetching}
            style={{
              height: 36, padding: "0 14px", borderRadius: 10, border: "1px solid #E2E8F0",
              background: "#fff", fontSize: 12, fontWeight: 700, color: isFetching ? "#94A3B8" : "#0F172A",
              cursor: isFetching ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6,
            }}>
            <span style={{ display: "inline-flex", animation: isFetching ? "spin 1s linear infinite" : "none" }}>
              <Icon d={Icons.restart} size={13} color={isFetching ? "#94A3B8" : "#D97706"} />
            </span>
            {isFetching ? "Loading…" : "Refresh"}
          </button>

          {/* Export dropdown */}
          <div style={{ position: "relative" }}>
            <button
              onClick={(e) => { e.stopPropagation(); setExportOpen((o) => !o); }}
              style={{
                height: 36, padding: "0 14px", borderRadius: 10, border: "1px solid #E2E8F0",
                background: "#fff", fontSize: 12, fontWeight: 700, color: "#475569",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              }}>
              <Icon d={Icons.arrowDown} size={13} color="#94A3B8" /> Export
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 2 }}>
                <path d="M2 4l3 3 3-3" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {exportOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 200,
                background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10,
                boxShadow: "0 8px 24px rgba(0,0,0,0.10)", minWidth: 150, overflow: "hidden",
              }}>
                {[
                  { label: "CSV (.csv)",   action: handleExportCSV   },
                  { label: "Excel (.xls)", action: handleExportExcel  },
                  { label: "Log (.log)",   action: handleExportLog    },
                ].map((item) => (
                  <button key={item.label} onClick={item.action}
                    style={{
                      display: "block", width: "100%", textAlign: "left",
                      padding: "10px 16px", fontSize: 13, fontWeight: 600,
                      color: "#334155", background: "transparent", border: "none",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#F8FAFC")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12 }}>
        <StatCard label="Total events"  value={list.length.toLocaleString()} icon={Icons.activity} color="#F59E0B" />
        <StatCard label="Unique IPs"    value={uniqueIPs}                     icon={Icons.globe}    color="#3B82F6" />
        <StatCard label="Top type"      value={topType}                       icon={Icons.bolt}     color="#8B5CF6" />
        <StatCard label="Active pots"   value={new Set(list.map((e: any) => e.pot_id)).size} icon={Icons.honeypot} color="#10B981" />
      </div>

      {/* ── Filters ── */}
      <div style={{
        background: "#fff", border: "1px solid #E2E8F0", borderRadius: 14,
        padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.03)",
      }}>
        {/* type pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em", marginRight: 4 }}>Type</span>
          <button
            onClick={() => setTypeFilter("")}
            style={{
              padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${!typeFilter ? "#F59E0B" : "#E2E8F0"}`,
              background: !typeFilter ? "#FFFBEB" : "#F8FAFC",
              color: !typeFilter ? "#B45309" : "#64748B",
            }}>All</button>
          {TYPE_PILLS.map((t) => {
            const m = typeMeta(t);
            const active = typeFilter === t;
            return (
              <button key={t} onClick={() => setTypeFilter(active ? "" : t)}
                style={{
                  padding: "4px 12px", borderRadius: 99, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${active ? m.border : "#E2E8F0"}`,
                  background: active ? m.bg : "#F8FAFC",
                  color: active ? m.fg : "#64748B",
                  transition: "all 0.12s",
                }}>{m.label}</button>
            );
          })}
        </div>

        {/* text filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 160px", maxWidth: 240 }}>
            <Icon d={Icons.globe} size={13} color="#CBD5E1" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input value={ipFilter} onChange={(e) => setIpFilter(e.target.value)}
              placeholder="Filter by source IP…"
              className="input w-full"
              style={{ fontSize: 12, padding: "8px 12px 8px 30px", borderRadius: 9 }} />
          </div>
          <div style={{ position: "relative", flex: "1 1 160px", maxWidth: 240 }}>
            <Icon d={Icons.honeycomb} size={13} color="#CBD5E1" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
            <input value={potFilter} onChange={(e) => setPotFilter(e.target.value)}
              placeholder="Filter by pot ID…"
              className="input w-full"
              style={{ fontSize: 12, padding: "8px 12px 8px 30px", borderRadius: 9 }} />
          </div>
          {hasFilters && (
            <button onClick={clearFilters}
              style={{
                padding: "7px 14px", borderRadius: 9, fontSize: 12, fontWeight: 600,
                background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              }}>
              <Icon d={Icons.close} size={11} color="#DC2626" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Event feed ── */}
      <div style={{
        background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16,
        overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      }}>
        {/* table toolbar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderBottom: "1px solid #F1F5F9",
          background: "linear-gradient(to bottom, #FAFAFA, #F8FAFC)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#10B981",
                          boxShadow: "0 0 0 2px rgba(16,185,129,0.2)" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>
              {list.length.toLocaleString()} events
            </span>
            {hasFilters && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "#F59E0B",
                             background: "#FFFBEB", border: "1px solid #FDE68A",
                             padding: "1px 7px", borderRadius: 99 }}>filtered</span>
            )}
          </div>
          <span style={{ fontSize: 11, color: "#94A3B8" }}>
            {list.length === 0 ? "0 events" : `Page ${page + 1} of ${Math.ceil(list.length / PAGE_SIZE)}`}
          </span>
        </div>

        {/* column header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "36px 150px 1fr 1fr 120px 170px 110px 36px",
          padding: "9px 20px",
          borderBottom: "2px solid #F1F5F9",
          background: "#F8FAFC",
          gap: 8,
          alignItems: "center",
        }}>
          {[
            { label: "#",         icon: "", center: true  },
            { label: "Time",      icon: Icons.clock      },
            { label: "Node",      icon: Icons.server     },
            { label: "Pot",       icon: Icons.honeypot   },
            { label: "Type",      icon: Icons.bolt       },
            { label: "Source IP", icon: Icons.globe      },
            { label: "Ports",     icon: Icons.signal     },
            { label: "",          icon: ""               },
          ].map(({ label, icon, center }, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", justifyContent: center ? "center" : undefined, gap: 5 }}>
              {icon && <Icon d={icon} size={11} color="#CBD5E1" />}
              <span style={{
                fontSize: 10.5, fontWeight: 700, color: "#94A3B8",
                textTransform: "uppercase", letterSpacing: "0.08em",
              }}>{label}</span>
            </div>
          ))}
        </div>

        {/* empty state */}
        {list.length === 0 && (
          <div style={{ padding: "64px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "#F8FAFC", display: "grid", placeItems: "center", border: "1px solid #E2E8F0" }}>
              <Icon d={Icons.activity} size={24} color="#CBD5E1" />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#94A3B8" }}>No events found</p>
            <p style={{ fontSize: 12, color: "#CBD5E1" }}>
              {hasFilters ? "Try adjusting your filters" : "Events will appear here as honeypots receive traffic"}
            </p>
            {hasFilters && (
              <button onClick={clearFilters}
                style={{ marginTop: 4, padding: "7px 18px", borderRadius: 9, fontSize: 12, fontWeight: 600,
                         background: "#FFFBEB", border: "1px solid #FDE68A", color: "#B45309", cursor: "pointer" }}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* rows */}
        {list.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((e: any, i: number) => {
          const pageLen = Math.min(PAGE_SIZE, list.length - page * PAGE_SIZE);
          const m = typeMeta(e.event_type);
          const isEven = i % 2 === 0;
          return (
            <div
              key={e.id}
              onClick={() => setSelectedEvent(e)}
              style={{
                display: "grid",
                gridTemplateColumns: "36px 150px 1fr 1fr 120px 170px 110px 36px",
                padding: "13px 20px",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                borderBottom: i < pageLen - 1 ? "1px solid #F8FAFC" : "none",
                borderLeft: `3px solid ${m.bar}`,
                background: isEven ? "#fff" : "#FDFEFF",
                transition: "background 0.12s, border-left-color 0.12s",
              }}
              onMouseEnter={(ev) => {
                ev.currentTarget.style.background = `${m.bg}`;
                ev.currentTarget.style.borderLeftColor = m.bar;
              }}
              onMouseLeave={(ev) => {
                ev.currentTarget.style.background = isEven ? "#fff" : "#FDFEFF";
                ev.currentTarget.style.borderLeftColor = m.bar;
              }}
            >
              {/* ── # ── */}
              <div style={{
                fontSize: 11, fontWeight: 700, color: "#CBD5E1",
                fontVariantNumeric: "tabular-nums", textAlign: "center",
              }}>
                {page * PAGE_SIZE + i + 1}
              </div>

              {/* ── Time ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: "#F8FAFC", border: "1px solid #E2E8F0",
                  display: "grid", placeItems: "center",
                }}>
                  <Icon d={Icons.clock} size={12} color="#94A3B8" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", fontVariantNumeric: "tabular-nums" }}>
                    {fmtRelative(e.event_time)}
                  </div>
                  <div style={{ fontSize: 10, color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>
                    {new Date(e.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </div>
                </div>
              </div>

              {/* ── Node ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: "#10B981", boxShadow: "0 0 0 2px rgba(16,185,129,0.18)",
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {nodeMap[e.node_id] ?? `Node #${e.node_id}`}
                  </div>
                  <div style={{ fontSize: 10, color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>
                    #{e.node_id}
                  </div>
                </div>
              </div>

              {/* ── Pot ── */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: "#F8FAFC", border: "1px solid #E2E8F0",
                borderRadius: 6, padding: "3px 8px", maxWidth: "100%",
              }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0, background: "#F59E0B" }} />
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.pot_id ?? "—"}
                </span>
              </div>

              {/* ── Type badge ── */}
              <div style={{ overflow: "hidden", minWidth: 0 }}>
                <TypeBadge type={e.event_type} />
              </div>

              {/* ── Source IP ── */}
              <div style={{ display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden" }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 7,
                  padding: "3px 8px", minWidth: 0, overflow: "hidden", maxWidth: "100%",
                }}>
                  <Icon d={Icons.globe} size={10} color="#FB923C" style={{ flexShrink: 0 }} />
                  <span style={{
                    fontSize: 11.5, fontFamily: "monospace", fontWeight: 600, color: "#9A3412",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
                  }}>
                    {e.source_ip ?? "—"}
                  </span>
                </div>
              </div>

              {/* ── Ports ── */}
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {e.source_port > 0 ? (
                  <>
                    <span style={{
                      fontSize: 11, fontFamily: "monospace", fontWeight: 600,
                      background: "#F1F5F9", color: "#475569",
                      padding: "2px 6px", borderRadius: 5, border: "1px solid #E2E8F0",
                    }}>{e.source_port}</span>
                    <Icon d={Icons.arrow} size={9} color="#CBD5E1" />
                    <span style={{
                      fontSize: 11, fontFamily: "monospace", fontWeight: 600,
                      background: "#F1F5F9", color: "#475569",
                      padding: "2px 6px", borderRadius: 5, border: "1px solid #E2E8F0",
                    }}>{e.dest_port}</span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: "#CBD5E1" }}>—</span>
                )}
              </div>

              {/* ── Chevron ── */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{
                  width: 24, height: 24, borderRadius: 6,
                  border: "1px solid #E2E8F0", background: "#F8FAFC",
                  display: "grid", placeItems: "center",
                }}>
                  <Icon d={Icons.arrow} size={11} color="#94A3B8" />
                </div>
              </div>
            </div>
          );
        })}

        {/* Pagination */}
        {list.length > PAGE_SIZE && (() => {
          const totalPages = Math.ceil(list.length / PAGE_SIZE);
          const btnStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
            minWidth: 32, height: 32, borderRadius: 8, fontSize: 12, fontWeight: active ? 700 : 500,
            border: active ? "1.5px solid #3B82F6" : "1px solid #E2E8F0",
            background: active ? "#EFF6FF" : disabled ? "#F8FAFC" : "#fff",
            color: active ? "#1D4ED8" : disabled ? "#CBD5E1" : "#475569",
            cursor: disabled ? "default" : "pointer",
            display: "grid", placeItems: "center", padding: "0 6px",
            transition: "all 0.12s",
          });
          // build page window: always show first, last, and ±1 around current
          const pages: (number | "...")[] = [];
          for (let p = 0; p < totalPages; p++) {
            if (p === 0 || p === totalPages - 1 || Math.abs(p - page) <= 1) {
              pages.push(p);
            } else if (pages[pages.length - 1] !== "...") {
              pages.push("...");
            }
          }
          return (
            <div style={{
              padding: "12px 20px", borderTop: "1px solid #F1F5F9",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              background: "linear-gradient(to bottom, #FAFAFA, #F8FAFC)",
            }}>
              <span style={{ fontSize: 11, color: "#94A3B8" }}>
                {list.length.toLocaleString()} events · page {page + 1} of {totalPages}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {/* Prev */}
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  style={btnStyle(false, page === 0)}
                  onMouseEnter={(ev) => { if (page !== 0) ev.currentTarget.style.background = "#F1F5F9"; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = page === 0 ? "#F8FAFC" : "#fff"; }}
                >
                  ‹
                </button>
                {/* Page numbers */}
                {pages.map((p, idx) =>
                  p === "..." ? (
                    <span key={`ellipsis-${idx}`} style={{ fontSize: 12, color: "#CBD5E1", padding: "0 2px" }}>…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p as number)}
                      style={btnStyle(p === page, false)}
                      onMouseEnter={(ev) => { if (p !== page) ev.currentTarget.style.background = "#F1F5F9"; }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.background = p === page ? "#EFF6FF" : "#fff"; }}
                    >
                      {(p as number) + 1}
                    </button>
                  )
                )}
                {/* Next */}
                <button
                  disabled={page === totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  style={btnStyle(false, page === totalPages - 1)}
                  onMouseEnter={(ev) => { if (page !== totalPages - 1) ev.currentTarget.style.background = "#F1F5F9"; }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = page === totalPages - 1 ? "#F8FAFC" : "#fff"; }}
                >
                  ›
                </button>
              </div>
            </div>
          );
        })()}
      </div>

    </div>
    {selectedEvent && createPortal(
      <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />,
      document.body
    )}
    </>
  );
}

// ── Event detail modal ────────────────────────────────────────────────────────
function EventDetailModal({ event: ev, onClose }: { event: any; onClose: () => void }) {
  const m = typeMeta(ev.event_type);
  const [copied, setCopied] = useState(false);

  const rawJson = useMemo(() => {
    if (!ev.data) return null;
    try {
      return JSON.stringify(typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data, null, 2);
    } catch {
      return String(ev.data);
    }
  }, [ev.data]);

  const copyJson = () => {
    if (!rawJson) return;
    navigator.clipboard.writeText(rawJson).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    /* backdrop — click outside to close */
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(15,23,42,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
      }}
    >
      {/* card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 600,
          maxHeight: "calc(100vh - 48px)",
          background: "#fff", borderRadius: 18,
          boxShadow: "0 8px 48px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.05)",
          display: "flex", flexDirection: "column", overflow: "hidden",
          animation: "slideUp 0.22s ease-out",
        }}
      >
        {/* type-coloured top stripe */}
        <div style={{ height: 4, flexShrink: 0, background: `linear-gradient(90deg, ${m.bar} 0%, ${m.bar}66 100%)` }} />

        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 22px", borderBottom: "1px solid #F1F5F9",
          background: "#FAFAFA", flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 11, flexShrink: 0,
              background: m.bg, border: `1px solid ${m.border}`,
              display: "grid", placeItems: "center",
            }}>
              <Icon d={Icons.activity} size={19} color={m.fg} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#0F172A" }}>Event Details</span>
                <TypeBadge type={ev.event_type} />
              </div>
              <span style={{ fontSize: 11.5, color: "#94A3B8" }}>{fmtTime(ev.event_time)}</span>
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 34, height: 34, borderRadius: 9, border: "1px solid #E2E8F0", flexShrink: 0,
            background: "#fff", display: "grid", placeItems: "center", cursor: "pointer", marginLeft: 12,
            transition: "background 0.12s",
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#F1F5F9")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
          >
            <Icon d={Icons.close} size={15} color="#64748B" />
          </button>
        </div>

        {/* scrollable body */}
        <div style={{ overflowY: "auto", padding: "22px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* identity grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 28px" }}>
            <Field label="Event ID"      value={ev.id}            mono />
            <Field label="Node"          value={ev.node_id} />
            <Field label="Pot ID"        value={ev.pot_id}        mono />
            <Field label="Honeypot Type" value={ev.honeypot_type} />
          </div>

          {/* divider */}
          <div style={{ height: 1, background: "#F1F5F9" }} />

          {/* network card */}
          <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: "#C2410C",
              textTransform: "uppercase", letterSpacing: "0.07em",
              marginBottom: 12, display: "flex", alignItems: "center", gap: 6,
            }}>
              <Icon d={Icons.globe} size={13} color="#C2410C" /> Network Context
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 28px" }}>
              <Field label="Source IP"        value={ev.source_ip}      mono accent />
              <Field label="Destination IP"   value={ev.dest_ip || "—"} mono />
              <Field label="Source Port"      value={ev.source_port}    mono />
              <Field label="Destination Port" value={ev.dest_port}      mono />
            </div>
          </div>

          {/* raw telemetry */}
          {rawJson && (
            <div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10,
              }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Raw Telemetry
                </span>
                <button onClick={copyJson} style={{
                  padding: "5px 11px", borderRadius: 7, border: "1px solid #E2E8F0",
                  background: copied ? "#ECFDF5" : "#F8FAFC", fontSize: 11.5, fontWeight: 600,
                  color: copied ? "#065F46" : "#64748B", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 5, transition: "all 0.15s",
                }}>
                  <Icon d={copied ? Icons.check : Icons.copy} size={12} color={copied ? "#10B981" : "#94A3B8"} />
                  {copied ? "Copied!" : "Copy JSON"}
                </button>
              </div>
              <pre style={{
                background: "#0F172A", color: "#94A3B8",
                borderRadius: 10, padding: "14px 16px", margin: 0,
                fontSize: 11.5, fontFamily: "monospace", lineHeight: 1.7,
                overflowX: "auto", maxHeight: 240,
              }}>
                <span style={{ color: "#E2E8F0" }}>{rawJson}</span>
              </pre>
            </div>
          )}

          {/* bottom padding so content isn't flush against edge */}
          <div style={{ height: 4 }} />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono, accent }: { label: string; value: any; mono?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</span>
      <span style={{
        fontSize: 13, fontFamily: mono ? "monospace" : undefined,
        fontWeight: mono ? 600 : 500,
        color: accent ? "#9A3412" : "#0F172A",
        wordBreak: "break-all",
      }}>{value ?? "—"}</span>
    </div>
  );
}

