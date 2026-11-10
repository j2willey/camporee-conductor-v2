import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { OfficialAction, ScoringInput } from "@camporee-conductor/scoring";
import { asc } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { officialActions } from "./db/schema.ts";
import {
  roster,
  scoreEntries,
  scoringEntrants,
  type ScoreEntryRow,
} from "./roster-and-scores.ts";

// The Event's scoring input and the Official action log it reads. Its own module so official-actions.ts (which
// checks a new action against the results) and official-view.ts (which shows them) don't import each other.

/** One logged Official action, as stored. */
export interface LoggedAction {
  seq: number;
  id: string;
  officialEmail: string;
  action: OfficialAction;
  clientCreatedAt: string;
  receivedAt: Date;
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

/**
 * The one input to packages/scoring for the Event, so the Overview and the matrix can't drift (#42): every
 * on-roster entry, in the order received, with its id and Judge, and every logged action. An entry for
 * someone not on the roster isn't scored; the matrix shows it on a row of its own.
 */
export function scoringInput(
  db: Db,
  bundle: CheckedBundle,
  entries: ScoreEntryRow[] = scoreEntries(db),
  logged: LoggedAction[] = loggedActions(db),
): ScoringInput {
  const entrants = scoringEntrants(bundle, roster(db));
  const rosterIds = new Set(entrants.map((e) => `${e.competitionId} ${e.id}`));
  const competitionOf = new Map(
    bundle.event.activities.map((a) => [a.activityId, a.competitionId]),
  );
  return {
    event: bundle.event,
    activities: bundle.activities,
    commonFieldSets: bundle.commonFieldSets,
    entrants,
    entries: entries
      .filter((e) =>
        rosterIds.has(`${competitionOf.get(e.activityId)} ${e.entrantId}`),
      )
      .map(({ id, judgeId, activityId, entrantId, values }) => ({
        id,
        judgeId,
        activityId,
        entrantId,
        values,
      })),
    actions: logged.map((a) => a.action),
  };
}
