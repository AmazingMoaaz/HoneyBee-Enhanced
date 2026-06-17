// Single source of truth for where the HoneyBee core API lives.
//
// Resolution order:
//   1. Explicit VITE_API_BASE_URL build/env override (e.g. "https://hapi.h0neybee.online").
//   2. Public domain: when the dashboard is served from *.h0neybee.online, the
//      backend lives on the dedicated `hapi.h0neybee.online` subdomain.
//   3. Otherwise (localhost / LAN dev): same-origin — requests use the relative
//      "/api/v1" path, which the Vite dev server proxies to the local core.
//
// Both the REST client and the WebSocket hook derive their URLs from here, so
// there is exactly one place that knows the backend address.
function resolveApiOrigin(): string {
  const override = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");
  if (override) return override;

  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "h0neybee.online" || host.endsWith(".h0neybee.online")) {
      return `${window.location.protocol}//hapi.h0neybee.online`;
    }
  }
  return ""; // same-origin; dev proxy forwards /api to the local core
}

// Absolute origin of the API, or "" for same-origin.
export const API_ORIGIN = resolveApiOrigin();

// REST base, e.g. "https://hapi.h0neybee.online/api/v1" or relative "/api/v1".
export const API_BASE = `${API_ORIGIN}/api/v1`;

// Build a WebSocket URL under /api/v1 (e.g. apiWsUrl("/ws", { token })). Uses
// the API origin when configured, otherwise the current page host (dev proxy).
export function apiWsUrl(path: string, params?: Record<string, string>): string {
  let host: string;
  let secure: boolean;
  if (API_ORIGIN) {
    const u = new URL(API_ORIGIN);
    host = u.host;
    secure = u.protocol === "https:";
  } else {
    host = window.location.host;
    secure = window.location.protocol === "https:";
  }
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${secure ? "wss" : "ws"}://${host}/api/v1${path}${qs}`;
}
