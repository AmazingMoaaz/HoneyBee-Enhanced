import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:5100",
        changeOrigin: true,
      },
      "/api/v1/ws": {
        target: process.env.VITE_API_URL || "http://localhost:5100",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
