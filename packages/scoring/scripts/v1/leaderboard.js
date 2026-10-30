import { getOrdinalSuffix, getPointsForRank } from './schema.js';

/**
 * Calculates the total scores and ranks for all entities across all games.
 *
 * Ranking Logic:
 * - Uses "Dense Ranking": Ties share the same rank, and the next rank is the immediate integer.
 *   Example: If two entities tie for 1st, the next entity is 2nd (not 3rd).
 *   Sequence: 1st, 1st, 2nd, 3rd...
 *
 * Precedence:
 * - If a 'manual_rank' override exists in the score payload, it takes precedence over the calculated auto-rank.
 * - Manual points overrides are also applied here for the final leaderboard calculations.
 *
 * @param {Object} appData - The application data containing games, entities, and scores.
 * @returns {Object} A map of { entity_id: { game_id: points } } for leaderboard aggregation.
 */
export function calculateScoreContext(appData) {
    // 1. Calculate totals for every score
    const enrichedScores = appData.scores.map(score => {
        const game = appData.games.find(g => g.id === score.game_id);
        let total = 0;
        if (game) {
            const fields = game.fields || [];
            fields.forEach(f => {
                if (f.kind === 'points' || f.kind === 'penalty') {
                    const val = parseFloat(score.score_payload[f.id]);
                    if (!isNaN(val)) {
                        if (f.kind === 'penalty') total -= val;
                        else total += val;
                    }
                }
            });
        }
        return { ...score, _total: total };
    });

    // 2. Group by game to calculate dense ranks
    const gameGroups = {};
    enrichedScores.forEach(s => {
        if (!gameGroups[s.game_id]) gameGroups[s.game_id] = [];
        gameGroups[s.game_id].push(s);
    });

    const finalPointsMap = {}; // { entity_id: { game_id: points } }

    Object.keys(gameGroups).forEach(gameId => {
        const scores = gameGroups[gameId];
        scores.sort((a, b) => b._total - a._total);

        let currentAutoRank = 0;
        let lastTotal = null;
        scores.forEach(s => {
            if (s._total !== lastTotal) {
                currentAutoRank++;
                lastTotal = s._total;
            }
            s._autoRank = getOrdinalSuffix(currentAutoRank);

            // Apply Manual Overrides
            const finalRank = s.score_payload.manual_rank || s._autoRank;
            const autoPts = getPointsForRank(finalRank);
            const mPts = s.score_payload.manual_points;
            const finalPoints = (mPts !== undefined && mPts !== "" && mPts !== null) ? parseFloat(mPts) : autoPts;

            if (!finalPointsMap[s.entity_id]) finalPointsMap[s.entity_id] = {};
            finalPointsMap[s.entity_id][gameId] = finalPoints;
        });
    });

    return finalPointsMap;
}
