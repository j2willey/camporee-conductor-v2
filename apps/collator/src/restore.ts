import Database from "better-sqlite3";
import {
  closeSync,
  copyFileSync,
  fsyncSync,
  openSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename } from "node:path";
import { openDb } from "./db/open.ts";
import { appendEpoch, type Epoch } from "./epoch.ts";

// Restoring a backup over the box's database (#66, ADR-0027), with the server stopped. A file copied by hand can't be
// told apart from the live database (a backup carries the same epoch), so this appends a `restore` epoch.

export type RestoreResult =
  { ok: true; backup: string; epoch: Epoch } | { ok: false; error: string };

/** Tables every Collator database has had since the first slice; later ones come with the migrations. */
const CORE_TABLES = [
  "event_documents",
  "cartridge_loads",
  "groups",
  "teams",
  "judges",
  "score_entries",
];

function problemWith(backupFile: string): string | null {
  let backup: Database.Database;
  try {
    backup = new Database(backupFile, { readonly: true, fileMustExist: true });
  } catch (error) {
    return `couldn't open ${backupFile}: ${(error as Error).message}`;
  }
  try {
    const have = new Set(
      (
        backup
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((t) => t.name),
    );
    const missing = CORE_TABLES.filter((t) => !have.has(t));
    return missing.length > 0
      ? `${backupFile} isn't a Collator database (no ${missing.join(", ")} table)`
      : null;
  } catch (error) {
    return `${backupFile} isn't a database: ${(error as Error).message}`;
  } finally {
    backup.close();
  }
}

export function restoreBackup(
  backupFile: string,
  databasePath: string,
): RestoreResult {
  const problem = problemWith(backupFile);
  if (problem) return { ok: false, error: problem };

  const partial = `${databasePath}.restoring.partial`;
  try {
    rmSync(partial, { force: true });
    copyFileSync(backupFile, partial);
    const fd = openSync(partial, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    // The old database's journal files belong to the file being replaced.
    rmSync(`${databasePath}-wal`, { force: true });
    rmSync(`${databasePath}-shm`, { force: true });
    renameSync(partial, databasePath);
  } catch (error) {
    rmSync(partial, { force: true });
    return {
      ok: false,
      error: `couldn't put the backup in place: ${(error as Error).message}`,
    };
  }
  const db = openDb(databasePath);
  try {
    return {
      ok: true,
      backup: basename(backupFile),
      epoch: appendEpoch(db, "restore"),
    };
  } finally {
    db.$client.close();
  }
}
