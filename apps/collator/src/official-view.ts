import type { CheckedBundle } from "@camporee-conductor/cartridge";
import {
  fillVariables,
  finalizeRanking,
  inRankOrder,
  newestEntries,
  scoreEvent,
  valueProblem,
  type EntryResult,
  type FieldValue,
  type FinalizedResult,
} from "@camporee-conductor/scoring";
import type { Db } from "./db/open.ts";
import { activityFields } from "./bundle-lookup.ts";
import { officialByEmail } from "./officials.ts";
import { judgeEvent, type JudgeEvent } from "./judge-event.ts";
import { closureProblem, closuresAt, type ClosureView } from "./closures.ts";
import { resolvedRoster } from "./roster.ts";
import {
  countedEntries,
  loggedActions,
  resolvedEntries,
  scoringInput,
  type LoggedAction,
} from "./scoring-input.ts";
import { judgeList, type JudgeIdentity } from "./roster-and-scores.ts";

// What Officials see on the box (#40 PR 3): each Activity's score entries and its ranking. Every ranking comes from
// packages/scoring; Official actions are logged in official-actions.ts.

/** An entrant's name from the roster: a Team with its Group, or a Group; null names for an id that isn't on it. */
export function entrantNamer(db: Db): (id: string) => EntrantName {
  const { groups, teams } = resolvedRoster(db);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const teamById = new Map(teams.map((t) => [t.id, t]));
  return (id) => {
    const team = teamById.get(id);
    if (team) {
      return { name: team.name, group: groupName.get(team.groupId) ?? null };
    }
    return { name: groupName.get(id) ?? null, group: null };
  };
}

/** Who logged the action at an index in the log, and when and why; blank for an index past the log. */
export function actedOnLog(
  db: Db,
  bundle: CheckedBundle,
  logged: LoggedAction[],
): (actionIndex: number) => Acted {
  return (actionIndex) => {
    const row = logged[actionIndex];
    if (!row) return { by: "", at: "" };
    const notes = (row.action as { notes?: string }).notes;
    return {
      by:
        officialByEmail(db, bundle, row.officialEmail)?.name ??
        row.officialEmail,
      at: row.receivedAt.toISOString(),
      ...(notes !== undefined && { notes }),
    };
  };
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
    /** An Official has finalized the Activity (ADR-0019). */
    finalized: boolean;
    /** Exhibitions are recorded as results, not scored (ADR-0027). */
    scoringType: "ranked" | "exhibition";
    /** Exhibitions only: rows in the latest saved results. */
    resultCount?: number;
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

export function officialEvent(
  db: Db,
  bundle: CheckedBundle,
  entries = resolvedEntries(db),
): OfficialEvent {
  const { event, activities } = judgeEvent(bundle);
  const input = scoringInput(db, bundle, entries);
  const results = scoreEvent(input);
  const scored = results.activities;
  const counted = countedEntries(entries, results);
  return {
    event,
    activities: activities.map(({ id, title, competition }) => {
      const closures = closuresAt(db, id);
      const here = counted.filter((e) => e.activityId === id);
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
        finalized: scored.find((a) => a.activityId === id)?.finalized ?? false,
        scoringType: "ranked",
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
  /**
   * Placement points at this Activity (0 when DQ'd); null when unscored.
   */
  points: number | null;
  /** Rank by total before any Official override; null when DQ'd or unscored. */
  provisionalRank: number | null;
  /** The Official's `set-final-rank` for this entrant here, with who and when; null with none. */
  rankOverride: (Acted & { rank: number; state: "applied" | "held" }) | null;
  /** The Official's `adjust-points`; null with none. */
  adjustment: (Acted & { points: number; state: "applied" | "held" }) | null;
  /**
   * The latest per-Activity `disqualify` with who and when (ADR-0019). Null with none, and for a reinstate that
   * applies (nothing to show); a held reinstate or DQ is there, with state "held".
   */
  dq: (Acted & { disqualified: boolean; state: "applied" | "held" }) | null;
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
  /** An Official's standing choice of which entry counts, with who and when; null with none (ADR-0019). */
  choice: {
    entryId: string;
    judge: { name: string; homeGroup?: string };
    by: string;
    at: string;
    notes?: string;
    state: "applied" | "reopened" | "held";
  } | null;
  /** Every entry for this entrant here, in received order, for choosing between them. */
  candidates: {
    entryId: string;
    judge: { name: string; homeGroup?: string };
    receivedAt: string;
    counts: boolean;
    newest: boolean;
  }[];
  /** Reassignments into or out of this row's entrant here, with who and when (ADR-0019). */
  moves: {
    entryId: string;
    /** "here": an entry moved onto this row; "away": one moved off it. */
    direction: "here" | "away";
    fromId: string;
    fromName: string | null;
    toId: string;
    toName: string | null;
    by: string;
    at: string;
    notes?: string;
    state: "applied" | "held";
  }[];
  /** Corrections on an entry an Official chose not to count: they come back if it's chosen again. */
  notCounting: SupersededCorrection[];
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

/** Who logged an action and when (ISO), with their reason. */
export interface Acted {
  by: string;
  at: string;
  notes?: string;
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
  /** Who finalized the Activity and when; null when it isn't finalized. */
  finalized: Acted | null;
  /** The ranking the Official would freeze now: the laptop sends it back with `finalize` (ADR-0019 2026-11-10). */
  finalizeRanking: FinalizedResult[];
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
  const original = resolvedEntries(db);
  const listed = officialEvent(db, bundle, original).activities.find(
    (a) => a.id === activityId,
  );
  if (!listed) return undefined;

  const { groups, teams } = resolvedRoster(db);
  const entrantName = entrantNamer(db);
  const logged = loggedActions(db);
  const input = scoringInput(db, bundle, original, logged);
  const scoredEvent = scoreEvent(input);
  // Where each entry counts now (reassigns applied), for listing entries by entrant.
  const all = countedEntries(original, scoredEvent);
  const newest = newestEntries(all);
  const results = scoredEvent.activities.find(
    (a) => a.activityId === activityId,
  );
  // Entries for someone who isn't on the roster aren't scored; scoring reports them (ADR-0019).
  const offRosterIds = new Set(
    (results?.offRoster ?? []).map((o) => o.entryId),
  );

  const judgeById = new Map(judgeList(db).map((j) => [j.id, j]));

  const here = all.filter((e) => e.activityId === activityId);
  const judgeIdsByEntrant = judgesByEntrant(here);
  const countingByEntrant = new Map(
    newest
      .filter((e) => e.activityId === activityId)
      .map((e) => [e.entrantId, e]),
  );
  const countingIds = new Set(
    (results?.entries ?? []).flatMap((r) =>
      r.entryId === undefined ? [] : [r.entryId],
    ),
  );
  const ordered = results ? inRankOrder(results) : [];
  const resultById = new Map(ordered.map((r) => [r.entrantId, r]));
  // The entry that counts comes from scoring's report; an off-roster entry isn't scored, so the newest counts.
  const entryById = new Map(here.map((e) => [e.id, e]));
  const countingEntry = (entrantId: string) => {
    const reported = resultById.get(entrantId)?.entryId;
    return (
      (reported === undefined ? undefined : entryById.get(reported)) ??
      countingByEntrant.get(entrantId)
    );
  };
  const competition = bundle.event.competitions.find(
    (c) => c.id === listed.competition.id,
  );
  const entrants = competition?.level === "team" ? teams : groups;
  const fieldList = fillVariables(found.fields, found.activity.variables ?? {});
  const officialName = (a: LoggedAction): string =>
    officialByEmail(db, bundle, a.officialEmail)?.name ?? a.officialEmail;
  const actedOn = actedOnLog(db, bundle, logged);
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
    state: "superseded" | "held" | "not-counting",
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
  const choiceOf = (r: EntryResult): MatrixRow["choice"] => {
    const row = r.choice ? logged[r.choice.actionIndex] : undefined;
    if (!r.choice || !row) return null;
    const notes = (row.action as { notes?: string }).notes;
    return {
      entryId: r.choice.entryId,
      judge: judgeShown(
        judgeById.get(entryById.get(r.choice.entryId)?.judgeId ?? ""),
        entryById.get(r.choice.entryId)?.judgeId ?? "",
      ),
      by: officialName(row),
      at: row.receivedAt.toISOString(),
      ...(notes !== undefined && { notes }),
      state: r.choice.state,
    };
  };
  const matrixRow = (entrantId: string): MatrixRow => {
    const result = resultById.get(entrantId);
    const entry = countingEntry(entrantId);
    const theirs = here.filter((e) => e.entrantId === entrantId);
    const newestHere = theirs.at(-1);
    const judgeIds = judgeIdsByEntrant.get(entrantId) ?? new Set<string>();
    return {
      entrantId,
      entrant: entrantName(entrantId),
      scored: entry !== undefined,
      place: result && !result.disqualified ? result.finalRank : null,
      total: result ? result.total : null,
      disqualified: result?.disqualified ?? false,
      points: result ? result.points : null,
      provisionalRank:
        result && !result.disqualified ? result.provisionalRank : null,
      rankOverride: result?.rankOverride
        ? {
            ...actedOn(result.rankOverride.actionIndex),
            rank: result.rankOverride.rank,
            state: result.rankOverride.state,
          }
        : null,
      adjustment: result?.adjustment
        ? {
            ...actedOn(result.adjustment.actionIndex),
            points: result.adjustment.points,
            state: result.adjustment.state,
          }
        : null,
      // A reinstate that applies has nothing to show; a held one (either way) does.
      dq:
        result?.dq && (result.dq.disqualified || result.dq.state === "held")
          ? {
              ...actedOn(result.dq.actionIndex),
              disqualified: result.dq.disqualified,
              state: result.dq.state,
            }
          : null,
      onRoster: true,
      entryId: entry ? (result?.entryId ?? entry.id) : null,
      // Everything below comes from scoring's report. An off-roster entry isn't scored: shown as entered.
      values: entry ? (result?.values ?? entry.values) : null,
      corrections: result ? originOf(result) : {},
      superseded: result ? listOf(result, "superseded") : [],
      held: result ? listOf(result, "held") : [],
      choice: result ? choiceOf(result) : null,
      candidates: theirs.map((e) => ({
        entryId: e.id,
        judge: judgeShown(judgeById.get(e.judgeId), e.judgeId),
        receivedAt: e.receivedAt.toISOString(),
        counts: e.id === entry?.id,
        newest: e.id === newestHere?.id,
      })),
      moves: (result?.reassignments ?? []).map((m) => {
        const acted = actedOn(m.actionIndex);
        return {
          entryId: m.entryId,
          direction:
            m.toEntrantId === entrantId ? ("here" as const) : ("away" as const),
          fromId: m.fromEntrantId,
          fromName: entrantName(m.fromEntrantId).name,
          toId: m.toEntrantId,
          toName: entrantName(m.toEntrantId).name,
          ...acted,
          state: m.state,
        };
      }),
      notCounting: result ? listOf(result, "not-counting") : [],
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
  const offRoster = (results?.offRoster ?? []).map((o) => o.entrantId);
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
    finalized: results?.finalizedBy
      ? actedOn(results.finalizedBy.actionIndex)
      : null,
    finalizeRanking: results ? finalizeRanking(results) : [],
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
      counts: countingIds.has(e.id) || offRosterIds.has(e.id),
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
