// Single source of truth for where the HoneyBee core API lives.
//
// Default is SAME-ORIGIN: the browser calls the relative "/api/v1" path, and the
// front-door proxy (Vite dev server in dev, the reverse proxy in prod) forwards
// "/api" to the core on :5400. Same-origin means NO CORS and NO preflight — which
// sidesteps Cloudflare/nginx stripping the Access-Control-* headers entirely, and
// the WebSocket connects to the same host (also proxied).
//
// To deliberately talk to a cross-origin backend (e.g. a dedicated
// hapi.<domain> subdomain), set VITE_API_BASE_URL — but then that backend must
// return correct CORS headers all the way through the proxy chain.
//
// Both the REST client and the WebSocket hook derive their URLs from here, so
// there is exactly one place that knows the backend address.
function resolveApiOrigin(): string {
  const override = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");
  return override; // "" => same-origin (relative /api, proxied to the core)
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
