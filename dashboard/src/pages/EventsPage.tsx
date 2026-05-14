import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { useState } from "react";

const TYPE_BADGE: Record<string, string> = {
  login:       "badge-warning",
  "ssh.login": "badge-warning",
  command:     "badge-honey",
  connect:     "badge-stopped",
  error:       "badge-failed",
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function EventsPage() {
  const [filters, setFilters] = useState({ event_type: "", source_ip: "", pot_id: "" });
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  const queryStr = Object.entries(filters)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

  const { data } = useQuery({
    queryKey: ["events", queryStr],
    queryFn: async () => (await api.get(`/events?limit=200${queryStr ? "&" + queryStr : ""}`)).data,
    refetchInterval: 5000,
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

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-label">Live feed</p>
          <h1 className="page-title">Events</h1>
          <p className="text-xs mt-1" style={{ color: "rgba(54,33,12,0.45)" }}>Last {list.length} events · refreshes every 5 s</p>
        </div>
        <button onClick={handleExportCSV}
                className="px-4 py-2 rounded-lg text-xs font-semibold transition"
                style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", color: "#475569" }}>
          ⬇ Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={filters.event_type} onChange={e => setFilters(f => ({ ...f, event_type: e.target.value }))}
               placeholder="Filter by type..." className="input" style={{ maxWidth: 180, fontSize: 12, padding: "6px 12px" }} />
        <input value={filters.source_ip} onChange={e => setFilters(f => ({ ...f, source_ip: e.target.value }))}
               placeholder="Filter by IP..." className="input" style={{ maxWidth: 180, fontSize: 12, padding: "6px 12px" }} />
        <input value={filters.pot_id} onChange={e => setFilters(f => ({ ...f, pot_id: e.target.value }))}
               placeholder="Filter by pot..." className="input" style={{ maxWidth: 180, fontSize: 12, padding: "6px 12px" }} />
        {Object.values(filters).some(v => v) && (
          <button onClick={() => setFilters({ event_type: "", source_ip: "", pot_id: "" })}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                  style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA" }}>
            Clear
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Time</th>
              <th className="th">Node</th>
              <th className="th">Pot</th>
              <th className="th">Type</th>
              <th className="th">Source IP</th>
              <th className="th">Ports</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr className="tr"><td className="td" colSpan={7} style={{ textAlign: "center", color: "rgba(54,33,12,0.35)" }}>No events yet — waiting for activity…</td></tr>
            )}
            {list.map((e: any) => (
              <tr key={e.id} className="tr" style={{ cursor: "pointer" }} onClick={() => setSelectedEvent(e)}>
                <td className="td font-mono" style={{ fontSize: 12, color: "rgba(54,33,12,0.5)" }}>{fmtTime(e.event_time)}</td>
                <td className="td">{e.node_id}</td>
                <td className="td font-mono" style={{ fontSize: 12 }}>{e.pot_id}</td>
                <td className="td"><span className={`badge ${TYPE_BADGE[e.event_type] ?? "badge-stopped"}`}>{e.event_type}</span></td>
                <td className="td font-mono" style={{ fontSize: 12, color: "#A06B04" }}>{e.source_ip}</td>
                <td className="td font-mono" style={{ fontSize: 11, color: "#94A3B8" }}>
                  {e.source_port > 0 ? `${e.source_port} → ${e.dest_port}` : "—"}
                </td>
                <td className="td" style={{ fontSize: 11, color: "#94A3B8" }}>▸</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setSelectedEvent(null)}>
          <div className="card p-6" style={{ maxWidth: 560, width: "90%", maxHeight: "80vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold" style={{ color: "#0F172A" }}>Event Detail</h2>
              <button onClick={() => setSelectedEvent(null)} className="text-slate-400 hover:text-slate-600 text-xl">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <Row label="Event ID" value={selectedEvent.id} />
              <Row label="Time" value={fmtTime(selectedEvent.event_time)} />
              <Row label="Type" value={<span className={`badge ${TYPE_BADGE[selectedEvent.event_type] ?? "badge-stopped"}`}>{selectedEvent.event_type}</span>} />
              <Row label="Node ID" value={selectedEvent.node_id} />
              <Row label="Pot ID" value={selectedEvent.pot_id} />
              <Row label="Honeypot Type" value={selectedEvent.honeypot_type} />
              <Row label="Source IP" value={selectedEvent.source_ip} mono />
              <Row label="Source Port" value={selectedEvent.source_port} />
              <Row label="Dest Port" value={selectedEvent.dest_port} />
              {selectedEvent.data && (
                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: "#64748B" }}>Raw Data</p>
                  <pre className="p-3 rounded-lg text-xs font-mono overflow-auto" style={{ background: "#F8FAFC", maxHeight: 200, color: "#334155" }}>
                    {typeof selectedEvent.data === "string"
                      ? JSON.stringify(JSON.parse(selectedEvent.data), null, 2)
                      : JSON.stringify(selectedEvent.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-semibold" style={{ color: "#64748B", minWidth: 100 }}>{label}</span>
      <span className={`text-sm ${mono ? "font-mono" : ""}`} style={{ color: "#0F172A" }}>{value ?? "—"}</span>
    </div>
  );
}
