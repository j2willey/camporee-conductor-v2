import type { Activity, Event } from "@camporee-conductor/schema";
import { inRankOrder } from "./entries.ts";
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

/**
 * The one list that award stickers, the announcer script and the awards CSV print from (ADR-0019 winners registry
 * amendment). Pure, over `scoreEvent`'s results; it never re-ranks. `activities` says which Activities are ranked:
 * Exhibitions don't place and don't hold `provisional` open.
 *
 * Order: by Competition in the Event's order; within it, ranked Activities by `sortOrder`, then Awards in the
 * Event's order; within an Activity or Award, by place, then the order scoring gave.
 */
export function winnersRegistry(
  event: Event,
  results: EventResults,
  activities: readonly Pick<Activity, "id" | "scoringType">[],
): WinnersRegistry {
  const ranked = new Set(
    activities.filter((a) => a.scoringType === "ranked").map((a) => a.id),
  );
  const resultOf = new Map(results.activities.map((a) => [a.activityId, a]));
  const awardResultOf = new Map(results.awards.map((a) => [a.awardId, a]));
  const lines: WinnerLine[] = [];
  let provisional = false;

  for (const competition of event.competitions) {
    const inCompetition = event.activities
      .filter(
        (a) => a.competitionId === competition.id && ranked.has(a.activityId),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (const { activityId } of inCompetition) {
      const activity = resultOf.get(activityId);
      if (!activity) continue;
      if (!activity.finalized) provisional = true;
      for (const entry of inRankOrder(activity)) {
        if (entry.disqualified || entry.finalRank > WINNER_PLACES) continue;
        lines.push({
          kind: "activity",
          competitionId: competition.id,
          activityId,
          entrantId: entry.entrantId,
          rank: entry.finalRank,
          // An Official's override, or a Final Ranking that differs from the recompute.
          manual:
            entry.rankOverride?.state === "applied" ||
            entry.finalRank !== entry.provisionalRank,
        });
      }
    }
    for (const award of event.awards ?? []) {
      if (award.competitionId !== competition.id) continue;
      const names = award.rule.type === "places" ? award.rule.names : [];
      const withRank = (awardResultOf.get(award.id)?.recipients ?? []).map(
        (r) => {
          const index = r.place === undefined ? -1 : names.indexOf(r.place);
          return { r, rank: index < 0 ? undefined : index + 1 };
        },
      );
      // By place, then scoring's order (the sort is stable); recipients without a place keep scoring's order.
      withRank.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || 0);
      for (const { r, rank } of withRank) {
        lines.push({
          kind: "award",
          competitionId: competition.id,
          awardId: award.id,
          entrantId: r.entrantId,
          ...(rank !== undefined && { rank }),
          ...(r.place !== undefined && { place: r.place }),
          manual: r.manual,
        });
      }
    }
  }
  return { lines, provisional };
}
