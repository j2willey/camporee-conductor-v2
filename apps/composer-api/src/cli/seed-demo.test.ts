import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { devAuth, DEV_USER_HEADER } from "../auth/dev.ts";
import { openDb } from "../db/open.ts";
import { memberships, organizations, users } from "../db/schema.ts";
import { CIRCUS_2026 } from "../test-support.ts";

const CLI = new URL("./seed-demo.ts", import.meta.url).pathname;

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composer-seed-"));
  dbPath = join(dir, "test.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000,
  });

describe("seed-demo CLI", () => {
  it("creates the owner and the Organization, and loads the Event", () => {
    const result = run("Ann@Example.com", "coyote-creek", CIRCUS_2026);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /ann@example\.com owns coyote-creek; imported Event .*: 35 created/,
    );
    const db = openDb(dbPath);
    expect(db.select({ email: users.email }).from(users).all()).toEqual([
      { email: "ann@example.com" },
    ]);
    expect(
      db
        .select({ slug: organizations.slug, name: organizations.name })
        .from(organizations)
        .all(),
    ).toEqual([{ slug: "coyote-creek", name: "Coyote Creek" }]);
    expect(
      db.select({ role: memberships.role }).from(memberships).all(),
    ).toEqual([{ role: "owner" }]);
  });

  it("is idempotent", () => {
    run("ann@example.com", "coyote-creek", CIRCUS_2026);
    const again = run("ann@example.com", "coyote-creek", CIRCUS_2026);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/0 created, 35 updated/);
    const db = openDb(dbPath);
    expect(db.select().from(users).all()).toHaveLength(1);
    expect(db.select().from(memberships).all()).toHaveLength(1);
  });

  it("works with whichever sign-in comes first: the seeded user is relinked to it (#32)", async () => {
    run("ann@example.com", "coyote-creek", CIRCUS_2026);
    const app = createApp({
      db: openDb(dbPath),
      auth: devAuth(),
      authConfig: { adapter: "dev" },
    });
    const res = await app.request("/api/organizations", {
      headers: { [DEV_USER_HEADER]: "ann@example.com" },
    });
    expect(await res.json()).toEqual([
      expect.objectContaining({ slug: "coyote-creek", role: "owner" }),
    ]);
  });

  it("prints usage without arguments", () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/i);
  });
});
