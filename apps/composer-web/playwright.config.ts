import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The smoke test runs the built app as it ships: the API serves it (issue #4, D5), with the dev sign-in,
// so CI needs no Clerk secrets. A fresh database each run, seeded with Circus 2026.
const PORT = 3020;
const api = resolve(import.meta.dirname, "../composer-api");
const db = resolve(import.meta.dirname, "test-results/smoke.db");
const fixture = resolve(
  import.meta.dirname,
  "../../packages/schema/fixtures/circus-2026",
);

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  forbidOnly: !!process.env["CI"],
  reporter: process.env["CI"] ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: [
      "pnpm build",
      `rm -f ${db} ${db}-wal ${db}-shm`,
      `mkdir -p ${resolve(db, "..")}`,
      `node ${api}/src/cli/seed-demo.ts smoke@example.com smoke-test ${fixture}`,
      // The smoke user curates the library (#102 PR 3).
      `node ${api}/src/cli/set-curator.ts smoke@example.com`,
      `node ${api}/src/main.ts`,
    ].join(" && "),
    env: {
      NODE_ENV: "test",
      AUTH_ADAPTER: "dev",
      DATABASE_PATH: db,
      WEB_ROOT: resolve(import.meta.dirname, "dist"),
      PORT: String(PORT),
    },
    url: `http://localhost:${PORT}/health`,
    // Never attach to a server someone else started on this port.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
