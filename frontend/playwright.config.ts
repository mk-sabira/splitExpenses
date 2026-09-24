import { defineConfig } from "@playwright/test";

// End-to-end tests drive the real app in the system Chrome against a real
// backend and the local dev database (D24). Both servers start on their own
// ports, so they don't clash with `npm run dev`.
const API_PORT = 3100;
const WEB_PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  globalTeardown: "./e2e/teardown.ts",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `PORT=${API_PORT} npx tsx --env-file=.env src/server.ts`,
      cwd: "../backend",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: `API_URL=http://localhost:${API_PORT} npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
    },
  ],
});
