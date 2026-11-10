import type { OfficialAction, ScoringInput } from "./types.ts";

/** Why this Official action is invalid for this Event and roster, or undefined if it's valid (ADR-0019, #24). */
export function actionProblem(
  context: Pick<ScoringInput, "event" | "activities" | "entrants">,
  action: OfficialAction,
): string | undefined {
  if (action.type === "disqualify") return disqualifyProblem(context, action);
  // #24: 2c adds the checks for the other action types.
  return undefined;
}

function disqualifyProblem(
  { event, entrants }: Pick<ScoringInput, "event" | "activities" | "entrants">,
  action: Extract<OfficialAction, { type: "disqualify" }>,
): string | undefined {
  const { entrantId, activityId } = action;
  if (activityId === undefined) {
    return entrants.some((e) => e.id === entrantId)
      ? undefined
      : `disqualify: ${entrantId} isn't in any Competition; left out`;
  }
  const listing = event.activities.find((a) => a.activityId === activityId);
  if (!listing) {
    return `disqualify: no Activity ${activityId} in the Event; left out`;
  }
  if (
    !entrants.some(
      (e) => e.id === entrantId && e.competitionId === listing.competitionId,
    )
  ) {
    const competition = event.competitions.find(
      (c) => c.id === listing.competitionId,
    );
    return `disqualify: ${entrantId} isn't in Competition ${competition?.slug ?? listing.competitionId}; left out`;
  }
  return undefined;
}
