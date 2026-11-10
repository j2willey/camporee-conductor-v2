import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type {
  EventResults,
  OfficialAction,
  ScoringInput,
} from "@camporee-conductor/scoring";
import { asc } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { officialActions } from "./db/schema.ts";
import { resolvedRoster } from "./roster.ts";
import {
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

/** Every score entry, in the order received, with its entrant resolved through the roster's merges (ADR-0027). */
export function resolvedEntries(db: Db): ScoreEntryRow[] {
  const { resolve } = resolvedRoster(db);
  return scoreEntries(db).map((e) => ({
    ...e,
    entrantId: resolve(e.entrantId),
  }));
}

/** An Official action with every entrant it names resolved through merges: a DQ on A applies to B once A is merged. */
export function resolveAction(
  action: OfficialAction,
  resolve: (id: string) => string,
): OfficialAction {
  if (action.type === "finalize") {
    return {
      ...action,
      ranking: action.ranking.map((r) => ({
        ...r,
        entrantId: resolve(r.entrantId),
      })),
    };
  }
  if (action.type === "reassign-entry") {
    return {
      ...action,
      entrantId: resolve(action.entrantId),
      toEntrantId: resolve(action.toEntrantId),
    };
  }
  if ("entrantId" in action) {
    return { ...action, entrantId: resolve(action.entrantId) };
  }
  return action;
}

/**
 * The entries as they count now, for showing: each Activity's applied `reassign-entry` laid over them, apart from
 * the ones logged after the `finalize` freezing it (held). Scoring is given the entries as received instead, and
 * does this itself; this is for the views that list entries by entrant.
 */
export function countedEntries(
  entries: ScoreEntryRow[],
  input: ScoringInput,
  results: EventResults,
): ScoreEntryRow[] {
  const frozenAt = new Map(
    results.activities.flatMap((a) =>
      a.finalizedBy ? [[a.activityId, a.finalizedBy.actionIndex] as const] : [],
    ),
  );
  const moved = new Map<string, string>();
  input.actions.forEach((a, index) => {
    if (a.type !== "reassign-entry") return;
    const frozen = frozenAt.get(a.activityId);
    if (frozen === undefined || index < frozen) {
      moved.set(a.entryId, a.toEntrantId);
    }
  });
  return entries.map((e) => {
    const to = moved.get(e.id);
    return to === undefined ? e : { ...e, entrantId: to };
  });
}

/**
 * The one input to packages/scoring for the Event, so the Overview and the matrix can't drift (#42): every
 * entry, in the order received, with its id and Judge, and every logged action. Scoring decides which entries
 * count: it leaves out an entry for someone not on the roster (reporting it) and applies reassigns (ADR-0019).
 */
export function scoringInput(
  db: Db,
  bundle: CheckedBundle,
  entries: ScoreEntryRow[] = resolvedEntries(db),
  logged: LoggedAction[] = loggedActions(db),
): ScoringInput {
  const roster = resolvedRoster(db);
  return {
    event: bundle.event,
    activities: bundle.activities,
    commonFieldSets: bundle.commonFieldSets,
    entrants: scoringEntrants(bundle, roster),
    entries: entries.map(({ id, judgeId, activityId, entrantId, values }) => ({
      id,
      judgeId,
      activityId,
      entrantId,
      values,
    })),
    actions: logged.map((a) => resolveAction(a.action, roster.resolve)),
  };
}
