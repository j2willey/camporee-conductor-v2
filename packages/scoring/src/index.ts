// Pure scoring and ranking (ADR-0008, ADR-0019, ADR-0020). No I/O.
export { actionProblem } from "./action-checks.ts";
export { awardRecipients } from "./awards.ts";
export { finalizeRanking, inRankOrder, newestEntries } from "./entries.ts";
export {
  correctedValues,
  entryTotal,
  fieldCorrections,
  fillVariables,
  mergeCommonFields,
  metricValue,
  numberOf,
  stopwatchSeconds,
  unreadableStopwatch,
  valueProblem,
} from "./fields.ts";
export {
  DEFAULT_PLACEMENT_POINTS,
  denseRanking,
  placementPoints,
  rankingFor,
  strictRanking,
  withinCutoff,
  type PlacementPointsTable,
} from "./ranking.ts";
export { scoreEvent } from "./score-event.ts";
export type * from "./types.ts";
