import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";

const STALE_STATUSES = ["failed", "pending", "stopped"];
const STATUS_COLOR: Record<string, string> = {
  running: "text-green-400",
  failed:  "text-red-400",
  pending: "text-yellow-400",
  stopped: "text-slate-400",
  removed: "text-slate-500",
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

  const staleCount = (data ?? []).filter((d: any) =>
    STALE_STATUSES.includes(d.status)
  ).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Deployments</h2>
        {staleCount > 0 && (
          <button
            onClick={() => {
              if (confirm(`Delete all ${staleCount} failed / pending / stopped records from the database?`))
                cleanupMut.mutate();
            }}
            disabled={cleanupMut.isPending}
            className="px-3 py-1.5 text-sm bg-red-700 hover:bg-red-600 rounded disabled:opacity-50"
          >
            {cleanupMut.isPending ? "Cleaning…" : `Clean up ${staleCount} stale`}
          </button>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-400 border-b border-slate-800">
          <tr>
            <th className="py-2 pr-3">ID</th>
            <th className="pr-3">Node</th>
            <th className="pr-3">Pot</th>
            <th className="pr-3">Type</th>
            <th className="pr-3">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((d: any) => (
            <tr key={d.id} className="border-b border-slate-900 hover:bg-slate-900/40">
              <td className="py-2 pr-3 font-mono">{d.id}</td>
              <td className="pr-3">{d.node_id}</td>
              <td className="pr-3 font-mono text-xs break-all">{d.pot_id}</td>
              <td className="pr-3">{d.honeypot_type}</td>
              <td className={`pr-3 font-semibold ${STATUS_COLOR[d.status] ?? ""}`}>{d.status}</td>
              <td className="text-right">
                {STALE_STATUSES.includes(d.status) && (
                  <button
                    onClick={() => {
                      if (confirm(`Delete deployment #${d.id} from the database?`))
                        deleteMut.mutate(d.id);
                    }}
                    disabled={deleteMut.isPending}
                    className="px-2 py-0.5 text-xs bg-slate-700 hover:bg-red-700 rounded disabled:opacity-50"
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

