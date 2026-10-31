import { entryTotal, mergeCommonFields } from "./fields.ts";
import type { ActivityResults, EventResults, ScoringInput } from "./types.ts";

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
    const actions = input.actions.filter((a) => a.activityId === activityId);
    const adjustment = (entrantId: string): number =>
      actions.reduce(
        (sum, a) =>
          a.type === "adjust-points" && a.entrantId === entrantId
            ? sum + a.points
            : sum,
        0,
      );
    activities.push({
      activityId,
      competitionId,
      entries: input.entries
        .filter((e) => e.activityId === activityId)
        .map((e) => ({
          entrantId: e.entrantId,
          total: entryTotal(fields, e.values) + adjustment(e.entrantId),
        })),
    });
  }
  return { activities };
}
