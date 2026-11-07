import type { ActivityResults, EntryResult, ScoreEntry } from "./types.ts";

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
