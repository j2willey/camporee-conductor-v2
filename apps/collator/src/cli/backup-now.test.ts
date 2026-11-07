import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.ts";
import { loadEventCartridge } from "../load-event.ts";
import { CIRCUS_EVENT_ID, circusCartridge } from "../test-support.ts";

const CLI = new URL("./backup-now.ts", import.meta.url).pathname;

let dir: string;
let dbPath: string;
let stick: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collator-backup-now-"));
  dbPath = join(dir, "collator.db");
  stick = join(dir, "stick");
  mkdirSync(stick);
  const db = openDb(dbPath);
  const loaded = loadEventCartridge(db, circusCartridge());
  if (!loaded.ok) throw new Error(loaded.issues.join("\n"));
  db.$client.close();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (env: Record<string, string>, ...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath, ...env },
    encoding: "utf8",
    timeout: 20_000,
  });

describe("backup-now CLI", () => {
  it("writes a backup of the box's database to the folder given", () => {
    const result = run({}, stick);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const [name = "none"] = readdirSync(stick);
    expect(result.stdout).toContain(`backup written: ${join(stick, name)}`);
    const copy = new Database(join(stick, name), { readonly: true });
    const event = copy
      .prepare("SELECT event_id FROM cartridge_loads")
      .get() as { event_id: string };
    copy.close();
    expect(event.event_id).toBe(CIRCUS_EVENT_ID);
  });

  it("uses BACKUP_DIR when no folder is given", () => {
    expect(run({ BACKUP_DIR: stick }).status).toBe(0);
    expect(readdirSync(stick)).toHaveLength(1);
  });

  it("explains itself with no folder at all", () => {
    const result = run({});
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage: backup-now/);
  });

  it("fails clearly when the folder is missing", () => {
    const result = run({}, join(dir, "no-stick"));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/backup failed: .*doesn't exist/);
  });
});
