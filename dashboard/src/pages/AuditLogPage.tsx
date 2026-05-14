import { useQuery } from "@tanstack/react-query";
import api from "../api/client";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const ACTION_COLORS: Record<string, { bg: string; fg: string }> = {
  create:           { bg: "#DCFCE7", fg: "#15803D" },
  delete:           { bg: "#FEE2E2", fg: "#991B1B" },
  uninstall:        { bg: "#FEE2E2", fg: "#991B1B" },
  "regenerate-token": { bg: "#FEF3C7", fg: "#92400E" },
};

export default function AuditLogPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => (await api.get("/audit-log?limit=200")).data,
    refetchInterval: 15000,
  });

  const list: any[] = data ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <p className="page-label">Security</p>
        <h1 className="page-title">Audit Log</h1>
        <p className="text-xs mt-1" style={{ color: "rgba(54,33,12,0.45)" }}>
          All administrative actions · {list.length} entries
        </p>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center">
            <div className="w-6 h-6 border-3 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Time</th>
                <th className="th">User</th>
                <th className="th">Action</th>
                <th className="th">Resource</th>
                <th className="th">Resource ID</th>
                <th className="th">Details</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr className="tr">
                  <td className="td" colSpan={6} style={{ textAlign: "center", color: "#94A3B8" }}>
                    No audit entries yet
                  </td>
                </tr>
              )}
              {list.map((e: any) => {
                const ac = ACTION_COLORS[e.action] ?? { bg: "#F1F5F9", fg: "#475569" };
                return (
                  <tr key={e.id} className="tr">
                    <td className="td font-mono" style={{ fontSize: 12, color: "#94A3B8" }}>{fmtTime(e.created_at)}</td>
                    <td className="td" style={{ fontSize: 13 }}>User #{e.user_id ?? "—"}</td>
                    <td className="td">
                      <span className="px-2 py-0.5 rounded text-xs font-bold" style={{ background: ac.bg, color: ac.fg }}>
                        {e.action}
                      </span>
                    </td>
                    <td className="td font-mono" style={{ fontSize: 12 }}>{e.resource}</td>
                    <td className="td font-mono" style={{ fontSize: 12, color: "#A06B04" }}>{e.resource_id ?? "—"}</td>
                    <td className="td text-xs" style={{ color: "#64748B", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.details || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
