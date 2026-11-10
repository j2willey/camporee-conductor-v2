import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Official } from "@camporee-conductor/schema";
import {
  fillVariables,
  inRankOrder,
  newestEntries,
  scoreEvent,
  type FieldValue,
} from "@camporee-conductor/scoring";
import type { Db } from "./db/open.ts";
import { activityFields } from "./bundle-lookup.ts";
import { judgeEvent, type JudgeEvent } from "./judge-event.ts";
import { closureProblem, closuresAt, type ClosureView } from "./closures.ts";
import {
  judgeList,
  roster,
  scoreEntries,
  type JudgeIdentity,
} from "./roster-and-scores.ts";

// What Officials see on the box (#40 PR 3): each Activity's score entries and its ranking. Read-only;
// edits, DQ, finalize, conflicts and standings are #42. Every ranking comes from packages/scoring.

/** An email as Officials are matched: trimmed, any case. */
export const normalEmail = (email: string) => email.trim().toLowerCase();

/** The Official on the loaded Event's list with this email, or undefined. */
export function officialByEmail(
  bundle: CheckedBundle,
  email: string,
): Official | undefined {
  const wanted = normalEmail(email);
  return bundle.officials?.officials.find(
    (o) => normalEmail(o.email) === wanted,
  );
}

/** A Team (with its Group) or a Group, by name; null names for an id that isn't on the roster. */
export interface EntrantName {
  name: string | null;
  group: string | null;
}

export interface OfficialEvent {
  event: JudgeEvent["event"];
  activities: (Omit<JudgeEvent["activities"][number], "fields"> & {
    entryCount: number;
    /** Judges whose newest closure here still stands (#41 PR 6). */
    closedBy: number;
    /** Closures an Official should look at: scores missing, or scored again since. */
    closureProblems: number;
    /** Distinct entrants with at least one score entry. */
    entrantsScored: number;
    /** Distinct Judges with score entries here. */
    judges: number;
    /** Entrants scored by more than one Judge: both kept, newest counts, an Official looks (item 9). */
    conflicts: number;
    /** When the newest entry here was received (ISO), or null with none. */
    lastReceivedAt: string | null;
  })[];
}

/** The distinct Judges who scored each entrant, by entrant id, in the order their first entries were received. */
export function judgesByEntrant(
  entries: { entrantId: string; judgeId: string }[],
): Map<string, Set<string>> {
  const byEntrant = new Map<string, Set<string>>();
  for (const e of entries) {
    const set = byEntrant.get(e.entrantId) ?? new Set<string>();
    set.add(e.judgeId);
    byEntrant.set(e.entrantId, set);
  }
  return byEntrant;
}

/**
 * Entrants scored by more than one different Judge: both entries kept, the newest counts until an Official
 * resolves it (ADR-0027 item 9). One Judge scoring again is a correction, not a conflict.
 */
export function conflictedEntrants(
  entries: { entrantId: string; judgeId: string }[],
): Set<string> {
  return new Set(
    [...judgesByEntrant(entries)]
      .filter(([, judges]) => judges.size > 1)
      .map(([entrantId]) => entrantId),
  );
}

export function officialEvent(
  db: Db,
  bundle: CheckedBundle,
  entries = scoreEntries(db),
): OfficialEvent {
  const { event, activities } = judgeEvent(bundle);
  return {
    event,
    activities: activities.map(({ id, title, competition }) => {
      const closures = closuresAt(db, id);
      const here = entries.filter((e) => e.activityId === id);
      const scoredEntrants = new Set(here.map((e) => e.entrantId));
      const newest = here.reduce<Date | null>(
        (latest, e) =>
          latest && latest >= e.receivedAt ? latest : e.receivedAt,
        null,
      );
      return {
        id,
        title,
        competition,
        entryCount: here.length,
        entrantsScored: scoredEntrants.size,
        judges: new Set(here.map((e) => e.judgeId)).size,
        conflicts: conflictedEntrants(here).size,
        lastReceivedAt: newest ? newest.toISOString() : null,
        closedBy: closures.filter((c) => c.scoredSince === 0).length,
        closureProblems: closures.filter(closureProblem).length,
      };
    }),
  };
}

export interface MatrixRow {
  entrantId: string;
  entrant: EntrantName;
  /** At least one entry here. */
  scored: boolean;
  /** The Final Ranking; null when DQ'd or unscored. */
  place: number | null;
  total: number | null;
  disqualified: boolean;
  /** The counting (newest) entry's values; null when unscored. */
  values: Record<string, FieldValue> | null;
  /** The counting entry's Judge: name and home unit, never the email. */
  judge: { name: string; homeGroup?: string } | null;
  /** When the box received the counting entry (ISO). */
  receivedAt: string | null;
  /** All entries for this entrant here: every version is kept. */
  entryCount: number;
  conflict: boolean;
  /** Distinct Judges who scored it, first received first. */
  judges: { name: string; homeGroup?: string }[];
}

export interface OfficialActivity {
  activity: OfficialEvent["activities"][number];
  /** Every field scored at the Activity, Common Fields included, to show values by label. */
  fields: { id: string; label: string }[];
  /** Best first, from packages/scoring (`scoreEvent`, listed by `inRankOrder`). */
  ranking: {
    entrantId: string;
    entrant: EntrantName;
    /** The Final Ranking; null when DQ'd. */
    place: number | null;
    total: number;
    /** Placement points. */
    points: number;
    disqualified: boolean;
  }[];
  /**
   * The score matrix (#42 PR 2a): one row per entrant of the Activity's Competition. Scored rows come first in
   * ranking order, then unscored ones in roster order. Place, total and DQ are from packages/scoring.
   */
  matrix: MatrixRow[];
  /** Every score entry received, in the order received. */
  entries: {
    id: string;
    receivedSeq: number;
    /** The Judge's name and home unit (#41 PR 5): Judges' emails aren't served. */
    judge: { name: string; homeGroup?: string };
    entrantId: string;
    entrant: EntrantName;
    values: Record<string, FieldValue>;
    phoneCreatedAt: string;
    /** The newest received for this entrant, so the one the ranking uses (ADR-0027 item 9). */
    counts: boolean;
  }[];
  /** Each Judge's newest closure here (#41 PR 6), in the order received. */
  closures: (Omit<ClosureView, "judgeId"> & {
    judge: { name: string; homeGroup?: string };
  })[];
}

/** One Activity for Officials, or undefined if the Event doesn't have it. */
export function officialActivity(
  db: Db,
  bundle: CheckedBundle,
  activityId: string,
): OfficialActivity | undefined {
  const found = activityFields(bundle, activityId);
  if (!found) return undefined;
  const all = scoreEntries(db);
  const listed = officialEvent(db, bundle, all).activities.find(
    (a) => a.id === activityId,
  );
  if (!listed) return undefined;

  const { groups, teams } = roster(db);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const entrantName = (id: string): EntrantName => {
    const team = teamById.get(id);
    if (team) {
      return { name: team.name, group: groupName.get(team.groupId) ?? null };
    }
    return { name: groupName.get(id) ?? null, group: null };
  };

  const newest = newestEntries(all);
  const results = scoreEvent({
    event: bundle.event,
    activities: bundle.activities,
    commonFieldSets: bundle.commonFieldSets,
    entrants: bundle.event.competitions.flatMap((c) =>
      (c.level === "team" ? teams : groups).map((e) => ({
        id: e.id,
        competitionId: c.id,
      })),
    ),
    entries: newest,
    // Official actions are logged on the box with #42.
    actions: [],
  }).activities.find((a) => a.activityId === activityId);

  const judgeById = new Map(judgeList(db).map((j) => [j.id, j]));
  const counting = new Set(newest.map((e) => e.id));

  const here = all.filter((e) => e.activityId === activityId);
  const conflicts = conflictedEntrants(here);
  const judgeIdsByEntrant = judgesByEntrant(here);
  const countingByEntrant = new Map(
    newest
      .filter((e) => e.activityId === activityId)
      .map((e) => [e.entrantId, e]),
  );
  const ordered = results ? inRankOrder(results) : [];
  const resultById = new Map(ordered.map((r) => [r.entrantId, r]));
  const competition = bundle.event.competitions.find(
    (c) => c.id === listed.competition.id,
  );
  const entrants = competition?.level === "team" ? teams : groups;
  const matrixRow = (entrantId: string): MatrixRow => {
    const result = resultById.get(entrantId);
    const entry = countingByEntrant.get(entrantId);
    return {
      entrantId,
      entrant: entrantName(entrantId),
      scored: entry !== undefined,
      place: result && !result.disqualified ? result.finalRank : null,
      total: result ? result.total : null,
      disqualified: result?.disqualified ?? false,
      values: entry ? entry.values : null,
      judge: entry
        ? judgeShown(judgeById.get(entry.judgeId), entry.judgeId)
        : null,
      receivedAt: entry ? entry.receivedAt.toISOString() : null,
      entryCount: here.filter((e) => e.entrantId === entrantId).length,
      conflict: conflicts.has(entrantId),
      judges: [...(judgeIdsByEntrant.get(entrantId) ?? [])].map((id) =>
        judgeShown(judgeById.get(id), id),
      ),
    };
  };
  const rankOrder = ordered.map((r) => r.entrantId);
  const matrix = [
    ...rankOrder,
    ...entrants.map((e) => e.id).filter((id) => !resultById.has(id)),
  ].map(matrixRow);
  return {
    activity: listed,
    fields: fillVariables(found.fields, found.activity.variables ?? {}).map(
      (f) => ({ id: f.id, label: f.label }),
    ),
    ranking: (results ? inRankOrder(results) : []).map((r) => ({
      entrantId: r.entrantId,
      entrant: entrantName(r.entrantId),
      place: r.disqualified ? null : r.finalRank,
      total: r.total,
      points: r.points,
      disqualified: r.disqualified,
    })),
    matrix,
    entries: here.map((e) => ({
      id: e.id,
      receivedSeq: e.receivedSeq,
      judge: judgeShown(judgeById.get(e.judgeId), e.judgeId),
      entrantId: e.entrantId,
      entrant: entrantName(e.entrantId),
      values: e.values,
      phoneCreatedAt: e.phoneCreatedAt,
      counts: counting.has(e.id),
    })),
    closures: closuresAt(db, activityId).map(({ judgeId, ...closure }) => ({
      judge: judgeShown(judgeById.get(judgeId), judgeId),
      ...closure,
    })),
  };
}

/** A Judge as Officials see them: name and home unit, never the email. */
function judgeShown(
  judge: JudgeIdentity | undefined,
  id: string,
): { name: string; homeGroup?: string } {
  if (!judge) return { name: id };
  return judge.homeGroup === undefined
    ? { name: judge.name }
    : { name: judge.name, homeGroup: judge.homeGroup };
}
