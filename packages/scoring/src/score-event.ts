import type { Activity } from "@camporee-conductor/schema";
import { awardRecipients } from "./awards.ts";
import { entryTotal, mergeCommonFields, metricValue } from "./fields.ts";
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

/** Scores a whole Event. Pure: the same input always gives the same results (ADR-0019). */
export function scoreEvent(input: ScoringInput): EventResults {
  const activityById = new Map(input.activities.map((a) => [a.id, a]));
  const ranking = rankingFor(input.event.tieNumbering);
  const competitionById = new Map(
    input.event.competitions.map((c) => [c.id, c]),
  );

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
    const actionsFor = (entrantId: string): OfficialAction[] =>
      input.actions.filter(
        (a) =>
          "activityId" in a &&
          a.activityId === activityId &&
          a.entrantId === entrantId,
      );

    const scored = listed(
      activity,
      input.entries.filter((e) => e.activityId === activityId),
    ).map((e) => {
      const actions = actionsFor(e.entrantId);
      const adjustment = actions.reduce(
        (sum, a) => (a.type === "adjust-points" ? sum + a.points : sum),
        0,
      );
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
    activities.push({
      activityId,
      competitionId,
      entries: scored.map(({ entrantId, total, actions }): EntryResult => {
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
      }),
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
    warnings: [...overrides.warnings, ...awards.flatMap((a) => a.warnings)],
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
