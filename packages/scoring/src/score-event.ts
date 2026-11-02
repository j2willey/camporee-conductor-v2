import type { Activity } from "@camporee-conductor/schema";
import { awardRecipients } from "./awards.ts";
import { entryTotal, mergeCommonFields } from "./fields.ts";
import { placementPoints, rankingFor } from "./ranking.ts";
import type {
  ActivityResults,
  CompetitionStandings,
  EntryResult,
  EventResults,
  OfficialAction,
  ScoringInput,
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
            placementPoints(finalRank),
          disqualified: false,
        };
      }),
    });
  }

  const standings = input.event.competitions.map((c) =>
    competitionStandings(c.id, input, activityById, activities, ranking),
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
    warnings: awards.flatMap((a) => a.warnings),
  };
}

/** Each entrant's sum of placement points over the Competition's ranked Activities, ranked by the Event's tie numbering. */
function competitionStandings(
  competitionId: string,
  input: ScoringInput,
  activityById: ReadonlyMap<string, Activity>,
  activities: readonly ActivityResults[],
  ranking: ReturnType<typeof rankingFor>,
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
  return {
    competitionId,
    entrants: totals.map((t): Standing =>
      isDisqualified(t.entrantId)
        ? { ...t, disqualified: true }
        : { ...t, rank: rankOf(t.total), disqualified: false },
    ),
  };
}
