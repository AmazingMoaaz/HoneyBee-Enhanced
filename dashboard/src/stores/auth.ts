import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  role: string | null;
  email: string | null;
  userID: number | null;
  orgID: number | null;
  permissions: string[];
  login: (email: string, password: string) => Promise<void>;
  register: (orgName: string, email: string, password: string, name: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => void;
  hasPerm: (perm: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      role: null,
      email: null,
      userID: null,
      orgID: null,
      permissions: [],
      login: async (email, password) => {
        const { data } = await axios.post("/api/v1/auth/login", { email, password });
        set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          role: data.role,
          email: data.email,
          userID: data.user_id,
          orgID: data.org_id,
          permissions: data.permissions ?? [],
        });
      },
      register: async (org_name, email, password, name) => {
        const { data } = await axios.post("/api/v1/auth/register", { org_name, email, password, name });
        set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          role: data.role,
          email: data.email,
          userID: data.user_id,
          orgID: data.org_id,
          permissions: data.permissions ?? [],
        });
      },
      refresh: async () => {
        const rt = get().refreshToken;
        if (!rt) throw new Error("no refresh token");
        const { data } = await axios.post("/api/v1/auth/refresh", { refresh_token: rt });
        set({
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          ...(data.role ? { role: data.role } : {}),
          ...(data.permissions ? { permissions: data.permissions } : {}),
        });
      },
      logout: () => set({
        accessToken: null, refreshToken: null, role: null, email: null, userID: null, orgID: null, permissions: [],
      }),
      hasPerm: (perm) => {
        const s = get();
        return s.role === "admin" || (s.permissions ?? []).includes(perm);
      },
    }),
    { name: "honeybee-auth" }
  )
);
