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
