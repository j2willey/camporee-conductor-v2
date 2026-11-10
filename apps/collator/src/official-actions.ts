import type { CheckedBundle } from "@camporee-conductor/cartridge";
import {
  actionProblem,
  finalizeRanking,
  scoreEvent,
  type OfficialAction,
} from "@camporee-conductor/scoring";
import { eq } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { officialActions } from "./db/schema.ts";
import {
  loggedActions,
  scoringInput,
  type LoggedAction,
} from "./scoring-input.ts";
import {
  conflict,
  invalid,
  roster,
  scoreEntries,
  scoringEntrants,
  type Recorded,
} from "./roster-and-scores.ts";

// The log of Official actions (ADR-0019, #42). Append-only: an Official's override is a new row, never an
// edit to a Judge's score entry or to an earlier action. The latest of a type wins, in `seq` order.

export interface ActionSubmission {
  id: string;
  /** `normalEmail()` of the Official. */
  officialEmail: string;
  action: OfficialAction;
  clientCreatedAt: string;
}

/** JSON with object keys sorted, so the same content compares equal however a client ordered it. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const contentOf = (s: {
  officialEmail: string;
  action: unknown;
  clientCreatedAt: string;
}) => canonical([s.officialEmail, s.action, s.clientCreatedAt]);

/** Logs an Official action after `actionProblem` (packages/scoring) accepts it. A resend of the same id is a repeat. */
export function recordOfficialAction(
  db: Db,
  bundle: CheckedBundle,
  submission: ActionSubmission,
): Recorded {
  const existing = db
    .select()
    .from(officialActions)
    .where(eq(officialActions.id, submission.id))
    .get();
  if (existing) {
    const same =
      contentOf({
        ...existing,
        action: JSON.parse(existing.action) as unknown,
      }) === contentOf(submission);
    return same
      ? { ok: true, status: "repeat" }
      : conflict("Official action", submission.id);
  }
  const { action } = submission;
  const entries = scoreEntries(db);
  const problem = actionProblem(
    {
      event: bundle.event,
      activities: bundle.activities,
      commonFieldSets: bundle.commonFieldSets,
      entrants: scoringEntrants(bundle, roster(db)),
      entries,
    },
    submission.action,
  );
  if (problem !== undefined) return invalid(problem);
  // A choice covers the entries the Official saw: a newer one means a stale view (ADR-0019 2026-11-10).
  if (action.type === "choose-entry") {
    const newest = entries.findLast(
      (e) =>
        e.activityId === action.activityId && e.entrantId === action.entrantId,
    );
    if (newest?.id !== action.newestEntryId) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "A newer entry has arrived since you loaded this; reload and choose again.",
      };
    }
  }
  // A finalize freezes what the Official saw: refuse it if the results have moved since (ADR-0019 2026-11-10).
  if (action.type === "finalize") {
    const now = scoreEvent(scoringInput(db, bundle, entries)).activities.find(
      (a) => a.activityId === action.activityId,
    );
    if (!now || canonical(finalizeRanking(now)) !== canonical(action.ranking)) {
      return {
        ok: false,
        reason: "conflict",
        message:
          "The results changed since you loaded this; reload and finalize again.",
      };
    }
  }
  db.insert(officialActions)
    .values({
      id: submission.id,
      officialEmail: submission.officialEmail,
      action: JSON.stringify(submission.action),
      clientCreatedAt: submission.clientCreatedAt,
      receivedAt: new Date(),
    })
    .run();
  return { ok: true, status: "created" };
}
