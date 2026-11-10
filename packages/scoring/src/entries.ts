import type {
  ActivityResults,
  CompetitionStandings,
  EntryResult,
  FinalizedResult,
  RankedStanding,
  ScoreEntry,
  Standing,
} from "./types.ts";

/**
 * One score entry per entrant per Activity: the newest. `entries` must be in the order the box received
 * them, which is what "newest" means; the phone's clock doesn't count (ADR-0027 item 9). Every entry is
 * still kept on the box: this only picks the one that counts until an Official resolves the conflict
 * (#42). The result keeps the received order of the entries it picks.
 */
export function newestEntries<
  T extends Pick<ScoreEntry, "activityId" | "entrantId">,
>(entries: readonly T[]): T[] {
  const newest = new Map<string, T>();
  for (const e of entries) {
    const key = JSON.stringify([e.activityId, e.entrantId]);
    newest.delete(key);
    newest.set(key, e);
  }
  return [...newest.values()];
}

/**
 * An Activity's results in the order to list them: by Final Ranking, best first, ties in listing order,
 * then DQ'd entrants. A finalized Activity is listed exactly as stored, never re-sorted (ADR-0019).
 */
export function inRankOrder(results: ActivityResults): EntryResult[] {
  if (results.finalized) return [...results.entries];
  const ranked = results.entries.filter((e) => !e.disqualified);
  return [
    ...ranked.sort((a, b) => a.finalRank - b.finalRank),
    ...results.entries.filter((e) => e.disqualified),
  ];
}

/**
 * The ranking an Official would freeze now: each listed entrant's Final Ranking and points, or DQ, in
 * `inRankOrder` order. A `finalize` that stores it differs from a recompute in nothing (ADR-0019).
 */
export function finalizeRanking(results: ActivityResults): FinalizedResult[] {
  return inRankOrder(results).map((e): FinalizedResult =>
    e.disqualified
      ? { entrantId: e.entrantId, disqualified: true }
      : {
          entrantId: e.entrantId,
          rank: e.finalRank,
          points: e.points,
          disqualified: false,
        },
  );
}

/**
 * A Competition's standings in the order to list them: by rank, best first (an Official's `set-overall-rank`
 * included), ties in listing order, then the entrants DQ'd overall. `scoreEvent` gives standings in roster
 * order, so every view lists them through this (ADR-0019).
 */
export function standingsInRankOrder(
  standings: CompetitionStandings,
): Standing[] {
  const ranked = standings.entrants.filter(
    (s): s is RankedStanding => !s.disqualified,
  );
  return [
    ...ranked.sort((a, b) => a.rank - b.rank),
    ...standings.entrants.filter((s) => s.disqualified),
  ];
}
