import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev server proxies the API and Socket.io, so the browser talks to one
// origin and the backend needs no extra CORS setup (D20).
const api = process.env.API_URL ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": api,
      "/socket.io": { target: api, ws: true },
    },
  },
});
