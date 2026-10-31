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

/** Points for a Final Ranking: `places[0]` for 1st, `places[1]` for 2nd…, `otherwise` below those. */
export interface PlacementPointsTable {
  places: readonly number[];
  otherwise: number;
}

/** v1's table, the default (issue #3): 1st 100, 2nd 90, 3rd 80, 4th 70, 5th 60, any other 50. */
export const DEFAULT_PLACEMENT_POINTS: PlacementPointsTable = {
  places: [100, 90, 80, 70, 60],
  otherwise: 50,
};

export function placementPoints(
  rank: number,
  table: PlacementPointsTable = DEFAULT_PLACEMENT_POINTS,
): number {
  return table.places[rank - 1] ?? table.otherwise;
}
