import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.ts";
import { documents, organizations } from "../db/schema.ts";
import { CIRCUS_2026 } from "../test-support.ts";

const CLI = new URL("./import.ts", import.meta.url).pathname;

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composer-import-"));
  dbPath = join(dir, "test.db");
  openDb(dbPath)
    .insert(organizations)
    .values({
      id: "org-1",
      slug: "coyote-creek",
      name: "Coyote Creek",
      createdAt: new Date(0),
    })
    .run();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000,
  });

describe("import CLI", () => {
  it("loads an Event directory into an Organization by slug, and again idempotently", () => {
    const first = run("coyote-creek", CIRCUS_2026);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/35 created, 0 updated/);
    expect(run("coyote-creek", CIRCUS_2026).stdout).toMatch(
      /0 created, 35 updated/,
    );
    expect(openDb(dbPath).select().from(documents).all()).toHaveLength(35);
  });

  it("fails with a message for an unknown Organization", () => {
    const result = run("nope", CIRCUS_2026);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no Organization with slug "nope"/);
  });

  it("prints usage without arguments", () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
  });
});
