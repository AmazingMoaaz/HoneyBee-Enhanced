import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

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
  const { data } = useQuery({
    queryKey: ["events"],
    queryFn: async () => (await api.get("/events?limit=200")).data,
    refetchInterval: 5000,
  });
  const list: any[] = data ?? [];

  return (
    <div className="space-y-6 animate-fade-up">
      <div className="flex items-center justify-between">
        <div>
          <p className="page-label">Live feed</p>
          <h1 className="page-title">Events</h1>
          <p className="text-xs mt-1" style={{ color: "rgba(54,33,12,0.45)" }}>Last {list.length} events · refreshes every 5 s</p>
        </div>
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
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr className="tr"><td className="td" colSpan={5} style={{ textAlign: "center", color: "rgba(54,33,12,0.35)" }}>No events yet — waiting for activity…</td></tr>
            )}
            {list.map((e: any) => (
              <tr key={e.id} className="tr">
                <td className="td font-mono" style={{ fontSize: 12, color: "rgba(54,33,12,0.5)" }}>{fmtTime(e.event_time)}</td>
                <td className="td">{e.node_id}</td>
                <td className="td font-mono" style={{ fontSize: 12 }}>{e.pot_id}</td>
                <td className="td"><span className={`badge ${TYPE_BADGE[e.event_type] ?? "badge-stopped"}`}>{e.event_type}</span></td>
                <td className="td font-mono" style={{ fontSize: 12, color: "#A06B04" }}>{e.source_ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
