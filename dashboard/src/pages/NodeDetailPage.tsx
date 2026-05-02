import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import api from "../api/client";

export default function NodeDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
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

  if (!data) return <div>Loading…</div>;
  const node = data.node;
  const deps = data.deployments ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{node.name}</h2>
      <div className="text-sm text-slate-400">
        ID: <span className="font-mono">{node.id}</span> · status:{" "}
        <span className={node.online ? "text-emerald-400" : "text-slate-500"}>
          {node.online ? "online" : "offline"}
        </span>
      </div>

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
