import { randomUUID } from "node:crypto";
import { asc, desc, eq, gt } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { boxEpochs, type EpochReason } from "./db/schema.ts";

// The box epoch (#66, ADR-0027 "Reset, restore and the box epoch"): an append-only log of random ids, each with
// the reason it was made. The newest is current. Phones compare it with the one they knew.

export interface Epoch {
  id: string;
  reason: EpochReason;
  at: Date;
}

const toEpoch = (row: typeof boxEpochs.$inferSelect): Epoch => ({
  id: row.id,
  reason: row.reason,
  at: row.at,
});

/** Appends an epoch and returns it. */
export function appendEpoch(db: Db, reason: EpochReason): Epoch {
  const row = db
    .insert(boxEpochs)
    .values({ id: randomUUID(), reason, at: new Date() })
    .returning()
    .get();
  return toEpoch(row);
}

/** Makes sure the log has at least one epoch: a `created` one when it's empty (also a database from before epochs). */
export function ensureEpoch(db: Db): void {
  db.transaction((tx) => {
    if (tx.select().from(boxEpochs).limit(1).get() === undefined) {
      tx.insert(boxEpochs)
        .values({ id: randomUUID(), reason: "created", at: new Date() })
        .run();
    }
  });
}

/** The newest epoch. */
export function currentEpoch(db: Db): Epoch {
  const row = db
    .select()
    .from(boxEpochs)
    .orderBy(desc(boxEpochs.seq))
    .limit(1)
    .get();
  if (!row) throw new Error("the box has no epoch (openDb makes one)");
  return toEpoch(row);
}

/** The epochs after `id`, oldest first, or `{ unknown: true }` when `id` isn't in the log. */
export function epochsSince(db: Db, id: string): Epoch[] | { unknown: true } {
  const known = db.select().from(boxEpochs).where(eq(boxEpochs.id, id)).get();
  if (!known) return { unknown: true };
  return db
    .select()
    .from(boxEpochs)
    .where(gt(boxEpochs.seq, known.seq))
    .orderBy(asc(boxEpochs.seq))
    .all()
    .map(toEpoch);
}
