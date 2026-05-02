import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

export default function EventsPage() {
  const { data } = useQuery({
    queryKey: ["events"],
    queryFn: async () => (await api.get("/events?limit=200")).data,
    refetchInterval: 5000,
  });
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Events</h2>
      <table className="w-full text-xs">
        <thead className="text-left text-slate-400 border-b border-slate-800">
          <tr>
            <th className="py-2">Time</th><th>Node</th><th>Pot</th><th>Type</th><th>Source IP</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((e: any) => (
            <tr key={e.id} className="border-b border-slate-900">
              <td className="py-1">{e.event_time}</td>
              <td>{e.node_id}</td>
              <td>{e.pot_id}</td>
              <td>{e.event_type}</td>
              <td className="font-mono">{e.source_ip}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
