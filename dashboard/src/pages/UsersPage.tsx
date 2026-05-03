import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "../api/client";

export default function UsersPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [pw,    setPw]    = useState("");
  const [role,  setRole]  = useState("viewer");
  const [name,  setName]  = useState("");

  const { data } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data,
  });
  const create = useMutation({
    mutationFn: async () => (await api.post("/users", { email, password: pw, role, name })).data,
    onSuccess: () => { setEmail(""); setPw(""); setName(""); qc.invalidateQueries({ queryKey: ["users"] }); },
  });
  const del = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/users/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const ROLE_BADGE: Record<string, string> = {
    admin:    "badge-admin",
    operator: "badge-operator",
    viewer:   "badge-viewer",
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <div>
        <p className="page-label">Organisation</p>
        <h1 className="page-title">Users</h1>
      </div>

      {/* Create form */}
      <div className="card p-5">
        <p className="section-label">Add user</p>
        <div className="flex flex-wrap gap-3 items-end mt-2">
          <div>
            <label className="input-label">Email</label>
            <input className="input" type="email" style={{ width: 200 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
          </div>
          <div>
            <label className="input-label">Name</label>
            <input className="input" style={{ width: 150 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <label className="input-label">Password</label>
            <input className="input" type="password" style={{ width: 140 }} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" />
          </div>
          <div>
            <label className="input-label">Role</label>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">admin</option>
              <option value="operator">operator</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={!email || !pw || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Creating…" : "+ Create"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">ID</th>
              <th className="th">Email</th>
              <th className="th">Name</th>
              <th className="th">Role</th>
              <th className="th-r"></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((u: any) => (
              <tr key={u.id} className="tr">
                <td className="td font-mono" style={{ fontSize: 12 }}>#{u.id}</td>
                <td className="td">{u.email}</td>
                <td className="td" style={{ color: "rgba(54,33,12,0.65)" }}>{u.name}</td>
                <td className="td"><span className={`badge ${ROLE_BADGE[u.role] ?? "badge-stopped"}`}>{u.role}</span></td>
                <td className="td" style={{ textAlign: "right" }}>
                  <button className="btn btn-danger btn-xs"
                          onClick={() => { if (confirm(`Delete user ${u.email}?`)) del.mutate(u.id); }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
