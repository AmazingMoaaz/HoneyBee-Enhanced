import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

const STALE = ["failed", "pending", "stopped"];

const DEP_STATUS: Record<string, string> = {
  running: "badge-running",
  failed:  "badge-failed",
  pending: "badge-pending",
  stopped: "badge-stopped",
  removed: "badge-removed",
};

export default function DeploymentsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["deployments"],
    queryFn: async () => (await api.get("/deployments")).data,
    refetchInterval: 5000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/deployments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }),
  });
  const cleanupMut = useMutation({
    mutationFn: () => api.post("/deployments/cleanup"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["deployments"] }),
  });

  const list: any[]  = data ?? [];
  const staleCount   = list.filter((d) => STALE.includes(d.status)).length;

  return (
    <div className="space-y-6 animate-fade-up">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="page-label">Honeypot fleet</p>
          <h1 className="page-title">Deployments</h1>
          <p className="text-xs mt-1" style={{ color: "rgba(54,33,12,0.45)" }}>{list.length} total · {staleCount} stale</p>
        </div>
        {staleCount > 0 && (
          <button className="btn btn-danger" disabled={cleanupMut.isPending}
                  onClick={() => { if (confirm(`Delete all ${staleCount} failed / pending / stopped records?`)) cleanupMut.mutate(); }}>
            {cleanupMut.isPending ? "Cleaning…" : `Clean up ${staleCount} stale`}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">ID</th>
              <th className="th">Node</th>
              <th className="th">Pot ID</th>
              <th className="th">Type</th>
              <th className="th">Status</th>
              <th className="th-r"></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr className="tr">
                <td className="td" colSpan={6} style={{ textAlign: "center", color: "rgba(54,33,12,0.35)" }}>No deployments yet</td>
              </tr>
            )}
            {list.map((d: any) => (
              <tr key={d.id} className="tr">
                <td className="td font-mono" style={{ fontSize: 12 }}>#{d.id}</td>
                <td className="td">{d.node_id}</td>
                <td className="td font-mono" style={{ fontSize: 12 }}>{d.pot_id}</td>
                <td className="td">{d.honeypot_type}</td>
                <td className="td"><span className={`badge ${DEP_STATUS[d.status] ?? "badge-stopped"}`}>{d.status}</span></td>
                <td className="td" style={{ textAlign: "right" }}>
                  {STALE.includes(d.status) && (
                    <button className="btn btn-danger btn-xs" disabled={deleteMut.isPending}
                            onClick={() => { if (confirm(`Delete deployment #${d.id}?`)) deleteMut.mutate(d.id); }}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
