import { and, asc, eq, inArray, max } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { activityClosures, scoreEntries } from "./db/schema.ts";
import { activityFields } from "./bundle-lookup.ts";
import { loadedEvent } from "./load-event.ts";
import {
  conflict,
  invalid,
  NO_EVENT,
  upsertJudge,
  type JudgeIdentity,
  type Refused,
} from "./roster-and-scores.ts";

// Close Game (#41 PR 6; v1's "I'm done, close game"). A Judge done at an Activity sends the ids of every
// score their phone saved there; the box answers how many it has and which it doesn't. Officials see the
// newest closure per Judge, anything missing, and whether the Judge scored there again since: that
// reopens it. Nothing here changes scores or rankings.

export interface ClosureSubmission {
  id: string;
  judge: JudgeIdentity;
  activityId: string;
  scoreIds: string[];
  /** The phone's clock: for information only (ADR-0027 item 9). */
  phoneCreatedAt: string;
}

/** Which of `scoreIds` the box has, and which it doesn't. */
export type ClosureRecorded =
  | {
      ok: true;
      status: "created" | "repeat";
      have: number;
      missing: string[];
    }
  | Refused;

function check(db: Db, scoreIds: readonly string[]) {
  const found = new Set(
    scoreIds.length === 0
      ? []
      : db
          .select({ id: scoreEntries.id })
          .from(scoreEntries)
          .where(inArray(scoreEntries.id, [...scoreIds]))
          .all()
          .map((r) => r.id),
  );
  return {
    have: scoreIds.filter((id) => found.has(id)).length,
    missing: scoreIds.filter((id) => !found.has(id)),
  };
}

const sameContent = (c: {
  judgeId: string;
  activityId: string;
  scoreIds: readonly string[];
  phoneCreatedAt: string;
}) =>
  JSON.stringify([
    c.judgeId,
    c.activityId,
    [...c.scoreIds].sort(),
    c.phoneCreatedAt,
  ]);

export function recordClosure(
  db: Db,
  closure: ClosureSubmission,
): ClosureRecorded {
  const event = loadedEvent(db);
  if (!event) return NO_EVENT;

  const existing = db
    .select()
    .from(activityClosures)
    .where(eq(activityClosures.id, closure.id))
    .get();
  if (existing) {
    const same =
      sameContent({
        ...existing,
        scoreIds: JSON.parse(existing.scoreIds) as string[],
      }) === sameContent({ ...closure, judgeId: closure.judge.id });
    if (!same) return conflict("Closure", closure.id);
    return { ok: true, status: "repeat", ...check(db, closure.scoreIds) };
  }
  if (!activityFields(event.bundle, closure.activityId)) {
    return invalid(`Activity ${closure.activityId} isn't in the loaded Event`);
  }

  db.transaction((tx) => {
    upsertJudge(tx, closure.judge);
    const newest = tx
      .select({ seq: max(scoreEntries.receivedSeq) })
      .from(scoreEntries)
      .get();
    tx.insert(activityClosures)
      .values({
        id: closure.id,
        judgeId: closure.judge.id,
        activityId: closure.activityId,
        scoreIds: JSON.stringify(closure.scoreIds),
        afterScoreSeq: newest?.seq ?? 0,
        phoneCreatedAt: closure.phoneCreatedAt,
        receivedAt: new Date(),
      })
      .run();
  });
  return { ok: true, status: "created", ...check(db, closure.scoreIds) };
}

/** A Judge's newest closure at an Activity, as Officials see it. */
export interface ClosureView {
  judgeId: string;
  scoreCount: number;
  /** Score ids the phone saved there that the box doesn't have. */
  missing: string[];
  /** Scores this Judge sent there since closing: more than 0 means they reopened it. */
  scoredSince: number;
  phoneCreatedAt: string;
}

/** The newest closure per Judge at this Activity, in the order the box received them. */
export function closuresAt(db: Db, activityId: string): ClosureView[] {
  const rows = db
    .select()
    .from(activityClosures)
    .where(eq(activityClosures.activityId, activityId))
    .orderBy(asc(activityClosures.receivedSeq))
    .all();
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    newest.delete(row.judgeId);
    newest.set(row.judgeId, row);
  }
  return [...newest.values()].map((row) => {
    const scoreIds = JSON.parse(row.scoreIds) as string[];
    const since = db
      .select({ seq: scoreEntries.receivedSeq })
      .from(scoreEntries)
      .where(
        and(
          eq(scoreEntries.activityId, activityId),
          eq(scoreEntries.judgeId, row.judgeId),
        ),
      )
      .all()
      .filter((e) => e.seq > row.afterScoreSeq).length;
    return {
      judgeId: row.judgeId,
      scoreCount: scoreIds.length,
      missing: check(db, scoreIds).missing,
      scoredSince: since,
      phoneCreatedAt: row.phoneCreatedAt,
    };
  });
}

/** True when an Official should look: scores missing, or the Judge scored again since closing. */
export const closureProblem = (c: ClosureView) =>
  c.missing.length > 0 || c.scoredSince > 0;
