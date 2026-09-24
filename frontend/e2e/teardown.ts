import { execSync } from "node:child_process";

export default function teardown() {
  execSync("npx tsx --env-file=.env scripts/e2e-cleanup.ts", { cwd: "../backend", stdio: "inherit" });
}
