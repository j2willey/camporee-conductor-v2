import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Writes sw.js (#41 PR 3) from sw-template.js, with the list of built files to keep on the phone and a
 * version taken from them, so each new build replaces the phone's copy.
 */
function serviceWorker(): Plugin {
  return {
    name: "judge-service-worker",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const template = readFileSync(
        resolve(import.meta.dirname, "sw-template.js"),
        "utf8",
      );
      const files = Object.keys(bundle)
        .filter((f) => f !== "index.html")
        .map((f) => `/${f}`)
        .sort();
      const shell = ["/", ...files];
      const version = createHash("sha256")
        .update(template)
        .update(shell.join("\n"))
        .digest("hex")
        .slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: template
          .replace("= __VERSION__;", `= ${JSON.stringify(version)};`)
          .replace("= __SHELL__;", `= ${JSON.stringify(shell)};`),
      });
    },
  };
}

/**
 * The commit this build is from, shown on the judge page (#41). BUILD_COMMIT wins: the Docker build has no
 * .git (compose.yaml passes it in). Otherwise git, marking uncommitted changes "-dirty".
 */
function buildCommit(): string {
  const fromEnv = process.env["BUILD_COMMIT"];
  if (fromEnv) return fromEnv;
  try {
    return execFileSync(
      "git",
      ["describe", "--always", "--dirty", "--abbrev=7", "--exclude=*"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "unknown";
  }
}

// In development the Collator runs separately (pnpm --filter @camporee-conductor/collator start, :3030);
// on the box it serves the built app itself (WEB_ROOT). The service worker is only in the built app.
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  define: {
    __BUILD__: JSON.stringify({
      commit: buildCommit(),
      time: new Date().toISOString(),
    }),
  },
  server: {
    port: 5174,
    proxy: { "/api": "http://localhost:3030" },
  },
});
