import type { Activity } from "@camporee-conductor/schema";
import { entryTotal, mergeCommonFields } from "./fields.ts";
import { denseRanking, placementPoints } from "./ranking.ts";
import type {
  ActivityResults,
  CompetitionStandings,
  EventResults,
  OfficialAction,
  ScoringInput,
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
        (a) => a.activityId === activityId && a.entrantId === entrantId,
      );

    const scored = input.entries
      .filter((e) => e.activityId === activityId)
      .map((e) => {
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
    const rankOf = denseRanking(scored.map((e) => e.total));
    activities.push({
      activityId,
      competitionId,
      entries: scored.map(({ entrantId, total, actions }) => {
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
            placementPoints(finalRank),
        };
      }),
    });
  }

  return {
    activities,
    standings: input.event.competitions.map((c) =>
      competitionStandings(c.id, input, activityById, activities),
    ),
  };
}

/** Each entrant's sum of placement points over the Competition's ranked Activities, dense-ranked. */
function competitionStandings(
  competitionId: string,
  input: ScoringInput,
  activityById: ReadonlyMap<string, Activity>,
  activities: readonly ActivityResults[],
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
  const rankOf = denseRanking(totals.map((t) => t.total));
  return {
    competitionId,
    entrants: totals.map((t) => ({ ...t, rank: rankOf(t.total) })),
  };
}
