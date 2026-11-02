// Pure scoring and ranking (ADR-0008, ADR-0019, ADR-0020). No I/O.
export { awardRecipients } from "./awards.ts";
export {
  entryTotal,
  mergeCommonFields,
  metricValue,
  stopwatchSeconds,
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
