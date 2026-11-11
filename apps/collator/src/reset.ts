import { backupNow } from "./backup.ts";
import type { BackupConfig } from "./config.ts";
import type { Db } from "./db/open.ts";
import {
  activityClosures,
  exhibitionResultSaves,
  exhibitionStatusChanges,
  groups,
  judges,
  officialActions,
  rosterChanges,
  scoreEntries,
  teams,
} from "./db/schema.ts";
import { appendEpoch, type Epoch } from "./epoch.ts";
import { loadedEvent } from "./load-event.ts";

// Reset for rehearsals (#42 PR 8, ADR-0027 "Reset, restore and the box epoch"; v1's /api/admin/scores and
// /full-reset). The Official types the Event's name; the box backs up first and refuses if it can't; then it
// clears in one transaction and appends a `reset` epoch, so phones don't resend what was cleared on purpose.
// Neither kind touches the loaded cartridge or the Officials added on the console.

export type ResetKind = "scores" | "full";

export type ResetResult =
  | { ok: true; backup: string; epoch: Epoch }
  | { ok: false; reason: "invalid" | "backup"; message: string };

export function resetBox(
  db: Db,
  backup: BackupConfig | null,
  input: { kind: ResetKind; confirm: string; officialEmail: string },
): ResetResult {
  const event = loadedEvent(db)?.manifest.event;
  if (!event) {
    return {
      ok: false,
      reason: "invalid",
      message: "no Event is loaded on this box yet",
    };
  }
  const typed = input.confirm.trim().toLowerCase();
  if (
    typed === "" ||
    (typed !== event.title.trim().toLowerCase() &&
      typed !== event.slug.trim().toLowerCase())
  ) {
    return {
      ok: false,
      reason: "invalid",
      message: "Type the Event's name to confirm.",
    };
  }

  const refused = (why: string): ResetResult => ({
    ok: false,
    reason: "backup",
    message: `No backup could be taken (${why}); nothing was reset.`,
  });
  if (!backup) return refused("no backup folder is set on this box");
  const made = backupNow(db, backup);
  if (!made.ok) return refused(made.error);

  const epoch = db.transaction((tx) => {
    tx.delete(activityClosures).run();
    tx.delete(scoreEntries).run();
    tx.delete(judges).run();
    tx.delete(officialActions).run();
    tx.delete(exhibitionResultSaves).run();
    tx.delete(exhibitionStatusChanges).run();
    if (input.kind === "full") {
      tx.delete(teams).run();
      tx.delete(groups).run();
      tx.delete(rosterChanges).run();
    }
    return appendEpoch(tx as unknown as Db, "reset");
  });
  return { ok: true, backup: made.file.split("/").pop() ?? made.file, epoch };
}
