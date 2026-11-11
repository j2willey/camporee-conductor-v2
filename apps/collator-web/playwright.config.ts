import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The judge page as it ships: the Collator serves the built app (WEB_ROOT), loaded with the Circus 2026
// event-day cartridge. A fresh database each run. A phone-sized browser: Judges use phones.
const PORT = 3040;
const collator = resolve(import.meta.dirname, "../collator");
const results = resolve(import.meta.dirname, "test-results");
export const E2E_DB = resolve(results, "judge.db");
const cartridge = resolve(results, "circus-event-day.zip");
/** Where the box backs up, and where a reset takes its backup first. */
const backups = resolve(results, "backups");

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  forbidOnly: !!process.env["CI"],
  // One Collator database shared by the tests: run them in order.
  workers: 1,
  reporter: process.env["CI"] ? "github" : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: [
      "pnpm build",
      `rm -f ${E2E_DB} ${E2E_DB}-wal ${E2E_DB}-shm`,
      `rm -rf ${backups}`,
      `mkdir -p ${results} ${backups}`,
      `node e2e/make-cartridge.ts ${cartridge}`,
      `node ${collator}/src/cli/load-cartridge.ts ${cartridge}`,
      `node ${collator}/src/main.ts`,
    ].join(" && "),
    env: {
      DATABASE_PATH: E2E_DB,
      WEB_ROOT: resolve(import.meta.dirname, "dist"),
      PORT: String(PORT),
      BACKUP_DIR: backups,
    },
    url: `http://localhost:${PORT}/api/health`,
    // Never attach to a server someone else started on this port.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
