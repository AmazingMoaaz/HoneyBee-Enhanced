import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useState } from "react";

const SEV_COLORS: Record<string, { bg: string; fg: string }> = {
  critical: { bg: "#FEE2E2", fg: "#991B1B" },
  high:     { bg: "#FEF3C7", fg: "#92400E" },
  medium:   { bg: "#DBEAFE", fg: "#1E40AF" },
  low:      { bg: "#F1F5F9", fg: "#475569" },
  info:     { bg: "#ECFDF5", fg: "#065F46" },
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AlertsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"alerts" | "rules">("alerts");

  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => (await api.get("/alerts?limit=100")).data,
    refetchInterval: 10000,
  });
  const { data: rules } = useQuery({
    queryKey: ["alert-rules"],
    queryFn: async () => (await api.get("/alert-rules")).data,
  });

  const ackMut = useMutation({
    mutationFn: (id: number) => api.post(`/alerts/${id}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => api.delete(`/alerts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const list: any[] = alerts ?? [];
  const ruleList: any[] = rules ?? [];
  const unacked = list.filter((a: any) => !a.acknowledged).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="page-label">Security</p>
          <h1 className="page-title">Alerts</h1>
        </div>
        {unacked > 0 && (
          <div className="flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-semibold"
               style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B" }}>
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {unacked} unacknowledged
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: "#F1F5F9", width: "fit-content" }}>
        <button onClick={() => setTab("alerts")}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition ${tab === "alerts" ? "bg-white shadow-sm text-amber-700" : "text-slate-500"}`}>
          Alerts ({list.length})
        </button>
        <button onClick={() => setTab("rules")}
                className={`px-4 py-1.5 rounded-md text-xs font-semibold transition ${tab === "rules" ? "bg-white shadow-sm text-amber-700" : "text-slate-500"}`}>
          Rules ({ruleList.length})
        </button>
      </div>

      {tab === "alerts" && (
        <div className="space-y-3">
          {list.length === 0 && (
            <div className="card p-8 text-center" style={{ color: "#94A3B8" }}>
              <p className="text-sm">No alerts yet — your honeypots are quiet 🍯</p>
            </div>
          )}
          {list.map((a: any) => {
            const sev = SEV_COLORS[a.severity] ?? SEV_COLORS.medium;
            return (
              <div key={a.id} className="card p-4 flex items-start gap-4" style={{ opacity: a.acknowledged ? 0.6 : 1 }}>
                <div className="px-2.5 py-1 rounded-md text-xs font-bold uppercase" style={{ background: sev.bg, color: sev.fg, whiteSpace: "nowrap" }}>
                  {a.severity}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "#0F172A" }}>{a.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: "#64748B" }}>{a.message}</p>
                  <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: "#94A3B8" }}>
                    <span>{fmtTime(a.created_at)}</span>
                    {a.source && <span>Source: {a.source}</span>}
                    {a.source_ref && <span className="font-mono">{a.source_ref}</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {!a.acknowledged && (
                    <button onClick={() => ackMut.mutate(a.id)}
                            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                            style={{ background: "#F0FDF4", color: "#15803D", border: "1px solid #86EFAC" }}>
                      Acknowledge
                    </button>
                  )}
                  <button onClick={() => delMut.mutate(a.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                          style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA" }}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "rules" && (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Event Type</th>
                <th className="th">Severity</th>
                <th className="th">Status</th>
                <th className="th">Cooldown</th>
                <th className="th">Last Fired</th>
              </tr>
            </thead>
            <tbody>
              {ruleList.length === 0 && (
                <tr className="tr"><td className="td" colSpan={6} style={{ textAlign: "center", color: "#94A3B8" }}>No alert rules configured</td></tr>
              )}
              {ruleList.map((r: any) => {
                const sev = SEV_COLORS[r.severity] ?? SEV_COLORS.medium;
                return (
                  <tr key={r.id} className="tr">
                    <td className="td font-semibold">{r.name}</td>
                    <td className="td font-mono" style={{ fontSize: 12 }}>{r.event_type || "any"}</td>
                    <td className="td"><span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: sev.bg, color: sev.fg }}>{r.severity}</span></td>
                    <td className="td"><span className={`badge ${r.enabled ? "badge-online" : "badge-stopped"}`}>{r.enabled ? "Active" : "Disabled"}</span></td>
                    <td className="td font-mono" style={{ fontSize: 12 }}>{r.cooldown_secs}s</td>
                    <td className="td" style={{ fontSize: 12, color: "#94A3B8" }}>{r.last_fired ? fmtTime(r.last_fired) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
