import type { Event, PlacementPoints } from "@camporee-conductor/schema";

/**
 * Dense ranking (1, 2, 2, 3), highest score first, the default tie numbering (ADR-0019).
 * Returns the rank of a score among `scores`.
 */
export function denseRanking(
  scores: readonly number[],
): (score: number) => number {
  const distinct = [...new Set(scores)].sort((a, b) => b - a);
  const rankOf = new Map(distinct.map((score, i) => [score, i + 1]));
  return (score) => {
    const rank = rankOf.get(score);
    if (rank === undefined) throw new Error(`${score} isn't a ranked score`);
    return rank;
  };
}

/**
 * Strict ranking (1, 1, 3), also called standard competition ranking or SQL `RANK()`: a score's rank
 * is 1 + how many scores are higher, so places are skipped after a tie (ADR-0019).
 */
export function strictRanking(
  scores: readonly number[],
): (score: number) => number {
  const known = new Set(scores);
  return (score) => {
    if (!known.has(score)) throw new Error(`${score} isn't a ranked score`);
    return 1 + scores.filter((s) => s > score).length;
  };
}

/** The ranking for an Event's `tieNumbering` setting. */
export function rankingFor(
  tieNumbering: Event["tieNumbering"],
): typeof denseRanking {
  return tieNumbering === "strict" ? strictRanking : denseRanking;
}

/** Points for a Final Ranking: `places[0]` for 1st, `places[1]` for 2nd…, `participation` below those. */
export type PlacementPointsTable = PlacementPoints;

/** v1's table, used when a Competition doesn't set one: 1st 100, 2nd 90, 3rd 80, 4th 70, 5th 60, any other 50. */
export const DEFAULT_PLACEMENT_POINTS: PlacementPointsTable = {
  places: [100, 90, 80, 70, 60],
  participation: 50,
};

export function placementPoints(
  rank: number,
  table: PlacementPointsTable = DEFAULT_PLACEMENT_POINTS,
): number {
  return table.places[rank - 1] ?? table.participation;
}

/**
 * The entrants within an award cutoff of `count` places, best first (ADR-0019): everyone ranked at or
 * above the entrant in position `count`, so every entrant tied at the cutoff is included. A top-%
 * award passes `Math.ceil(percent × entrants)`.
 */
export function withinCutoff<T extends { rank: number }>(
  ranked: readonly T[],
  count: number,
): T[] {
  const best = [...ranked].sort((a, b) => a.rank - b.rank);
  const cutoff = best[Math.min(count, best.length) - 1];
  return cutoff ? best.filter((e) => e.rank <= cutoff.rank) : [];
}
