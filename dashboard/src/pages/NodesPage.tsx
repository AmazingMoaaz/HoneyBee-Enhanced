import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

interface CreatedNode { id: number; name: string; token: string }

function InstallBanner({ node, onDismiss }: { node: CreatedNode; onDismiss: () => void }) {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [copied, setCopied] = useState(false);

  const base = window.location.origin;
  const cmd =
    platform === "linux"
      ? `curl -fsSL "${base}/api/v1/nodes/${node.id}/install?token=${node.token}" | bash`
      : `irm "${base}/api/v1/nodes/${node.id}/install?platform=windows&token=${node.token}" | iex`;

  const copy = () => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-emerald-950 border border-emerald-700 p-4 rounded-lg space-y-3">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-semibold text-emerald-300">Node created: {node.name}</div>
          <div className="text-xs text-slate-400 mt-0.5">Save the token — it's shown once.</div>
        </div>
        <button className="text-slate-400 hover:text-slate-200 text-xs underline" onClick={onDismiss}>
          dismiss
        </button>
      </div>

      {/* Raw token */}
      <div className="bg-slate-900 rounded px-3 py-2 font-mono text-xs break-all text-honey-300">
        {node.token}
      </div>

      {/* Platform picker */}
      <div className="flex gap-2">
        {(["linux", "windows"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPlatform(p)}
            className={`px-3 py-1 rounded text-xs font-medium border ${
              platform === p
                ? "bg-honey-500 border-honey-500 text-slate-900"
                : "border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            {p === "linux" ? "Linux / macOS" : "Windows (PS)"}
          </button>
        ))}
      </div>

      {/* One-liner */}
      <div className="text-xs text-slate-400">
        {platform === "linux" ? "Run on the target host:" : "Run in PowerShell as Administrator:"}
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-slate-900 rounded px-3 py-2 text-xs break-all text-slate-200">
          {cmd}
        </code>
        <button
          onClick={copy}
          className="shrink-0 bg-slate-700 hover:bg-slate-600 px-3 py-2 rounded text-xs font-medium"
        >
          {copied ? "copied!" : "copy"}
        </button>
      </div>
      <div className="text-xs text-slate-500">
        The script auto-detects your OS arch, downloads the binary from GitHub Releases,
        writes the config, and installs it as a system service.
      </div>
    </div>
  );
}

export default function NodesPage() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedNode | null>(null);

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: async () => (await api.get("/nodes")).data,
    refetchInterval: 5000,
  });

  const create = useMutation({
    mutationFn: async (n: string) => (await api.post("/nodes", { name: n })).data as CreatedNode,
    onSuccess: (data) => {
      setCreated(data);
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
        <input
          className="bg-slate-800 px-3 py-2 rounded flex-1 max-w-xs"
          placeholder="New node name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name && create.mutate(name)}
        />
        <button
          className="bg-honey-500 text-slate-900 px-4 py-2 rounded font-semibold disabled:opacity-50"
          onClick={() => create.mutate(name)}
          disabled={!name || create.isPending}
        >
          {create.isPending ? "creating…" : "Create"}
        </button>
      </div>

      {created && <InstallBanner node={created} onDismiss={() => setCreated(null)} />}

      <table className="w-full text-sm">
        <thead className="text-left text-slate-400 border-b border-slate-800">
          <tr>
            <th className="py-2">ID</th>
            <th>Name</th>
            <th>Status</th>
            <th>Last seen</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {nodes?.map((n: any) => (
            <tr key={n.id} className="border-b border-slate-900">
              <td className="py-2 font-mono">{n.id}</td>
              <td>
                <Link to={`/nodes/${n.id}`} className="text-honey-400 hover:underline">
                  {n.name}
                </Link>
              </td>
              <td>
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    n.online ? "bg-emerald-700" : "bg-slate-700"
                  }`}
                >
                  {n.online ? "online" : "offline"}
                </span>
              </td>
              <td className="text-slate-500">{n.last_seen ?? "—"}</td>
              <td>
                <button
                  className="text-red-400 hover:underline"
                  onClick={() => del.mutate(n.id)}
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

