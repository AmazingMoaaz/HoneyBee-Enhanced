import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "../api/client";

export default function NodeDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showUninstall, setShowUninstall] = useState(false);
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["node", id] }),
  });

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
