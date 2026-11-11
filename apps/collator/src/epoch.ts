import type { Db } from "./db/open.ts";
import type { EpochReason } from "./db/schema.ts";

// The box epoch (#66, ADR-0027 "Reset, restore and the box epoch").

export interface Epoch {
  id: string;
  reason: EpochReason;
  at: Date;
}

/** Appends an epoch and returns it. */
export function appendEpoch(_db: Db, _reason: EpochReason): Epoch {
  throw new Error("not implemented");
}

/** Makes sure the log has at least one epoch: a `created` one when it's empty. */
export function ensureEpoch(_db: Db): void {
  throw new Error("not implemented");
}

/** The newest epoch. */
export function currentEpoch(_db: Db): Epoch {
  throw new Error("not implemented");
}

/** The epochs after `id`, oldest first, or `{ unknown: true }` when `id` isn't in the log. */
export function epochsSince(_db: Db, _id: string): Epoch[] | { unknown: true } {
  throw new Error("not implemented");
}
