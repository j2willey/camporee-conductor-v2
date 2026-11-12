import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.ts";
import { users } from "../db/schema.ts";

const CLI = new URL("./set-curator.ts", import.meta.url).pathname;

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composer-set-curator-"));
  dbPath = join(dir, "test.db");
  openDb(dbPath)
    .insert(users)
    .values({ id: "u1", email: "cora@example.com", createdAt: new Date(0) })
    .run();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000,
  });
const curator = () => openDb(dbPath).select().from(users).get()?.curator;

describe("set-curator CLI", () => {
  it("makes a user a curator, and --off takes it away", () => {
    const on = run("Cora@Example.com");
    expect(on.status).toBe(0);
    expect(on.stdout).toBe("Cora@Example.com is now a curator\n");
    expect(curator()).toBe(true);
    expect(run("cora@example.com", "--off").status).toBe(0);
    expect(curator()).toBe(false);
  });

  it("fails for an email no one has signed in with, and prints usage without one", () => {
    const unknown = run("nobody@example.com");
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toBe(
      "no one with the email nobody@example.com has signed in yet\n",
    );
    expect(run().status).toBe(2);
  });
});
