import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

export default function NodesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    refetchInterval: 5000,
  });

  const create = useMutation({
    mutationFn: async (n: string) => (await api.post("/nodes", { name: n })).data,
    onSuccess: (data) => {
      setToken(data.token);
      setName("");
      qc.invalidateQueries({ queryKey: ["nodes"] });
    },
  });
  const del = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/nodes/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nodes"] }),
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Nodes</h2>
      <div className="flex gap-2">
        <input className="bg-slate-800 px-3 py-2 rounded flex-1 max-w-xs"
               placeholder="New node name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="bg-honey-500 text-slate-900 px-4 py-2 rounded font-semibold"
                onClick={() => create.mutate(name)} disabled={!name}>
          Create
        </button>
      </div>
      {token && (
        <div className="bg-emerald-900 border border-emerald-700 p-3 rounded text-sm">
          <div className="font-semibold">Save this token now (shown once):</div>
          <code className="block mt-1 break-all">{token}</code>
          <button className="text-xs underline mt-2" onClick={() => setToken(null)}>dismiss</button>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="text-left text-slate-400 border-b border-slate-800">
          <tr><th className="py-2">ID</th><th>Name</th><th>Status</th><th>Last seen</th><th></th></tr>
        </thead>
        <tbody>
          {nodes?.map((n: any) => (
            <tr key={n.id} className="border-b border-slate-900">
              <td className="py-2 font-mono">{n.id}</td>
              <td><Link to={`/nodes/${n.id}`} className="text-honey-400 hover:underline">{n.name}</Link></td>
              <td>
                <span className={`px-2 py-0.5 rounded text-xs ${n.online ? "bg-emerald-700" : "bg-slate-700"}`}>
                  {n.online ? "online" : "offline"}
                </span>
              </td>
              <td className="text-slate-500">{n.last_seen ?? "—"}</td>
              <td>
                <button className="text-red-400 hover:underline" onClick={() => del.mutate(n.id)}>delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
