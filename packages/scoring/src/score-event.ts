import { entryTotal, mergeCommonFields } from "./fields.ts";
import { denseRanking, placementPoints } from "./ranking.ts";
import type {
  ActivityResults,
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
  return { activities };
}
