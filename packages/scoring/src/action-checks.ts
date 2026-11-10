import { mergeCommonFields, valueProblem } from "./fields.ts";
import type { OfficialAction, ScoringInput } from "./types.ts";

type Context = Pick<
  ScoringInput,
  "event" | "activities" | "commonFieldSets" | "entrants" | "entries"
>;

/** Why this Official action is invalid for this Event and roster, or undefined if it's valid (ADR-0019, #24). */
export function actionProblem(
  context: Context,
  action: OfficialAction,
): string | undefined {
  if (action.type === "disqualify") return disqualifyProblem(context, action);
  if (
    action.type === "set-field-value" ||
    action.type === "revert-field-value"
  ) {
    return fieldValueProblem(context, action);
  }
  if (action.type === "choose-entry")
    return chooseEntryProblem(context, action);
  // #24: 2c adds the checks for the other action types.
  return undefined;
}

function disqualifyProblem(
  { event, entrants }: Context,
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

/**
 * A correction names an Activity of the Event, an entrant of its Competition and one of its fields,
 * Common Fields included. A set value must be of the field's kind; its range is guidance, so it's not
 * checked. Its entry must be one of the entrant's at the Activity (ADR-0019 2026-11-10).
 */
function fieldValueProblem(
  { event, activities, commonFieldSets, entrants, entries }: Context,
  action: Extract<
    OfficialAction,
    { type: "set-field-value" | "revert-field-value" }
  >,
): string | undefined {
  const { type, entrantId, activityId, fieldId } = action;
  const listing = event.activities.find((a) => a.activityId === activityId);
  const activity = activities.find((a) => a.id === activityId);
  if (!listing || !activity) {
    return `${type}: no Activity ${activityId} in the Event; left out`;
  }
  const competition = event.competitions.find(
    (c) => c.id === listing.competitionId,
  );
  if (!competition) {
    return `${type}: no Competition ${listing.competitionId} in the Event; left out`;
  }
  if (
    !entrants.some(
      (e) => e.id === entrantId && e.competitionId === listing.competitionId,
    )
  ) {
    return `${type}: ${entrantId} isn't in Competition ${competition.slug}; left out`;
  }
  const missing = entryMissing(entries, action, action.entryId);
  if (missing !== undefined) return `${type}: ${missing}; left out`;
  const field = mergeCommonFields(activity, competition, commonFieldSets).find(
    (f) => f.id === fieldId,
  );
  if (!field) {
    return `${type}: ${activity.title} has no field ${fieldId}; left out`;
  }
  if (action.type === "revert-field-value") return undefined;
  const problem = valueProblem({ ...field, required: false }, action.value, {
    range: false,
  });
  return problem === undefined ? undefined : `${type}: ${problem}; left out`;
}

/** Why `entryId` isn't one of the entrant's entries at the Activity, or undefined when it is. */
function entryMissing(
  entries: Context["entries"],
  { activityId, entrantId }: { activityId: string; entrantId: string },
  entryId: string,
): string | undefined {
  return entries.some(
    (e) =>
      e.id === entryId &&
      e.activityId === activityId &&
      e.entrantId === entrantId,
  )
    ? undefined
    : `there's no score entry ${entryId} for ${entrantId} at that Activity`;
}

/** A choice names an Activity of the Event, an entrant of its Competition, and two of the entrant's entries there. */
function chooseEntryProblem(
  { event, entrants, entries }: Context,
  action: Extract<OfficialAction, { type: "choose-entry" }>,
): string | undefined {
  const { entrantId, activityId } = action;
  const listing = event.activities.find((a) => a.activityId === activityId);
  if (!listing) {
    return `choose-entry: no Activity ${activityId} in the Event; left out`;
  }
  if (
    !entrants.some(
      (e) => e.id === entrantId && e.competitionId === listing.competitionId,
    )
  ) {
    const competition = event.competitions.find(
      (c) => c.id === listing.competitionId,
    );
    return `choose-entry: ${entrantId} isn't in Competition ${competition?.slug ?? listing.competitionId}; left out`;
  }
  for (const id of [action.entryId, action.newestEntryId]) {
    const missing = entryMissing(entries, action, id);
    if (missing !== undefined) return `choose-entry: ${missing}; left out`;
  }
  return undefined;
}
