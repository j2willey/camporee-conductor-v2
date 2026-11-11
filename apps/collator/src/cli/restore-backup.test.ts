import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupNow } from "../backup.ts";
import { openDb } from "../db/open.ts";
import { appendEpoch, currentEpoch } from "../epoch.ts";
import { loadEventCartridge } from "../load-event.ts";
import { circusCartridge } from "../test-support.ts";

const CLI = new URL("./restore-backup.ts", import.meta.url).pathname;

let dir: string;
let dbPath: string;
let stick: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collator-restore-"));
  dbPath = join(dir, "collator.db");
  stick = join(dir, "stick");
  mkdirSync(stick);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000,
  });

const groupNames = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    return (
      db.prepare("SELECT name FROM groups ORDER BY name").all() as {
        name: string;
      }[]
    ).map((g) => g.name);
  } finally {
    db.close();
  }
};

/** A box with one Group, backed up; then a second Group and a reset epoch the backup never saw. */
function boxWithBackup() {
  const db = openDb(dbPath);
  const loaded = loadEventCartridge(db, circusCartridge());
  if (!loaded.ok) throw new Error(loaded.issues.join("\n"));
  db.$client
    .prepare("INSERT INTO groups (id, name) VALUES ('g1', 'Early')")
    .run();
  const backedUp = currentEpoch(db);
  const made = backupNow(db, { dir: stick, keep: 5 });
  if (!made.ok) throw new Error(made.error);
  db.$client
    .prepare("INSERT INTO groups (id, name) VALUES ('g2', 'Late')")
    .run();
  appendEpoch(db, "reset");
  db.$client.close();
  return { file: made.file, backedUp };
}

describe("restore-backup CLI", () => {
  it("brings back the backup's data, with a new restore epoch as current", () => {
    const { file, backedUp } = boxWithBackup();
    expect(groupNames(dbPath)).toEqual(["Early", "Late"]);
    const result = run(file);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(groupNames(dbPath)).toEqual(["Early"]);
    const db = openDb(dbPath);
    const now = currentEpoch(db);
    expect(now.reason).toBe("restore");
    expect(now.id).not.toBe(backedUp.id);
    expect(result.stdout).toContain(file.split("/").pop());
    expect(result.stdout).toContain(now.id);
    db.$client.close();
  });

  it("the epoch log is the backup's, plus the new restore row", () => {
    const { file, backedUp } = boxWithBackup();
    expect(run(file).status).toBe(0);
    const db = openDb(dbPath);
    const rows = db.$client
      .prepare("SELECT id, reason FROM box_epochs ORDER BY seq")
      .all() as { id: string; reason: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: backedUp.id, reason: "created" });
    expect(rows[1]?.reason).toBe("restore");
    db.$client.close();
  });

  it("removes the old -wal and -shm files, and leaves no temp file", () => {
    const { file } = boxWithBackup();
    writeFileSync(`${dbPath}-wal`, "stale");
    writeFileSync(`${dbPath}-shm`, "stale");
    expect(run(file).status).toBe(0);
    const db = openDb(dbPath);
    expect(groupNames(dbPath)).toEqual(["Early"]);
    db.$client.close();
    expect(readdirSync(dir).filter((n) => n.includes("partial"))).toEqual([]);
  });

  it("restores into a box with no database yet", () => {
    const { file } = boxWithBackup();
    rmSync(dbPath);
    for (const s of ["-wal", "-shm"]) rmSync(`${dbPath}${s}`, { force: true });
    expect(run(file).status).toBe(0);
    expect(groupNames(dbPath)).toEqual(["Early"]);
  });

  it("refuses a file that isn't a Collator database, and leaves the live database alone", () => {
    boxWithBackup();
    const junk = join(dir, "junk.db");
    writeFileSync(junk, "this is not a database");
    const other = join(dir, "other.db");
    const o = new Database(other);
    o.exec("CREATE TABLE unrelated (x)");
    o.close();
    for (const bad of [junk, other]) {
      const result = run(bad);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/restore refused/);
      expect(groupNames(dbPath)).toEqual(["Early", "Late"]);
    }
    expect(currentEpoch(openDb(dbPath)).reason).toBe("reset");
  });

  it("refuses a missing file", () => {
    boxWithBackup();
    const result = run(join(dir, "nope.db"));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/restore refused/);
    expect(existsSync(dbPath)).toBe(true);
  });

  it("explains itself with no file", () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage: restore-backup/);
  });

  it("can restore a copy kept elsewhere", () => {
    const { file } = boxWithBackup();
    const copy = join(dir, "copy.db");
    copyFileSync(file, copy);
    expect(run(copy).status).toBe(0);
    expect(groupNames(dbPath)).toEqual(["Early"]);
  });
});
