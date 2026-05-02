import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";

export default function NodeDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showUninstall, setShowUninstall] = useState(false);
  const [activeDeployID, setActiveDeployID] = useState<number | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ["node", id],
    queryFn: async () => (await api.get(`/nodes/${id}`)).data,
    refetchInterval: 5000,
  });
  const [potID, setPotID] = useState("cowrie-1");
  const [hpType, setHpType] = useState("cowrie");

  const { data: catalog } = useQuery({
    queryKey: ["potstore"],
    queryFn: async () => (await api.get("/potstore")).data,
  });

  const deploy = useMutation({
    mutationFn: async () =>
      (await api.post(`/nodes/${id}/deployments`, {
        pot_id: potID, honeypot_type: hpType, auto_start: true, config: {},
      })).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["node", id] });
      if (res?.deployment_id) setActiveDeployID(res.deployment_id);
    },
  });

  // Live log query — polls every 2s while a deployment panel is open
  const activeDep = (data?.deployments ?? []).find((d: any) => d.id === activeDeployID);
  const depDone = activeDep && ["running", "failed", "stopped", "removed"].includes(activeDep.status);
  const { data: installLogs } = useQuery({
    queryKey: ["deploy-logs", activeDeployID],
    queryFn: async () => (await api.get(`/deployments/${activeDeployID}/logs?limit=500`)).data as any[],
    enabled: !!activeDeployID,
    refetchInterval: activeDeployID ? 2000 : false,
  });

  // Auto-scroll log panel to bottom on new entries
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [installLogs]);

  const action = useMutation({
    mutationFn: async (p: { depID: number; action: string }) =>
      (await api.post(`/deployments/${p.depID}/${p.action}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node", id] }),
  });

  const uninstall = useMutation({
    mutationFn: async () => (await api.post(`/nodes/${id}/uninstall`)).data,
    onSuccess: () => navigate("/nodes"),
  });

  if (!data) return <div>Loading…</div>;
  const node = data.node;
  const deps = data.deployments ?? [];
  const base = window.location.origin;
  const uninstallCmdWin = `irm "${base}/api/v1/nodes/${id}/uninstall?platform=windows" | iex`;
  const uninstallCmdLin = `curl -fsSL "${base}/api/v1/nodes/${id}/uninstall" | bash`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">{node.name}</h2>
          <div className="text-sm text-slate-400">
            ID: <span className="font-mono">{node.id}</span> · status:{" "}
            <span className={node.online ? "text-emerald-400" : "text-slate-500"}>
              {node.online ? "online" : "offline"}
            </span>
          </div>
        </div>
        <button
          className="text-orange-400 border border-orange-800 hover:border-orange-500 text-xs px-3 py-1.5 rounded"
          onClick={() => setShowUninstall(!showUninstall)}
        >
          uninstall node
        </button>
      </div>

      {showUninstall && (
        <div className="bg-red-950 border border-red-800 p-4 rounded-lg space-y-3">
          <div className="font-semibold text-red-300 text-sm">Remove agent from device</div>
          <div className="text-xs text-slate-400">Run on the target device to stop and delete the agent:</div>
          <div className="space-y-2">
            <div className="text-xs text-slate-500 font-medium">Windows (PowerShell as Administrator):</div>
            <code className="block bg-slate-900 rounded px-3 py-2 text-xs break-all text-slate-200">{uninstallCmdWin}</code>
            <div className="text-xs text-slate-500 font-medium mt-1">Linux / macOS:</div>
            <code className="block bg-slate-900 rounded px-3 py-2 text-xs break-all text-slate-200">{uninstallCmdLin}</code>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              className="bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50"
              disabled={uninstall.isPending}
              onClick={() => {
                if (confirm("Send remote uninstall command and remove this node from the database?"))
                  uninstall.mutate();
              }}
            >
              {uninstall.isPending ? "removing…" : "Send remote uninstall + delete from DB"}
            </button>
            <button className="text-slate-400 text-xs hover:text-slate-200" onClick={() => setShowUninstall(false)}>
              cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="font-semibold">Deploy honeypot</h3>
        <div className="flex gap-2 flex-wrap">
          <input className="bg-slate-800 px-3 py-2 rounded" placeholder="pot_id"
                 value={potID} onChange={(e) => setPotID(e.target.value)} />
          <select className="bg-slate-800 px-3 py-2 rounded" value={hpType}
                  onChange={(e) => setHpType(e.target.value)}>
            {(catalog?.pots ?? []).map((p: any) => (
              <option key={p.id} value={p.id}>{p.id}</option>
            ))}
          </select>
          <button className="bg-honey-500 text-slate-900 px-4 py-2 rounded font-semibold"
                  onClick={() => deploy.mutate()}>
            Deploy
          </button>
        </div>
      </div>

      {/* Live log panel */}
      {activeDeployID && (
        <div className="bg-slate-950 border border-slate-700 rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-mono text-slate-400 shrink-0">
                deployment <span className="text-slate-200">#{activeDeployID}</span>
              </span>
              {activeDep && (
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold ${
                  activeDep.status === "running"  ? "bg-emerald-900 text-emerald-300" :
                  activeDep.status === "failed"   ? "bg-red-900 text-red-300" :
                  activeDep.status === "pending"  ? "bg-sky-900 text-sky-300" :
                  "bg-slate-800 text-slate-400"
                }`}>{activeDep.status}</span>
              )}
              {!depDone && (
                <span className="text-xs text-slate-500 animate-pulse shrink-0">● live</span>
              )}
            </div>
            <button
              className="text-slate-500 hover:text-slate-200 text-xs ml-4 shrink-0"
              onClick={() => setActiveDeployID(null)}
            >✕</button>
          </div>
          {/* Terminal body */}
          <div className="h-96 overflow-y-auto p-3 font-mono text-xs">
            {(installLogs ?? []).length === 0 ? (
              <div className="text-slate-600 italic py-1">waiting for logs…</div>
            ) : (
              (installLogs ?? []).map((entry: any) => {
                let line = entry.data;
                try { line = JSON.parse(entry.data)?.line ?? entry.data; } catch { /* raw */ }
                const ts = new Date(entry.logged_at).toLocaleTimeString();
                const t = entry.log_type ?? "";
                const isError    = t.includes("error");
                const isWarning  = t.includes("warning");
                const isComplete = t.includes("complete");
                const isStart    = t.includes("start");
                return (
                  <div key={entry.id} className={`flex gap-2 items-baseline leading-5 py-px border-l-2 pl-2 ${
                    isError   ? "border-red-700"     :
                    isWarning ? "border-yellow-700"  :
                    isComplete ? "border-emerald-700" :
                    "border-transparent"
                  }`}>
                    <span className="text-slate-600 shrink-0 select-none tabular-nums">{ts}</span>
                    <span className={`shrink-0 text-[10px] px-1 rounded leading-4 ${
                      isError    ? "bg-red-900/60 text-red-400"       :
                      isWarning  ? "bg-yellow-900/60 text-yellow-400" :
                      isComplete ? "bg-emerald-900/60 text-emerald-400" :
                      isStart    ? "bg-cyan-900/60 text-cyan-400"     :
                      "bg-slate-800 text-slate-500"
                    }`}>{t}</span>
                    <span className={`break-all ${
                      isError    ? "text-red-300"      :
                      isWarning  ? "text-yellow-300"   :
                      isComplete ? "text-emerald-300"  :
                      isStart    ? "text-cyan-300"     :
                      "text-slate-300"
                    }`}>{line}</span>
                  </div>
                );
              })
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
        <h3 className="font-semibold mb-3">Deployments</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-400">
            <tr><th>ID</th><th>pot_id</th><th>type</th><th>status</th><th>actions</th></tr>
          </thead>
          <tbody>
            {deps.map((d: any) => (
              <tr key={d.id} className="border-b border-slate-800">
                <td className="font-mono">{d.id}</td>
                <td>{d.pot_id}</td>
                <td>{d.honeypot_type}</td>
                <td>{d.status}</td>
                <td className="space-x-2">
                  <button key="logs" className="text-slate-400 hover:text-slate-200"
                          onClick={() => setActiveDeployID(d.id)}>
                    logs
                  </button>
                  {["start", "stop", "restart", "remove"].map((a) => (
                    <button key={a} className="text-honey-400 hover:underline"
                            onClick={() => action.mutate({ depID: d.id, action: a })}>
                      {a}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
