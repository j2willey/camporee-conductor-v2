import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Official } from "@camporee-conductor/schema";
import {
  fillVariables,
  inRankOrder,
  newestEntries,
  scoreEvent,
  valueProblem,
  type EntryResult,
  type FieldValue,
  type ScoringInput,
} from "@camporee-conductor/scoring";
import type { Db } from "./db/open.ts";
import { activityFields } from "./bundle-lookup.ts";
import { judgeEvent, type JudgeEvent } from "./judge-event.ts";
import { closureProblem, closuresAt, type ClosureView } from "./closures.ts";
import { loggedActions, type LoggedAction } from "./official-actions.ts";
import {
  judgeList,
  roster,
  scoreEntries,
  scoringEntrants,
  type JudgeIdentity,
  type ScoreEntryRow,
} from "./roster-and-scores.ts";

// What Officials see on the box (#40 PR 3): each Activity's score entries and its ranking. Every ranking comes from
// packages/scoring; Official actions are logged in official-actions.ts.

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
    /** Entrants whose conflict is unresolved or reopened: two Judges scored, no standing choice (ADR-0019). */
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

export function officialEvent(
  db: Db,
  bundle: CheckedBundle,
  entries = scoreEntries(db),
): OfficialEvent {
  const { event, activities } = judgeEvent(bundle);
  const scored = scoreEvent(scoringInput(db, bundle, entries)).activities;
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
        conflicts:
          scored
            .find((a) => a.activityId === id)
            ?.entries.filter(
              (e) => e.conflict === "unresolved" || e.conflict === "reopened",
            ).length ?? 0,
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
  /** Who DQ'd it and when, from the latest logged `disqualify` here (ADR-0019); null when not DQ'd. */
  dq: { by: string; at: string; notes?: string } | null;
  /** False for an entry whose entrant isn't on the roster: shown, but not ranked and not DQ-able. */
  onRoster: boolean;
  /** The counting (newest) entry's id; null when unscored. Corrections name it. */
  entryId: string | null;
  /** The counting entry's values with the Officials' corrections laid over them; null when unscored. */
  values: Record<string, FieldValue> | null;
  /** The corrections in effect on the counting entry, by field id (ADR-0019). */
  corrections: Record<string, FieldCorrection>;
  /** Corrections made to an older entry of this entrant: a newer entry counts now, so an Official looks again. */
  superseded: SupersededCorrection[];
  /** Corrections logged after the `finalize` that freezes the Activity: they wait for `unfinalize`. */
  held: SupersededCorrection[];
  /** The counting entry's Judge: name and home unit, never the email. */
  judge: { name: string; homeGroup?: string } | null;
  /** When the box received the counting entry (ISO). */
  receivedAt: string | null;
  /** All entries for this entrant here: every version is kept. */
  entryCount: number;
  /** Scoring's conflict state for the entrant here (ADR-0019 2026-11-10). */
  conflict: EntryResult["conflict"];
  /** Distinct Judges who scored it, first received first. */
  judges: { name: string; homeGroup?: string }[];
}

/** An Official's value for one field of the counting entry, with the Judge's original. */
export interface FieldCorrection {
  /** The Judge's value; null when blank or missing. */
  original: FieldValue;
  by: string;
  /** When the box received the correction (ISO). */
  at: string;
  notes?: string;
  /** What's off about the value, e.g. outside the field's range. It's allowed: the Official decides. */
  warning?: string;
}

/** An effective correction that isn't laid over the values: its entry doesn't count, or it's held. */
export interface SupersededCorrection {
  entryId: string;
  fieldId: string;
  label: string;
  value: FieldValue;
  by: string;
  at: string;
  notes?: string;
}

export interface OfficialActivity {
  activity: OfficialEvent["activities"][number];
  /** Every field scored at the Activity, Common Fields included, to show values by label. */
  fields: {
    id: string;
    label: string;
    type: string;
    /** A select field's choices. */
    options?: string[];
  }[];
  /**
   * The score matrix (#42 PR 2a): one row per entrant of the Activity's Competition. Scored rows come first in
   * ranking order (from packages/scoring: `scoreEvent`, listed by `inRankOrder`), then unscored ones in roster
   * order, then entries whose entrant isn't on the roster (PR 2b). Place, total and DQ are from packages/scoring.
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
  const logged = loggedActions(db);
  const input = scoringInput(db, bundle, all, logged);
  const rosterIds = new Set(
    input.entrants.map((e) => `${e.competitionId} ${e.id}`),
  );
  const competitionOf = new Map(
    bundle.event.activities.map((a) => [a.activityId, a.competitionId]),
  );
  const onRoster = (activity: string, entrantId: string): boolean =>
    rosterIds.has(`${competitionOf.get(activity)} ${entrantId}`);
  const results = scoreEvent(input).activities.find(
    (a) => a.activityId === activityId,
  );

  const judgeById = new Map(judgeList(db).map((j) => [j.id, j]));
  const counting = new Set(newest.map((e) => e.id));

  const here = all.filter((e) => e.activityId === activityId);
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
  const dqOf = (entrantId: string): MatrixRow["dq"] => {
    const latest = logged.findLast(
      (a) =>
        a.action.type === "disqualify" &&
        a.action.activityId === activityId &&
        a.action.entrantId === entrantId,
    );
    if (!latest || latest.action.type !== "disqualify") return null;
    if (!latest.action.disqualified) return null;
    const official = officialByEmail(bundle, latest.officialEmail);
    return {
      by: official?.name ?? latest.officialEmail,
      at: latest.receivedAt.toISOString(),
      ...(latest.action.notes !== undefined && { notes: latest.action.notes }),
    };
  };
  const fieldList = fillVariables(found.fields, found.activity.variables ?? {});
  const officialName = (a: LoggedAction): string =>
    officialByEmail(bundle, a.officialEmail)?.name ?? a.officialEmail;
  const originOf = (r: EntryResult): MatrixRow["corrections"] => {
    const result: MatrixRow["corrections"] = {};
    for (const c of r.corrections) {
      if (c.state !== "applied") continue;
      const row = logged[c.actionIndex];
      if (!row) continue;
      const field = fieldList.find((f) => f.id === c.fieldId);
      const warning = field ? valueProblem(field, c.value) : undefined;
      const notes = (row.action as { notes?: string }).notes;
      result[c.fieldId] = {
        original: c.original,
        by: officialName(row),
        at: row.receivedAt.toISOString(),
        ...(notes !== undefined && { notes }),
        ...(warning !== undefined && { warning }),
      };
    }
    return result;
  };
  const listOf = (
    r: EntryResult,
    state: "superseded" | "held",
  ): SupersededCorrection[] =>
    r.corrections.flatMap((c) => {
      const row = logged[c.actionIndex];
      if (c.state !== state || !row) return [];
      const notes = (row.action as { notes?: string }).notes;
      return [
        {
          entryId: c.entryId,
          fieldId: c.fieldId,
          label: fieldList.find((f) => f.id === c.fieldId)?.label ?? c.fieldId,
          value: c.value,
          by: officialName(row),
          at: row.receivedAt.toISOString(),
          ...(notes !== undefined && { notes }),
        },
      ];
    });
  const matrixRow = (entrantId: string): MatrixRow => {
    const result = resultById.get(entrantId);
    const entry = countingByEntrant.get(entrantId);
    const judgeIds = judgeIdsByEntrant.get(entrantId) ?? new Set<string>();
    return {
      entrantId,
      entrant: entrantName(entrantId),
      scored: entry !== undefined,
      place: result && !result.disqualified ? result.finalRank : null,
      total: result ? result.total : null,
      disqualified: result?.disqualified ?? false,
      dq: result?.disqualified ? dqOf(entrantId) : null,
      onRoster: true,
      entryId: entry ? (result?.entryId ?? entry.id) : null,
      // Everything below comes from scoring's report. An off-roster entry isn't scored: shown as entered.
      values: entry ? (result?.values ?? entry.values) : null,
      corrections: result ? originOf(result) : {},
      superseded: result ? listOf(result, "superseded") : [],
      held: result ? listOf(result, "held") : [],
      judge: entry
        ? judgeShown(judgeById.get(entry.judgeId), entry.judgeId)
        : null,
      receivedAt: entry ? entry.receivedAt.toISOString() : null,
      entryCount: here.filter((e) => e.entrantId === entrantId).length,
      conflict: result?.conflict ?? (judgeIds.size > 1 ? "unresolved" : "none"),
      judges: [...judgeIds].map((id) => judgeShown(judgeById.get(id), id)),
    };
  };
  const rankOrder = ordered.map((r) => r.entrantId);
  const offRoster = [...countingByEntrant.keys()].filter(
    (id) => !onRoster(activityId, id),
  );
  const matrix = [
    ...[
      ...rankOrder,
      ...entrants.map((e) => e.id).filter((id) => !resultById.has(id)),
    ].map(matrixRow),
    ...offRoster.map((id): MatrixRow => ({
      ...matrixRow(id),
      place: null,
      total: null,
      onRoster: false,
    })),
  ];
  return {
    activity: listed,
    fields: fieldList.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      ...(f.type === "select" && { options: f.config?.options ?? [] }),
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
