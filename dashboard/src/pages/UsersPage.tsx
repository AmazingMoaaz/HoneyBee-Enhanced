import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "../api/client";

export default function UsersPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState("viewer");
  const [name, setName] = useState("");

  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data,
  });
  const create = useMutation({
    mutationFn: async () => (await api.post("/users", { email, password: pw, role, name })).data,
    onSuccess: () => {
      setEmail(""); setPw(""); setName("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const del = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/users/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">Users</h2>
      <div className="bg-slate-900 border border-slate-800 p-3 rounded flex flex-wrap gap-2">
        <input className="bg-slate-800 px-3 py-2 rounded" placeholder="email"
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" className="bg-slate-800 px-3 py-2 rounded" placeholder="password"
               value={pw} onChange={(e) => setPw(e.target.value)} />
        <input className="bg-slate-800 px-3 py-2 rounded" placeholder="name"
               value={name} onChange={(e) => setName(e.target.value)} />
        <select className="bg-slate-800 px-3 py-2 rounded" value={role}
                onChange={(e) => setRole(e.target.value)}>
          <option value="admin">admin</option>
          <option value="operator">operator</option>
          <option value="viewer">viewer</option>
        </select>
        <button className="bg-honey-500 text-slate-900 px-3 py-2 rounded font-semibold"
                onClick={() => create.mutate()}>Create</button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-slate-400 border-b border-slate-800">
          <tr><th className="py-2">ID</th><th>Email</th><th>Name</th><th>Role</th><th></th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((u: any) => (
            <tr key={u.id} className="border-b border-slate-900">
              <td className="py-2 font-mono">{u.id}</td>
              <td>{u.email}</td>
              <td>{u.name}</td>
              <td>{u.role}</td>
              <td><button className="text-red-400 hover:underline"
                          onClick={() => del.mutate(u.id)}>delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
