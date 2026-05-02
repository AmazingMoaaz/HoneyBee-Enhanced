import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../api/client";
import { useAuthStore } from "../stores/auth";

export default function PotStorePage() {
  const role = useAuthStore((s) => s.role);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["potstore"],
    queryFn: async () => (await api.get("/potstore")).data,
  });
  const sync = useMutation({
    mutationFn: async () => (await api.post("/potstore/sync")).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["potstore"] }),
  });
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">PotStore</h2>
        {role === "admin" && (
          <button className="bg-honey-500 text-slate-900 px-3 py-1.5 rounded font-semibold"
                  onClick={() => sync.mutate()}>
            Sync now
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">last updated: {data?.last_updated}</p>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {(data?.pots ?? []).map((p: any) => (
          <div key={p.id} className="bg-slate-900 border border-slate-800 rounded p-3">
            <div className="font-semibold text-honey-400">{p.id}</div>
            <div className="text-xs text-slate-500">{p.name}</div>
            <p className="text-sm mt-2">{p.description}</p>
            <div className="text-xs text-slate-500 mt-2 break-all">{p.git_url}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
