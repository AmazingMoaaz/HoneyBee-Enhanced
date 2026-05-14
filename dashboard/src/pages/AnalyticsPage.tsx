import { useQuery } from "@tanstack/react-query";
import api from "../api/client";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from "recharts";

const COLORS = ["#F59E0B", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];

function fmtHour(bucket: string) {
  try { return new Date(bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  catch { return bucket; }
}

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => (await api.get("/analytics/overview?hours=24")).data,
    refetchInterval: 30000,
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const timeline = data?.timeline ?? [];
  const byType = data?.by_type ?? [];
  const byIP = data?.by_ip ?? [];
  const byPort = data?.by_port ?? [];
  const byPot = data?.by_pot ?? [];
  const heatmap = data?.hourly_heatmap ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <p className="page-label">Intelligence</p>
        <h1 className="page-title">Attack Analytics</h1>
        <p className="text-xs mt-1" style={{ color: "rgba(54,33,12,0.45)" }}>
          {data?.total_events?.toLocaleString() ?? 0} total events · {data?.unique_ips ?? 0} unique attackers
        </p>
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatBox label="Total Events" value={data?.total_events} color="#F59E0B" />
        <StatBox label="Unique IPs" value={data?.unique_ips} color="#EF4444" />
        <StatBox label="Event Types" value={byType.length} color="#3B82F6" />
        <StatBox label="Targeted Ports" value={byPort.length} color="#10B981" />
      </div>

      {/* Timeline Chart */}
      <div className="card p-5">
        <p className="section-label">Attack Timeline (24h)</p>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline}>
              <defs>
                <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="bucket" tickFormatter={fmtHour} tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
              <Area type="monotone" dataKey="count" stroke="#F59E0B" strokeWidth={2} fill="url(#colorEvents)" name="Events" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* Event Types Pie */}
        <div className="card p-5">
          <p className="section-label">Event Types Distribution</p>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byType} cx="50%" cy="50%" outerRadius={100} dataKey="count" nameKey="type" label={({ name, percent }: any) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`} labelLine={false}>
                  {byType.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Targeted Ports */}
        <div className="card p-5">
          <p className="section-label">Top Targeted Ports</p>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPort.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <YAxis type="category" dataKey="port" tick={{ fontSize: 11 }} stroke="#94A3B8" width={50} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                <Bar dataKey="count" fill="#3B82F6" radius={[0, 4, 4, 0]} name="Attacks" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* More Charts Row */}
      <div className="grid md:grid-cols-2 gap-5">
        {/* Hourly Heatmap */}
        <div className="card p-5">
          <p className="section-label">Attack Activity by Hour of Day (30 days)</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={heatmap}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="#94A3B8" tickFormatter={(h: number) => `${h}:00`} />
                <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="Events" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Events by Honeypot */}
        <div className="card p-5">
          <p className="section-label">Events by Honeypot</p>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPot}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                <XAxis dataKey="pot_id" tick={{ fontSize: 10 }} stroke="#94A3B8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Legend />
                <Bar dataKey="count" fill="#10B981" radius={[4, 4, 0, 0]} name="Events" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Top Attacker IPs Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(15,23,42,0.06)", background: "#F8FAFC" }}>
          <p className="section-label" style={{ marginBottom: 0 }}>Top Attacker IPs</p>
          <span className="badge badge-honey">{byIP.length}</span>
        </div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Rank</th>
              <th className="th">IP Address</th>
              <th className="th">Attack Count</th>
              <th className="th">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {byIP.map((r: any, i: number) => (
              <tr key={r.ip} className="tr">
                <td className="td font-mono" style={{ fontSize: 12, color: "#94A3B8" }}>#{i + 1}</td>
                <td className="td font-mono font-semibold" style={{ fontSize: 13, color: "#DC2626" }}>{r.ip}</td>
                <td className="td font-mono" style={{ fontSize: 13 }}>{r.count.toLocaleString()}</td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.min((r.count / (data?.total_events || 1)) * 100, 100)}%`, maxWidth: 120, background: "#EF4444" }} />
                    <span className="text-xs text-slate-500">{((r.count / (data?.total_events || 1)) * 100).toFixed(1)}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: any; color: string }) {
  return (
    <div className="card-stat" style={{ padding: "16px 18px" }}>
      <p className="text-xs font-medium" style={{ color: "#64748B" }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value?.toLocaleString() ?? "—"}</p>
    </div>
  );
}
