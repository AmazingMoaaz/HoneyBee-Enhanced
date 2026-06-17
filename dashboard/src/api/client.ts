import axios, { AxiosInstance } from "axios";
import { useAuthStore } from "../stores/auth";
import { API_BASE } from "../lib/apiBase";

const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((cfg) => {
  const tok = useAuthStore.getState().accessToken;
  if (tok) cfg.headers.Authorization = `Bearer ${tok}`;
  return cfg;
});

let refreshing: Promise<void> | null = null;

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config;
    if (err.response?.status === 401 && !original?._retry) {
      original._retry = true;
      try {
        if (!refreshing) refreshing = useAuthStore.getState().refresh();
        await refreshing;
        refreshing = null;
        return api(original);
      } catch (e) {
        useAuthStore.getState().logout();
        throw e;
      }
    }
    throw err;
  }
);

export default api;
