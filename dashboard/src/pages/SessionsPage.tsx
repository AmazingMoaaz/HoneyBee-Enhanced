import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../api/client";

export default function SessionsPage() {
  const { data } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => (await api.get("/sessions?limit=200")).data,
    refetchInterval: 5000,
  });
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Sessions</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-400 border-b border-slate-800">
          <tr><th className="py-2">ID</th><th>Pot</th><th>Source</th><th>Started</th><th></th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((s: any) => (
            <tr key={s.id} className="border-b border-slate-900">
              <td className="py-2 font-mono">{s.id}</td>
              <td>{s.pot_id}</td>
              <td className="font-mono">{s.src_ip}:{s.src_port}</td>
              <td>{s.started_at}</td>
              <td>
                <Link className="text-honey-400 hover:underline" to={`/sessions/${s.id}/replay`}>
                  replay
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
