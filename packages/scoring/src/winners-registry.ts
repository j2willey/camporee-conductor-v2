import type { Activity, Event } from "@camporee-conductor/schema";
import type { EventResults } from "./types.ts";

/** How many places each ranked Activity lists: 1st to 3rd. v1's rule, kept as a constant; configurable is #70. */
export const WINNER_PLACES = 3;

/** One place at an Activity, or one recipient of an Award (ADR-0019 winners registry amendment). Ids only, never names. */
export interface WinnerLine {
  kind: "activity" | "award";
  competitionId: string;
  /** kind "activity". */
  activityId?: string;
  /** kind "award". */
  awardId?: string;
  entrantId: string;
  /** Activity: the finalRank (1 to 3). Award: the place number for named places, else undefined. */
  rank?: number;
  /** Award: the place name for named places, else undefined. */
  place?: string;
  /** An Official's `set-award`, or a rank override at an Activity. */
  manual: boolean;
}

export interface WinnersRegistry {
  lines: WinnerLine[];
  /** True while any ranked Activity in the Event isn't finalized. Screens and printouts say so. */
  provisional: boolean;
}

export function winnersRegistry(
  _event: Event,
  _results: EventResults,
  _activities: readonly Pick<Activity, "id" | "scoringType">[],
): WinnersRegistry {
  throw new Error("not implemented");
}
