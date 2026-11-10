import type { Activity } from "@camporee-conductor/schema";
import { actionProblem } from "./action-checks.ts";
import { awardRecipients } from "./awards.ts";
import {
  correctedValues,
  entryTotal,
  mergeCommonFields,
  metricValue,
  unreadableStopwatch,
} from "./fields.ts";
import {
  DEFAULT_PLACEMENT_POINTS,
  placementPoints,
  rankingFor,
} from "./ranking.ts";
import type {
  ActivityResults,
  CompetitionStandings,
  EntryResult,
  EventResults,
  OfficialAction,
  ScoreEntry,
  ScoringInput,
  ScoringWarning,
  Standing,
} from "./types.ts";

type ActionOf<T extends OfficialAction["type"]> = Extract<
  OfficialAction,
  { type: T }
>;

/** The latest logged action of this type, or undefined. Later actions supersede earlier ones. */
function latest<T extends OfficialAction["type"]>(
  actions: readonly OfficialAction[],
  type: T,
): ActionOf<T> | undefined {
  return actions.findLast((a): a is ActionOf<T> => a.type === type);
}

/**
 * The key an action is effective under: the latest `disqualify` per entrant and Activity (or overall), and
 * the latest `set-field-value` or `revert-field-value` per entry and field. Undefined for other types.
 */
function effectiveKey(a: OfficialAction): string | undefined {
  if (a.type === "disqualify") {
    return `disqualify ${a.activityId ?? ""} ${a.entrantId}`;
  }
  if (a.type === "set-field-value" || a.type === "revert-field-value") {
    return `correction ${a.activityId} ${a.entrantId} ${a.entryId} ${a.fieldId}`;
  }
  return undefined;
}

/**
 * Leaves out each invalid effective `disqualify` and field correction (the latest for its key) with a
 * warning from `actionProblem`; every other action passes through in log order (ADR-0019, #24).
 */
function validActions(input: ScoringInput): {
  actions: readonly OfficialAction[];
  warnings: ScoringWarning[];
} {
  const effective = new Map<string, OfficialAction>();
  for (const a of input.actions) {
    const key = effectiveKey(a);
    if (key !== undefined) effective.set(key, a);
  }
  const warnings: ScoringWarning[] = [];
  const invalid = new Set<string>();
  for (const [key, action] of effective) {
    const message = actionProblem(input, action);
    if (message === undefined) continue;
    invalid.add(key);
    warnings.push({ action, message });
  }
  return {
    actions: input.actions.filter((a) => {
      const key = effectiveKey(a);
      return key === undefined || !invalid.has(key);
    }),
    warnings,
  };
}

/** Scores a whole Event. Pure: the same input always gives the same results (ADR-0019). */
export function scoreEvent(given: ScoringInput): EventResults {
  const checked = validActions(given);
  const input = { ...given, actions: checked.actions };
  const activityById = new Map(input.activities.map((a) => [a.id, a]));
  const ranking = rankingFor(input.event.tieNumbering);
  const competitionById = new Map(
    input.event.competitions.map((c) => [c.id, c]),
  );

  const finalization = finalizations(input, activityById);
  const finalized = finalization.finalized;
  const warnings: ScoringWarning[] = [
    ...checked.warnings,
    ...finalization.warnings,
  ];
  const activities: ActivityResults[] = [];
  for (const { activityId, competitionId } of input.event.activities) {
    const activity = activityById.get(activityId);
    const competition = competitionById.get(competitionId);
    if (!activity) throw new Error(`Activity ${activityId} isn't given`);
    if (!competition)
      throw new Error(`Competition ${competitionId} isn't given`);
    const fields = mergeCommonFields(
      activity,
      competition,
      input.commonFieldSets,
    );
    // While finalized, actions logged after the `finalize` that would change this Activity wait for
    // `unfinalize` (ADR-0019).
    const frozen = finalized.get(activityId);
    const forThisActivity = input.actions.flatMap((a, index) =>
      "activityId" in a && "entrantId" in a && a.activityId === activityId
        ? [{ action: a, index }]
        : [],
    );
    for (const { action, index } of forThisActivity) {
      if (frozen && index > frozen.index) {
        warnings.push({
          action,
          message: `${activity.slug} is finalized; this ${action.type} won't apply until it's unfinalized`,
        });
      }
    }
    const actionsFor = (entrantId: string): OfficialAction[] =>
      forThisActivity
        .filter(
          ({ action, index }) =>
            action.entrantId === entrantId && (!frozen || index < frozen.index),
        )
        .map(({ action }) => action);

    // An Official's corrections are laid over each entry's values before listing and totalling.
    const entries = input.entries
      .filter((e) => e.activityId === activityId)
      .map((e) => ({
        ...e,
        values: correctedValues(e, actionsFor(e.entrantId)),
      }));
    warnings.push(...unreadablePrimaryTimes(activity, entries));
    const scored = listed(activity, entries).map((e) => {
      const actions = actionsFor(e.entrantId);
      // The latest adjust-points wins, like every action type; adjustments don't add up (ADR-0019).
      const adjustment = latest(actions, "adjust-points")?.points ?? 0;
      return {
        entrantId: e.entrantId,
        total: entryTotal(fields, e.values) + adjustment,
        actions,
      };
    });
    // DQ'd entries are removed before ranking, so everyone below moves up (ADR-0019).
    const isDisqualified = (actions: readonly OfficialAction[]): boolean =>
      latest(actions, "disqualify")?.disqualified === true;
    const rankOf = ranking(
      scored.filter((e) => !isDisqualified(e.actions)).map((e) => e.total),
    );
    const recomputed = scored.map(
      ({ entrantId, total, actions }): EntryResult => {
        if (isDisqualified(actions)) {
          return { entrantId, total, points: 0, disqualified: true };
        }
        const provisionalRank = rankOf(total);
        const finalRank =
          latest(actions, "set-final-rank")?.rank ?? provisionalRank;
        return {
          entrantId,
          total,
          provisionalRank,
          finalRank,
          points:
            latest(actions, "set-placement-points")?.points ??
            placementPoints(
              finalRank,
              competition.placementPoints ?? DEFAULT_PLACEMENT_POINTS,
            ),
          disqualified: false,
        };
      },
    );
    if (!frozen) {
      activities.push({
        activityId,
        competitionId,
        finalized: false,
        entries: recomputed,
      });
      continue;
    }
    const stored = storedResults(frozen.action, scored, ranking);
    const differ = differences(stored, recomputed);
    if (differ.length > 0) {
      warnings.push({
        action: frozen.action,
        message: `${activity.slug} is finalized, but recomputing from the current scores and actions would differ for ${differ.join(", ")}; the finalized ranking stands`,
      });
    }
    activities.push({
      activityId,
      competitionId,
      finalized: true,
      entries: stored,
    });
  }

  const overrides = overallRankOverrides(input);
  const standings = input.event.competitions.map((c) =>
    competitionStandings(
      c.id,
      input,
      activityById,
      activities,
      ranking,
      overrides.ranks,
    ),
  );
  const awards = (input.event.awards ?? []).map((award) => ({
    awardId: award.id,
    ...awardRecipients(
      award,
      standings.find((s) => s.competitionId === award.competitionId)
        ?.entrants ?? [],
      input.actions,
    ),
  }));
  return {
    activities,
    standings,
    awards: awards.map(({ awardId, recipients }) => ({ awardId, recipients })),
    warnings: [
      ...warnings,
      ...overrides.warnings,
      ...awards.flatMap((a) => a.warnings),
    ],
  };
}

type SetOverallRank = Extract<OfficialAction, { type: "set-overall-rank" }>;

/**
 * The effective (latest) `set-overall-rank` per Competition and entrant, as `competitionId entrantId` →
 * rank. Only the effective one is checked: an invalid one is left out with a warning, never an error,
 * since the log is append-only (ADR-0019).
 */
function overallRankOverrides(input: ScoringInput): {
  ranks: ReadonlyMap<string, number>;
  warnings: ScoringWarning[];
} {
  const latestByKey = new Map<string, SetOverallRank>();
  for (const a of input.actions) {
    if (a.type === "set-overall-rank") {
      latestByKey.set(`${a.competitionId} ${a.entrantId}`, a);
    }
  }
  const ranks = new Map<string, number>();
  const warnings: ScoringWarning[] = [];
  for (const [key, action] of latestByKey) {
    const problem = overallRankProblem(input, action);
    if (problem) warnings.push({ action, message: problem });
    else ranks.set(key, action.rank);
  }
  return { ranks, warnings };
}

function overallRankProblem(
  input: ScoringInput,
  { competitionId, entrantId, rank }: SetOverallRank,
): string | undefined {
  const competition = input.event.competitions.find(
    (c) => c.id === competitionId,
  );
  if (!competition) {
    return `set-overall-rank: no Competition ${competitionId} in the Event; left out`;
  }
  if (
    !input.entrants.some(
      (e) => e.id === entrantId && e.competitionId === competitionId,
    )
  ) {
    return `set-overall-rank: ${entrantId} isn't in Competition ${competition.slug}; left out`;
  }
  if (!Number.isInteger(rank) || rank < 1) {
    return `set-overall-rank: rank ${rank} for ${entrantId} isn't a whole number from 1; left out`;
  }
  return undefined;
}

/** Each entrant's sum of placement points over the Competition's ranked Activities, ranked by the Event's tie numbering. */
function competitionStandings(
  competitionId: string,
  input: ScoringInput,
  activityById: ReadonlyMap<string, Activity>,
  activities: readonly ActivityResults[],
  ranking: ReturnType<typeof rankingFor>,
  overallRanks: ReadonlyMap<string, number>,
): CompetitionStandings {
  const ranked = activities.filter(
    (a) =>
      a.competitionId === competitionId &&
      activityById.get(a.activityId)?.scoringType === "ranked",
  );
  const totals = input.entrants
    .filter((e) => e.competitionId === competitionId)
    .map(({ id }) => ({
      entrantId: id,
      total: ranked.reduce(
        (sum, a) =>
          sum +
          a.entries
            .filter((e) => e.entrantId === id)
            .reduce((s, e) => s + e.points, 0),
        0,
      ),
    }));
  // An overall DQ is an action with no Activity; the latest one for the entrant wins.
  const isDisqualified = (entrantId: string): boolean =>
    latest(
      input.actions.filter(
        (a) => !("activityId" in a) && a.entrantId === entrantId,
      ),
      "disqualify",
    )?.disqualified === true;
  // DQ'd entrants keep their total but are removed before ranking (ADR-0019).
  const rankOf = ranking(
    totals.filter((t) => !isDisqualified(t.entrantId)).map((t) => t.total),
  );
  // An Official's override sets only that entrant's rank; nobody else is re-sorted. A DQ beats it.
  const rankedStanding = (
    t: { entrantId: string; total: number },
    provisionalRank: number,
  ): Standing => ({
    ...t,
    provisionalRank,
    rank:
      overallRanks.get(`${competitionId} ${t.entrantId}`) ?? provisionalRank,
    disqualified: false,
  });
  return {
    competitionId,
    entrants: totals.map((t): Standing =>
      isDisqualified(t.entrantId)
        ? { ...t, disqualified: true }
        : rankedStanding(t, rankOf(t.total)),
    ),
  };
}

/**
 * An Activity's entries in listing order: by its primary metric's raw value in that metric's own
 * direction, entries with no value last; equal values keep entry order. Without a primary metric,
 * as entered. Listing only: ranking comes from points (ADR-0019 Measured Activities).
 */
function listed(
  activity: Activity,
  entries: readonly ScoreEntry[],
): readonly ScoreEntry[] {
  const primary = activity.scoring.fields.find((f) => f.primary);
  if (!primary?.primary) return entries;
  const sign = primary.primary.direction === "lower-wins" ? 1 : -1;
  const value = (e: ScoreEntry) => metricValue(primary, e.values[primary.id]);
  return [...entries].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === undefined || y === undefined) {
      return (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0);
    }
    return sign * (x - y);
  });
}

/** A warning for each primary stopwatch time that was entered but can't be read, e.g. `"7.47"`. */
function unreadablePrimaryTimes(
  activity: Activity,
  entries: readonly ScoreEntry[],
): ScoringWarning[] {
  const primary = activity.scoring.fields.find((f) => f.primary);
  if (primary?.type !== "stopwatch") return [];
  return entries.flatMap((e) => {
    const value = e.values[primary.id];
    if (!unreadableStopwatch(value)) return [];
    return [
      {
        activityId: activity.id,
        entrantId: e.entrantId,
        fieldId: primary.id,
        value: value ?? null,
        message: `${activity.slug}, entrant ${e.entrantId}: "${String(value)}" isn't a stopwatch time (m:ss or h:mm:ss), so it's listed last`,
      },
    ];
  });
}

type Finalize = ActionOf<"finalize">;

/**
 * The Activities a `finalize` freezes, with its place in the log. Per Activity, only the latest
 * `finalize` or `unfinalize` is checked. An invalid latest `finalize` gets a warning and the Activity
 * stays frozen with the latest valid `finalize` since the last `unfinalize`, if there is one: finalized
 * results are what's printed on ribbons, and only an explicit `unfinalize` reopens (ADR-0019).
 */
function finalizations(
  input: ScoringInput,
  activityById: ReadonlyMap<string, Activity>,
): {
  finalized: ReadonlyMap<string, { action: Finalize; index: number }>;
  warnings: ScoringWarning[];
} {
  const logByActivity = new Map<
    string,
    { action: Finalize | ActionOf<"unfinalize">; index: number }[]
  >();
  input.actions.forEach((action, index) => {
    if (action.type === "finalize" || action.type === "unfinalize") {
      const log = logByActivity.get(action.activityId) ?? [];
      log.push({ action, index });
      logByActivity.set(action.activityId, log);
    }
  });
  const finalized = new Map<string, { action: Finalize; index: number }>();
  const warnings: ScoringWarning[] = [];
  for (const [activityId, log] of logByActivity) {
    const latestAction = log.at(-1)?.action;
    if (!latestAction) continue;
    const activity = input.event.activities.some(
      (a) => a.activityId === activityId,
    )
      ? activityById.get(activityId)
      : undefined;
    if (!activity) {
      warnings.push({
        action: latestAction,
        message: `${latestAction.type}: no Activity ${activityId} in the Event; left out`,
      });
      continue;
    }
    for (const [i, { action, index }] of [...log.entries()].reverse()) {
      if (action.type === "unfinalize") break;
      const problem = finalizeProblem(input, activity, action);
      if (!problem) {
        finalized.set(activityId, { action, index });
        break;
      }
      // Superseded invalid finalizes are skipped silently; only the latest one warns.
      if (i === log.length - 1) warnings.push({ action, message: problem });
    }
  }
  return { finalized, warnings };
}

function finalizeProblem(
  input: ScoringInput,
  activity: Activity,
  { ranking }: Finalize,
): string | undefined {
  const seen = new Set<string>();
  for (const r of ranking) {
    const who = r.entrantId;
    if (
      !input.entries.some(
        (e) => e.activityId === activity.id && e.entrantId === who,
      )
    ) {
      return `finalize: ${who} has no entry at ${activity.slug}; left out`;
    }
    if (seen.has(who)) {
      return `finalize: ${who} is listed twice at ${activity.slug}; left out`;
    }
    seen.add(who);
    if (r.disqualified) continue;
    if (!Number.isInteger(r.rank) || r.rank < 1) {
      return `finalize: rank ${r.rank} for ${who} at ${activity.slug} isn't a whole number from 1; left out`;
    }
    if (!Number.isFinite(r.points) || r.points < 0) {
      return `finalize: points ${r.points} for ${who} at ${activity.slug} aren't a number from 0; left out`;
    }
  }
  return undefined;
}

/**
 * A `finalize` action's stored ranking as results, in its order. Totals stay live, and the Provisional
 * Ranking ranks them among the entrants it didn't DQ, as information; ranks and points are as stored.
 */
function storedResults(
  { ranking }: Finalize,
  scored: readonly { entrantId: string; total: number }[],
  rankingOf: ReturnType<typeof rankingFor>,
): EntryResult[] {
  const totalOf = (entrantId: string): number =>
    scored.find((s) => s.entrantId === entrantId)?.total ?? 0;
  const rankOf = rankingOf(
    ranking.filter((r) => !r.disqualified).map((r) => totalOf(r.entrantId)),
  );
  return ranking.map((r): EntryResult => {
    const total = totalOf(r.entrantId);
    if (r.disqualified) {
      return { entrantId: r.entrantId, total, points: 0, disqualified: true };
    }
    return {
      entrantId: r.entrantId,
      total,
      provisionalRank: rankOf(total),
      finalRank: r.rank,
      points: r.points,
      disqualified: false,
    };
  });
}

/** Entrants whose rank, points or DQ differ between two sets of results, or who are in only one. */
function differences(
  a: readonly EntryResult[],
  b: readonly EntryResult[],
): string[] {
  const outcome = (r: EntryResult): string =>
    r.disqualified ? "DQ" : `${r.finalRank}:${r.points}`;
  const of = (results: readonly EntryResult[]) =>
    new Map(results.map((r) => [r.entrantId, outcome(r)]));
  const x = of(a);
  const y = of(b);
  return [...new Set([...x.keys(), ...y.keys()])]
    .filter((id) => x.get(id) !== y.get(id))
    .sort();
}
