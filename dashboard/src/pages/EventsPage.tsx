import { useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useState } from "react";
import { Icon, Icons } from "../components/Icons";

const TYPE_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  login:       { bg: "rgba(245,158,11,0.1)", color: "#B45309", border: "rgba(245,158,11,0.3)" },
  "ssh.login": { bg: "rgba(245,158,11,0.1)", color: "#B45309", border: "rgba(245,158,11,0.3)" },
  command:     { bg: "rgba(16,185,129,0.1)", color: "#059669", border: "rgba(16,185,129,0.3)" },
  connect:     { bg: "rgba(59,130,246,0.1)", color: "#1D4ED8", border: "rgba(59,130,246,0.3)" },
  error:       { bg: "rgba(239,68,68,0.1)",  color: "#DC2626", border: "rgba(239,68,68,0.3)" },
};

function EventBadge({ type }: { type: string }) {
  const s = TYPE_STYLE[type] ?? { bg: "rgba(100,116,139,0.1)", color: "#64748B", border: "rgba(100,116,139,0.2)" };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 99, 
      fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.color, border: `1px solid ${s.border}`
    }}>
      {type}
    </span>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function EventsPage() {
  const qc = useQueryClient();
  const [filters, setFilters] = useState({ event_type: "", source_ip: "", pot_id: "" });
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  const queryStr = Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["events", queryStr],
    queryFn: async () => (await api.get(`/events?limit=200${queryStr ? "&" + queryStr : ""}`)).data,
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    refetchOnWindowFocus: refreshInterval > 0,
  });
  const list: any[] = data ?? [];

  const handleExportCSV = () => {
    if (list.length === 0) return;
    const headers = ["Time", "Node", "Pot", "Type", "Source IP", "Source Port", "Dest Port"];
    const rows = list.map((e: any) => [
      e.event_time, e.node_id, e.pot_id, e.event_type, e.source_ip, e.source_port, e.dest_port,
    ]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `honeybee-events-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasFilters = Object.values(filters).some(v => v !== "");

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(245,158,11,0.1)", display: "grid", placeItems: "center", border: "1px solid rgba(245,158,11,0.2)" }}>
              <Icon d={Icons.activity} size={16} color="#D97706" />
            </div>
            <p className="page-label" style={{ margin: 0 }}>Live feed</p>
          </div>
          <h1 className="page-title">Events Explorer</h1>
          <p className="text-xs mt-1" style={{ color: "rgba(54,33,12,0.45)" }}>
            Showing {list.length} recent events
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div style={{
            display: "inline-flex", alignItems: "center", padding: 4,
            background: "#F8FAFC", border: "1px solid #E2E8F0",
            borderRadius: 12, gap: 4, boxShadow: "inset 0 1px 2px rgba(0,0,0,0.02)"
          }}>
            <div className="flex items-center gap-2 pl-3">
              <Icon d={Icons.clock} size={14} color="#94A3B8" />
              <select
                className="input"
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                style={{ 
                  padding: "6px 26px 6px 4px", fontSize: 12.5, minWidth: 130, height: 30, 
                  background: "transparent", border: "none", boxShadow: "none", color: "#475569", fontWeight: 600
                }}
              >
                <option value={0}>Manual Refresh</option>
                <option value={1000}>Every 1 second</option>
                <option value={5000}>Every 5 seconds</option>
                <option value={15000}>Every 15 seconds</option>
                <option value={60000}>Every 1 minute</option>
              </select>
            </div>
            
            <div style={{ width: 1, height: 16, background: "#CBD5E1", margin: "0 2px" }} />
            
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh events"
              style={{
                padding: "0 14px", height: 30, borderRadius: 8, fontSize: 12.5, fontWeight: 700,
                background: "#FFFFFF", border: "1px solid #E2E8F0",
                color: isFetching ? "#94A3B8" : "#0F172A", cursor: isFetching ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: 6, boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ animation: isFetching ? "spin 1s linear infinite" : "none", display: "inline-flex" }}>
                <Icon d={Icons.restart} size={13} color={isFetching ? "#94A3B8" : "#B45309"} />
              </span>
              {isFetching ? "..." : "Refresh"}
            </button>
          </div>

          <button onClick={handleExportCSV}
                  className="px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm hover:shadow"
                  style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#0F172A" }}>
            <Icon d={Icons.arrowDown} size={14} color="#64748B" /> Export CSV
          </button>
        </div>
      </div>

      <div className="card p-4 flex gap-3 flex-wrap items-center bg-white border border-slate-200/60 shadow-sm rounded-xl">
        <div className="flex items-center gap-2 px-1 border-r border-slate-100 pr-4">
          <Icon d={Icons.filter} size={16} color="#94A3B8" />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Filters</span>
        </div>
        
        <div className="relative flex-1 min-w-[140px] max-w-[200px]">
          <Icon d={Icons.search} size={14} color="#94A3B8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input value={filters.event_type} onChange={e => setFilters(f => ({ ...f, event_type: e.target.value }))}
                 placeholder="Type (e.g. login)" className="input w-full" style={{ fontSize: 12, padding: "8px 12px 8px 30px", borderRadius: 8 }} />
        </div>
        <div className="relative flex-1 min-w-[140px] max-w-[200px]">
          <Icon d={Icons.globe} size={14} color="#94A3B8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input value={filters.source_ip} onChange={e => setFilters(f => ({ ...f, source_ip: e.target.value }))}
                 placeholder="Source IP" className="input w-full" style={{ fontSize: 12, padding: "8px 12px 8px 30px", borderRadius: 8 }} />
        </div>
        <div className="relative flex-1 min-w-[140px] max-w-[200px]">
          <Icon d={Icons.honeycomb} size={14} color="#94A3B8" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
          <input value={filters.pot_id} onChange={e => setFilters(f => ({ ...f, pot_id: e.target.value }))}
                 placeholder="Pot ID" className="input w-full" style={{ fontSize: 12, padding: "8px 12px 8px 30px", borderRadius: 8 }} />
        </div>
        
        {hasFilters && (
          <button onClick={() => setFilters({ event_type: "", source_ip: "", pot_id: "" })}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors hover:bg-red-100"
                  style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA" }}>
            <Icon d={Icons.close} size={12} color="#DC2626" /> Clear All
          </button>
        )}
      </div>

      <div className="card p-0 overflow-hidden border border-slate-200/60 shadow-sm rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0" }}>
              <tr>
                <th className="th" style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>Time</th>
                <th className="th" style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>Node</th>
                <th className="th" style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>Pot ID</th>
                <th className="th" style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>Type</th>
                <th className="th" style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>Source IP</th>
                <th className="th" style={{ padding: "12px 16px", fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em" }}>Ports</th>
                <th className="th" style={{ padding: "12px 16px", width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: "40px 16px", textAlign: "center", color: "#94A3B8" }}>
                    <div className="flex flex-col items-center justify-center gap-3">
                      <Icon d={Icons.search} size={32} color="#CBD5E1" />
                      <p className="text-sm font-medium">No events found matching your criteria</p>
                    </div>
                  </td>
                </tr>
              )}
              {list.map((e: any, i: number) => (
                <tr key={e.id} className="group transition-colors hover:bg-slate-50 cursor-pointer" onClick={() => setSelectedEvent(e)} style={{ borderBottom: i === list.length - 1 ? "none" : "1px solid #F1F5F9" }}>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: "#475569", fontWeight: 500 }}>{fmtTime(e.event_time)}</td>
                  <td style={{ padding: "12px 16px", fontSize: 13, color: "#0F172A", fontWeight: 600 }}>{e.node_id}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <div className="flex items-center gap-2">
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#F59E0B" }} />
                      <span className="font-mono text-xs text-slate-600">{e.pot_id}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}><EventBadge type={e.event_type} /></td>
                  <td style={{ padding: "12px 16px" }}>
                    <span className="font-mono text-xs px-2 py-1 rounded bg-orange-50 text-orange-700 border border-orange-100">{e.source_ip}</span>
                  </td>
                  <td style={{ padding: "12px 16px", fontSize: 12, color: "#64748B" }}>
                    {e.source_port > 0 ? (
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono">{e.source_port}</span>
                        <Icon d={Icons.arrow} size={10} color="#94A3B8" />
                        <span className="font-mono">{e.dest_port}</span>
                      </div>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "12px 16px", color: "#CBD5E1" }} className="group-hover:text-amber-500 transition-colors">
                    <Icon d={Icons.arrow} size={16} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in" style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)" }} onClick={() => setSelectedEvent(null)}>
          <div className="card p-0 overflow-hidden w-full max-w-2xl animate-fade-up shadow-2xl border border-slate-200/50" style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
            <div style={{ height: 4, background: "linear-gradient(90deg, #FCD34D, #F59E0B, #D97706)" }} />
            <div style={{ padding: "18px 24px", borderBottom: "1px solid rgba(15,23,42,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#F8FAFC" }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.1)", display: "grid", placeItems: "center", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <Icon d={Icons.activity} size={18} color="#D97706" />
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-slate-900 leading-tight">Event Details</h2>
                  <p className="text-xs font-semibold text-slate-500">{fmtTime(selectedEvent.event_time)}</p>
                </div>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <Icon d={Icons.close} size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 bg-white">
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                <DetailRow icon={Icons.hash} label="Event ID" value={selectedEvent.id} mono />
                <DetailRow icon={Icons.activity} label="Type" value={<EventBadge type={selectedEvent.event_type} />} />
                <DetailRow icon={Icons.server} label="Node ID" value={selectedEvent.node_id} />
                <DetailRow icon={Icons.honeycomb} label="Pot ID" value={selectedEvent.pot_id} mono />
                <DetailRow icon={Icons.honeypot} label="Honeypot Type" value={selectedEvent.honeypot_type} />
              </div>

              <div className="p-4 rounded-xl border border-orange-100 bg-orange-50/50 space-y-3">
                <h3 className="text-xs font-bold text-orange-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                  <Icon d={Icons.globe} size={14} color="#C2410C" /> Network Context
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <DetailRow label="Source IP" value={selectedEvent.source_ip} mono color="#9A3412" />
                  <DetailRow label="Destination IP" value={selectedEvent.dest_ip || "—"} mono />
                  <DetailRow label="Source Port" value={selectedEvent.source_port} mono />
                  <DetailRow label="Destination Port" value={selectedEvent.dest_port} mono />
                </div>
              </div>

              {selectedEvent.data && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon d={Icons.server} size={14} color="#64748B" />
                    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Raw Telemetry Data</h3>
                  </div>
                  <div className="relative">
                    <pre className="p-4 rounded-xl text-xs font-mono overflow-auto border border-slate-200" style={{ background: "#0F172A", color: "#E2E8F0", maxHeight: 280, lineHeight: 1.5 }}>
                      {typeof selectedEvent.data === "string"
                        ? JSON.stringify(JSON.parse(selectedEvent.data), null, 2)
                        : JSON.stringify(selectedEvent.data, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ icon, label, value, mono, color }: { icon?: string; label: string; value: any; mono?: boolean; color?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
        {icon && <Icon d={icon} size={12} color="currentColor" />}
        {label}
      </span>
      <span className={`text-sm ${mono ? "font-mono" : "font-medium"}`} style={{ color: color || "#0F172A", wordBreak: "break-all" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

