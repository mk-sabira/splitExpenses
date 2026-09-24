import { defineConfig } from "vitest/config";

// Tests run against the local dev database; each test file cleans up its own rows.
process.loadEnvFile(".env");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
