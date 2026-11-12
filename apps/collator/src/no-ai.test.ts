import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * AI is never on the event-day path (ADR-0010, ADR-0030 item 6, CLAUDE.md rule 8): the Collator and its web app never
 * depend on an AI provider or on the Composer API, which holds the adapter, directly or through a workspace package.
 */

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FORBIDDEN = /@anthropic-ai\/|@camporee-conductor\/composer-api/;

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const manifestOf = (dir: string) =>
  JSON.parse(readFileSync(join(repo, dir, "package.json"), "utf8")) as Manifest;

/** Every workspace package directory, by package name. */
function workspace(): Map<string, string> {
  const byName = new Map<string, string>();
  for (const parent of ["apps", "packages"]) {
    for (const entry of readdirSync(join(repo, parent))) {
      const dir = join(parent, entry);
      try {
        byName.set(manifestOf(dir).name, dir);
      } catch {
        // Not a package.
      }
    }
  }
  return byName;
}

/** The app and every workspace package it depends on, transitively. */
function closure(start: string): string[] {
  const byName = workspace();
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const dir = queue.pop() ?? "";
    if (seen.has(dir)) continue;
    seen.add(dir);
    const manifest = manifestOf(dir);
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      const next = byName.get(name);
      if (next) queue.push(next);
    }
  }
  return [...seen];
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      if (entry === "node_modules" || entry === "dist") continue;
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
    }
  };
  walk(join(repo, dir, "src"));
  return out;
}

describe.each(["apps/collator", "apps/collator-web"])("%s", (app) => {
  const dirs = closure(app);

  it("depends on no AI provider and not on the Composer API", () => {
    expect(dirs).not.toContain("apps/composer-api");
    for (const dir of dirs) {
      const manifest = manifestOf(dir);
      const names = Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      });
      expect(
        names.filter((n) => FORBIDDEN.test(n)),
        `${dir}/package.json`,
      ).toEqual([]);
    }
  });

  it("imports neither, in its own code or its workspace packages", () => {
    for (const dir of dirs) {
      for (const file of sourceFiles(dir)) {
        if (file.endsWith("no-ai.test.ts")) continue;
        expect(FORBIDDEN.test(readFileSync(file, "utf8")), file).toBe(false);
      }
    }
  });
});
