import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import api from "../api/client";

export default function SessionsPage() {
  const { data } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => (await api.get("/sessions?limit=200")).data,
    refetchInterval: 5000,
  });
  const list: any[] = data ?? [];

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="page-label">Attacker sessions</p>
        <h1 className="page-title">Sessions</h1>
        <p className="text-xs mt-1" style={{ color: "rgba(54,33,12,0.45)" }}>{list.length} sessions captured</p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">ID</th>
              <th className="th">Pot</th>
              <th className="th">Source</th>
              <th className="th">Started</th>
              <th className="th-r"></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr className="tr"><td className="td" colSpan={5} style={{ textAlign: "center", color: "rgba(54,33,12,0.35)" }}>No sessions captured yet</td></tr>
            )}
            {list.map((s: any) => (
              <tr key={s.id} className="tr">
                <td className="td font-mono" style={{ fontSize: 12 }}>#{s.id}</td>
                <td className="td font-mono" style={{ fontSize: 12 }}>{s.pot_id}</td>
                <td className="td font-mono" style={{ fontSize: 12, color: "#A06B04" }}>{s.src_ip}:{s.src_port}</td>
                <td className="td" style={{ color: "rgba(54,33,12,0.5)", fontSize: 12 }}>{s.started_at}</td>
                <td className="td" style={{ textAlign: "right" }}>
                  <Link to={`/sessions/${s.id}/replay`} className="btn btn-secondary btn-xs">▶ Replay</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
