import Database from "better-sqlite3";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { backupNow, scheduleBackups } from "./backup.ts";
import { openDb, type Db } from "./db/open.ts";
import { loadEventCartridge } from "./load-event.ts";
import { circusCartridge, CLOWN_CAR } from "./test-support.ts";

// The box backs up to a USB stick every few minutes (ADR-0027 item 11). A stick is just a folder. Backups
// use SQLite's own VACUUM INTO, never a raw copy of the live file, and appear under their real name only
// once complete.

let dir: string;
let backups: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collator-backup-"));
  backups = join(dir, "stick");
  mkdirSync(backups);
  db = openDb(join(dir, "collator.db"));
});
afterEach(() => {
  vi.useRealTimers();
  db.$client.close();
  chmodSync(backups, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

/** A loaded Event with one Team and one score at Clown Car, as a Judge's phone sends it. */
async function scoreOne(id = "score-1") {
  const loaded = loadEventCartridge(db, circusCartridge());
  if (!loaded.ok) throw new Error(loaded.issues.join("\n"));
  const app = createApp({ db });
  const put = (path: string, body: unknown) =>
    app.request(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  await put("/api/groups/group-1", { name: "Troop 101" });
  await put("/api/teams/team-1", { groupId: "group-1", name: "Owls" });
  const res = await put(`/api/scores/${id}`, {
    judge: { id: "judge-1", name: "Alex Judge", email: "alex@example.com" },
    activityId: CLOWN_CAR.id,
    entrantId: "team-1",
    values: { [CLOWN_CAR.ownField]: 7, [CLOWN_CAR.commonField]: 5 },
    phoneCreatedAt: "2027-05-15T09:30:00Z",
  });
  expect(res.status).toBe(201);
}

/** The score entry ids in a backup file, opened read-only the way anyone restoring it would. */
function scoreIdsIn(file: string): string[] {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  try {
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    return (
      copy.prepare("SELECT id FROM score_entries ORDER BY id").all() as {
        id: string;
      }[]
    ).map((r) => r.id);
  } finally {
    copy.close();
  }
}

const filesIn = (folder: string) => readdirSync(folder).sort();

describe("backupNow", () => {
  it("writes a backup that opens and contains the score entry", async () => {
    await scoreOne();
    const result = backupNow(db, {
      dir: backups,
      keep: 10,
      now: new Date("2027-05-15T09:31:00.000Z"),
    });
    expect(result).toEqual({
      ok: true,
      file: join(backups, "collator-2027-05-15T09-31-00.000Z.db"),
      pruned: [],
    });
    expect(filesIn(backups)).toEqual(["collator-2027-05-15T09-31-00.000Z.db"]);
    expect(
      scoreIdsIn(join(backups, "collator-2027-05-15T09-31-00.000Z.db")),
    ).toEqual(["score-1"]);
  });

  it("names backups so they sort by time and suit a FAT-formatted stick (no colons)", () => {
    const result = backupNow(db, {
      dir: backups,
      keep: 10,
      now: new Date("2027-05-16T23:59:59.999Z"),
    });
    expect(result.ok && result.file).toMatch(
      /collator-2027-05-16T23-59-59\.999Z\.db$/,
    );
  });

  it("is consistent while another connection is mid-write: committed data only", async () => {
    await scoreOne();
    // A second connection (as a second process would be) starts a write and hasn't committed yet.
    const other = new Database(join(dir, "collator.db"));
    other.exec("BEGIN IMMEDIATE");
    other
      .prepare(
        "INSERT INTO score_entries (id, judge_id, activity_id, entrant_id, [values], phone_created_at, received_at) " +
          "SELECT 'score-2', judge_id, activity_id, entrant_id, [values], phone_created_at, received_at " +
          "FROM score_entries WHERE id = 'score-1'",
      )
      .run();
    const during = backupNow(db, {
      dir: backups,
      keep: 10,
      now: new Date("2027-05-15T09:31:00Z"),
    });
    other.exec("COMMIT");
    other.close();
    const after = backupNow(db, {
      dir: backups,
      keep: 10,
      now: new Date("2027-05-15T09:36:00Z"),
    });
    if (!during.ok || !after.ok) throw new Error("backup failed");
    expect(scoreIdsIn(during.file)).toEqual(["score-1"]);
    expect(scoreIdsIn(after.file)).toEqual(["score-1", "score-2"]);
  });

  it("keeps the newest N backups and prunes older ones, leaving other files alone", () => {
    writeFileSync(join(backups, "notes.txt"), "Jim's notes");
    const at = (minute: number) =>
      new Date(Date.UTC(2027, 4, 15, 9, minute, 0));
    for (const minute of [0, 5, 10]) {
      expect(backupNow(db, { dir: backups, keep: 2, now: at(minute) }).ok).toBe(
        true,
      );
    }
    const result = backupNow(db, { dir: backups, keep: 2, now: at(15) });
    expect(result).toMatchObject({
      ok: true,
      pruned: [join(backups, "collator-2027-05-15T09-05-00.000Z.db")],
    });
    expect(filesIn(backups)).toEqual([
      "collator-2027-05-15T09-10-00.000Z.db",
      "collator-2027-05-15T09-15-00.000Z.db",
      "notes.txt",
    ]);
  });

  it("clears a half-written backup left by an earlier interruption (a stick pulled mid-write)", () => {
    const partial = ".collator-2027-05-15T09-00-00.000Z.db.partial";
    writeFileSync(join(backups, partial), "half a database");
    const result = backupNow(db, {
      dir: backups,
      keep: 10,
      now: new Date("2027-05-15T09:05:00Z"),
    });
    expect(result.ok).toBe(true);
    expect(filesIn(backups)).toEqual(["collator-2027-05-15T09-05-00.000Z.db"]);
  });

  it("reports a missing folder clearly (is the stick mounted?) and doesn't throw", () => {
    const missing = join(dir, "no-stick");
    const result = backupNow(db, { dir: missing, keep: 10 });
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/no-stick.*doesn't exist.*mounted/),
    });
  });

  it("reports an unwritable folder clearly, leaves nothing behind, and doesn't throw", () => {
    chmodSync(backups, 0o555);
    const result = backupNow(db, { dir: backups, keep: 10 });
    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/couldn't write a backup to .*stick/),
    });
    chmodSync(backups, 0o755);
    expect(filesIn(backups)).toEqual([]);
  });

  it("reports a path that is a file, not a folder", () => {
    const file = join(dir, "a-file");
    writeFileSync(file, "");
    expect(backupNow(db, { dir: file, keep: 10 })).toEqual({
      ok: false,
      error: expect.stringMatching(/isn't a folder/),
    });
  });
});

describe("scheduleBackups", () => {
  it("backs up at start and then every interval, and stops when asked", () => {
    vi.useFakeTimers({ now: new Date("2027-05-15T09:00:00Z") });
    const log = { info: vi.fn(), error: vi.fn() };
    const schedule = scheduleBackups(db, {
      dir: backups,
      everyMinutes: 5,
      keep: 10,
      log,
    });
    expect(filesIn(backups)).toHaveLength(1);
    vi.advanceTimersByTime(10 * 60_000);
    expect(filesIn(backups)).toEqual([
      "collator-2027-05-15T09-00-00.000Z.db",
      "collator-2027-05-15T09-05-00.000Z.db",
      "collator-2027-05-15T09-10-00.000Z.db",
    ]);
    schedule.stop();
    vi.advanceTimersByTime(10 * 60_000);
    expect(filesIn(backups)).toHaveLength(3);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("logs a failed backup and keeps trying: the stick can come back", () => {
    vi.useFakeTimers({ now: new Date("2027-05-15T09:00:00Z") });
    const log = { info: vi.fn(), error: vi.fn() };
    rmSync(backups, { recursive: true });
    const schedule = scheduleBackups(db, {
      dir: backups,
      everyMinutes: 5,
      keep: 10,
      log,
    });
    expect(log.error).toHaveBeenCalledWith(
      expect.stringMatching(/backup failed: .*doesn't exist/),
    );
    mkdirSync(backups);
    vi.advanceTimersByTime(5 * 60_000);
    expect(filesIn(backups)).toEqual(["collator-2027-05-15T09-05-00.000Z.db"]);
    schedule.stop();
  });
});
