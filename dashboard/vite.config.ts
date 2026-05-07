import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiTarget = process.env.VITE_API_URL || "http://localhost:5100";

// Forward the browser's original Host (e.g. 10.10.10.2:5173) to the backend
// as X-Forwarded-Host. This is critical for endpoints like the node install
// script that bake the operator-facing base URL into their output.
const forwardOriginalHost = (proxy: any) => {
  proxy.on("proxyReq", (proxyReq: any, req: any) => {
    if (req.headers.host) {
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host);
      proxyReq.setHeader("X-Forwarded-Proto", "http");
    }
  });
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        configure: forwardOriginalHost,
      },
      "/api/v1/ws": {
        target: apiTarget,
        ws: true,
        changeOrigin: true,
        configure: forwardOriginalHost,
      },
    },
  },
});
