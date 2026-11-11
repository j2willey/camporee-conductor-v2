import type { Epoch } from "./epoch.ts";

// Restoring a backup over the box's database (#66), with the server stopped.

export type RestoreResult =
  { ok: true; backup: string; epoch: Epoch } | { ok: false; error: string };

export function restoreBackup(
  _backupFile: string,
  _databasePath: string,
): RestoreResult {
  throw new Error("not implemented");
}
