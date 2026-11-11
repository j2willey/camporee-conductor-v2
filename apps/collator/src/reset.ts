import type { BackupConfig } from "./config.ts";
import type { Db } from "./db/open.ts";
import type { Epoch } from "./epoch.ts";

// Reset for rehearsals (#42 PR 8, ADR-0027): backs up first, then clears, then appends a `reset` epoch.

export type ResetKind = "scores" | "full";

export type ResetResult =
  | { ok: true; backup: string; epoch: Epoch }
  | { ok: false; reason: "invalid" | "backup"; message: string };

export function resetBox(
  _db: Db,
  _backup: BackupConfig | null,
  _input: { kind: ResetKind; confirm: string; officialEmail: string },
): ResetResult {
  throw new Error("not implemented");
}
