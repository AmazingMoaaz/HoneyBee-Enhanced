import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import { useWebSocket } from "../hooks/useWebSocket";

interface Stats {
  total_events: number;
  unique_ips: number;
  by_type: { event_type: string; count: number }[];
  by_ip: { source_ip: string; count: number }[];
}

function StatCard({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="text-slate-400 text-sm">{label}</div>
      <div className="text-3xl text-honey-400 font-bold mt-1">{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats } = useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => (await api.get("/events/stats")).data,
    refetchInterval: 10000,
  });
  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    refetchInterval: 10000,
  });
  const { connected, lastMessage } = useWebSocket(["events", "nodes"]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <span className={`text-xs px-2 py-1 rounded ${connected ? "bg-emerald-700" : "bg-slate-700"}`}>
          WS {connected ? "live" : "off"}
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Nodes" value={nodes?.length ?? "-"} />
        <StatCard label="Online" value={nodes?.filter((n: any) => n.online).length ?? "-"} />
        <StatCard label="Events" value={stats?.total_events ?? "-"} />
        <StatCard label="Unique IPs" value={stats?.unique_ips ?? "-"} />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="font-semibold mb-2">Top Event Types</h3>
          <ul className="text-sm space-y-1">
            {stats?.by_type?.map((r) => (
              <li key={r.event_type} className="flex justify-between">
                <span>{r.event_type}</span><span className="text-honey-400">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
          <h3 className="font-semibold mb-2">Top Attacker IPs</h3>
          <ul className="text-sm space-y-1">
            {stats?.by_ip?.map((r) => (
              <li key={r.source_ip} className="flex justify-between">
                <span className="font-mono">{r.source_ip}</span><span className="text-honey-400">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {lastMessage && (
        <div className="text-xs text-slate-500">last ws msg: {lastMessage.type} ({lastMessage.topic ?? "—"})</div>
      )}
    </div>
  );
}
