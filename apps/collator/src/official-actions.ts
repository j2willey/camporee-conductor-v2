import type { CheckedBundle } from "@camporee-conductor/cartridge";
import {
  actionProblem,
  type OfficialAction,
} from "@camporee-conductor/scoring";
import { asc, eq } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { officialActions } from "./db/schema.ts";
import {
  conflict,
  invalid,
  roster,
  scoringEntrants,
  type Recorded,
} from "./roster-and-scores.ts";

// The log of Official actions (ADR-0019, #42). Append-only: an Official's override is a new row, never an
// edit to a Judge's score entry or to an earlier action. The latest of a type wins, in `seq` order.

/** One logged Official action, as stored. */
export interface LoggedAction {
  seq: number;
  id: string;
  officialEmail: string;
  action: OfficialAction;
  clientCreatedAt: string;
  receivedAt: Date;
}

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
  const problem = actionProblem(
    {
      event: bundle.event,
      activities: bundle.activities,
      commonFieldSets: bundle.commonFieldSets,
      entrants: scoringEntrants(bundle, roster(db)),
    },
    submission.action,
  );
  if (problem !== undefined) return invalid(problem);
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

/** Every logged Official action, oldest first. */
export function loggedActions(db: Db): LoggedAction[] {
  return db
    .select()
    .from(officialActions)
    .orderBy(asc(officialActions.seq))
    .all()
    .map((row) => ({
      ...row,
      action: JSON.parse(row.action) as OfficialAction,
    }));
}
