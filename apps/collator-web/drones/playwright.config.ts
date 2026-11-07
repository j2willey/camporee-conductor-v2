import { defineConfig, devices } from "@playwright/test";

// Judge drones (#63): simulated Judges' phones against the real box image behind Caddy, over HTTPS by
// hostname. Run by docs/runbook/drones-collator.sh, inside Playwright's own Docker image (every browser
// with its libraries), which starts the box first. Not run by `pnpm e2e`.
//
// Trust: Caddy's own root CA only (the script puts it in the container's trust store for WebKit and Node);
// Chromium doesn't read that store, so it's told to accept exactly the keys of the certificates the box
// presents (DRONES_SPKI). No ignoreHTTPSErrors.
export const DRONES_URL =
  process.env["DRONES_URL"] ?? "https://judge.camporeeconductor.com:8444";
const spki = process.env["DRONES_SPKI"];

export default defineConfig({
  testDir: ".",
  testMatch: "*.drone.ts",
  // One box, shared: the browsers take turns, and each run's names carry the browser's name.
  workers: 1,
  forbidOnly: !!process.env["CI"],
  timeout: 120_000,
  outputDir: process.env["DRONES_RESULTS"] ?? "../test-results/drones",
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: { baseURL: DRONES_URL, trace: "retain-on-failure" },
  projects: [
    {
      name: "android",
      use: {
        ...devices["Pixel 7"],
        launchOptions: {
          args: spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : [],
        },
      },
    },
    { name: "iphone", use: { ...devices["iPhone 15"] } },
  ],
});
