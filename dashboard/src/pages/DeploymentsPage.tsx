import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

export default function DeploymentsPage() {
  const { data } = useQuery({
    queryKey: ["deployments"],
    queryFn: async () => (await api.get("/deployments")).data,
    refetchInterval: 5000,
  });
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Deployments</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-400 border-b border-slate-800">
          <tr><th className="py-2">ID</th><th>Node</th><th>Pot</th><th>Type</th><th>Status</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((d: any) => (
            <tr key={d.id} className="border-b border-slate-900">
              <td className="py-2 font-mono">{d.id}</td>
              <td>{d.node_id}</td>
              <td>{d.pot_id}</td>
              <td>{d.honeypot_type}</td>
              <td>{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
