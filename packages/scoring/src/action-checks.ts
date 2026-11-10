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
  switch (action.type) {
    case "adjust-points":
    case "set-final-rank":
    case "set-placement-points":
      return activityResultProblem(context, action);
    case "set-overall-rank":
      return overallRankProblem(context, action);
    case "set-award":
      return setAwardProblem(context, action);
    case "finalize":
      return finalizeProblem(context, action);
    case "unfinalize":
      return activityProblem(context, action.type, action.activityId);
    default:
      return undefined;
  }
}

/** Why the Event has no such Activity, or undefined when it has (and the Activity is given). */
function activityProblem(
  { event, activities }: Context,
  type: string,
  activityId: string,
): string | undefined {
  return event.activities.some((a) => a.activityId === activityId) &&
    activities.some((a) => a.id === activityId)
    ? undefined
    : `${type}: no Activity ${activityId} in the Event; left out`;
}

/** Why the entrant isn't in the Competition, or undefined when they are. */
function entrantProblem(
  { event, entrants }: Context,
  type: string,
  entrantId: string,
  competitionId: string,
): string | undefined {
  if (
    entrants.some(
      (e) => e.id === entrantId && e.competitionId === competitionId,
    )
  ) {
    return undefined;
  }
  const competition = event.competitions.find((c) => c.id === competitionId);
  return `${type}: ${entrantId} isn't in Competition ${competition?.slug ?? competitionId}; left out`;
}

/** An Official's result for an entrant at an Activity: points added, a final rank, or placement points. */
function activityResultProblem(
  context: Context,
  action: Extract<
    OfficialAction,
    { type: "adjust-points" | "set-final-rank" | "set-placement-points" }
  >,
): string | undefined {
  const { type, activityId, entrantId } = action;
  const missing = activityProblem(context, type, activityId);
  if (missing !== undefined) return missing;
  const listing = context.event.activities.find(
    (a) => a.activityId === activityId,
  );
  if (!listing) return undefined;
  const outside = entrantProblem(
    context,
    type,
    entrantId,
    listing.competitionId,
  );
  if (outside !== undefined) return outside;
  if (action.type === "adjust-points" && !Number.isFinite(action.points)) {
    return `adjust-points: points ${action.points} for ${entrantId} isn't a number; left out`;
  }
  if (
    action.type === "set-final-rank" &&
    (!Number.isInteger(action.rank) || action.rank < 1)
  ) {
    return `set-final-rank: rank ${action.rank} for ${entrantId} isn't a whole number from 1; left out`;
  }
  if (
    action.type === "set-placement-points" &&
    (!Number.isFinite(action.points) || action.points < 0)
  ) {
    return `set-placement-points: points ${action.points} for ${entrantId} isn't a number from 0; left out`;
  }
  return undefined;
}

function overallRankProblem(
  { event, entrants }: Context,
  {
    competitionId,
    entrantId,
    rank,
  }: Extract<OfficialAction, { type: "set-overall-rank" }>,
): string | undefined {
  const competition = event.competitions.find((c) => c.id === competitionId);
  if (!competition) {
    return `set-overall-rank: no Competition ${competitionId} in the Event; left out`;
  }
  if (
    !entrants.some(
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

/** A `set-award` names an Award of the Event and an entrant of its Competition; a place must be one the Award has. */
function setAwardProblem(
  context: Context,
  { awardId, entrantId, place }: Extract<OfficialAction, { type: "set-award" }>,
): string | undefined {
  const award = context.event.awards?.find((a) => a.id === awardId);
  if (!award) return `set-award: no Award ${awardId} in the Event; left out`;
  const outside = entrantProblem(
    context,
    "set-award",
    entrantId,
    award.competitionId,
  );
  if (outside !== undefined) return outside;
  if (place === undefined) return undefined;
  if (award.rule.type !== "places") {
    return `set-award gives place "${place}" for Award ${award.slug}, but only a named-places Award takes a place; left out`;
  }
  if (!award.rule.names.includes(place)) {
    return `"${place}" isn't a place of Award ${award.slug} (${award.rule.names.join(", ")}); left out`;
  }
  return undefined;
}

/** A `finalize` names an Activity of the Event; its ranking lists entrants with entries there, once each, with valid ranks and points. */
function finalizeProblem(
  context: Context,
  { activityId, ranking }: Extract<OfficialAction, { type: "finalize" }>,
): string | undefined {
  const missing = activityProblem(context, "finalize", activityId);
  if (missing !== undefined) return missing;
  const slug = context.activities.find((a) => a.id === activityId)?.slug;
  const seen = new Set<string>();
  for (const r of ranking) {
    const who = r.entrantId;
    if (
      !context.entries.some(
        (e) => e.activityId === activityId && e.entrantId === who,
      )
    ) {
      return `finalize: ${who} has no entry at ${slug}; left out`;
    }
    if (seen.has(who)) {
      return `finalize: ${who} is listed twice at ${slug}; left out`;
    }
    seen.add(who);
    if (r.disqualified) continue;
    if (!Number.isInteger(r.rank) || r.rank < 1) {
      return `finalize: rank ${r.rank} for ${who} at ${slug} isn't a whole number from 1; left out`;
    }
    if (!Number.isFinite(r.points) || r.points < 0) {
      return `finalize: points ${r.points} for ${who} at ${slug} aren't a number from 0; left out`;
    }
  }
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
