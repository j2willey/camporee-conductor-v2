import {
  closeSync,
  fsyncSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { Db } from "./db/open.ts";

// The box backs up every few minutes to a folder; a mounted USB stick is just a folder (ADR-0027 item 11).
// A backup is SQLite's own consistent copy (VACUUM INTO), never a raw copy of the live file, which in WAL
// mode can be mid-write. It's written under a hidden temporary name and renamed when complete, so a stick
// pulled mid-write never leaves a half file under a real backup's name.

const PREFIX = "collator-";
/** collator-2027-05-15T09-30-00.000Z.db: sorts by time; no colons, which FAT-formatted sticks refuse. */
const BACKUP_NAME = /^collator-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.db$/;
const PARTIAL = /^\.collator-.*\.partial$/;

export interface BackupOptions {
  /** The folder to write to. It must already exist: a missing one usually means the stick isn't mounted. */
  dir: string;
  /** How many backups to keep; older ones are deleted. */
  keep: number;
  now?: Date;
}

export type BackupResult =
  { ok: true; file: string; pruned: string[] } | { ok: false; error: string };

/** Writes one backup of the live database into `dir` and prunes old ones. Never throws. */
export function backupNow(
  db: Db,
  { dir, keep, now = new Date() }: BackupOptions,
): BackupResult {
  const problem = folderProblem(dir);
  if (problem) return { ok: false, error: problem };

  const name = `${PREFIX}${now.toISOString().replaceAll(":", "-")}.db`;
  const file = join(dir, name);
  const partial = join(dir, `.${name}.partial`);
  try {
    rmSync(partial, { force: true });
    db.$client.prepare("VACUUM INTO ?").run(partial);
    // Make sure the bytes are on the stick before the backup gets its real name.
    const fd = openSync(partial, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(partial, file);
  } catch (error) {
    rmSync(partial, { force: true });
    return {
      ok: false,
      error: `couldn't write a backup to ${dir}: ${(error as Error).message}`,
    };
  }
  return { ok: true, file, pruned: prune(dir, keep) };
}

function folderProblem(dir: string): string | null {
  try {
    if (!statSync(dir).isDirectory()) return `${dir} isn't a folder`;
  } catch {
    return `the backup folder ${dir} doesn't exist (is the USB stick mounted?)`;
  }
  return null;
}

/** Deletes all but the newest `keep` backups, and any half-written ones left by an interruption. */
function prune(dir: string, keep: number): string[] {
  const names = readdirSync(dir);
  const old = names
    .filter((n) => BACKUP_NAME.test(n))
    .sort()
    .reverse()
    .slice(keep);
  for (const n of names.filter((n) => PARTIAL.test(n))) {
    rmSync(join(dir, n), { force: true });
  }
  const pruned = old.sort().map((n) => join(dir, n));
  for (const file of pruned) rmSync(file, { force: true });
  return pruned;
}

export interface BackupSchedule {
  stop(): void;
}

/**
 * Backs up now, then every `everyMinutes`. A failure is logged and the next run tries again: the stick
 * may come back.
 */
export function scheduleBackups(
  db: Db,
  {
    dir,
    everyMinutes,
    keep,
    log = console,
  }: {
    dir: string;
    everyMinutes: number;
    keep: number;
    log?: { info(message: string): void; error(message: string): void };
  },
): BackupSchedule {
  const run = () => {
    const result = backupNow(db, { dir, keep });
    if (result.ok) log.info(`backup written: ${result.file}`);
    else log.error(`backup failed: ${result.error}`);
  };
  run();
  const timer = setInterval(run, everyMinutes * 60_000);
  return { stop: () => clearInterval(timer) };
}
