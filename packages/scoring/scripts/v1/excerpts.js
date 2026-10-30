// Verbatim extracts from v1 (github.com/j2willey/camporee-conductor, MIT), commit 3947fd6.
// Each block between "BEGIN v1" and "END v1" is copied byte for byte from the file and lines named.
// Only the function wrappers, imports and returns around them are new ("glue"). Do not edit the v1 blocks:
// they are the reference that packages/scoring must match (issue #3).
/* eslint-disable */
import { formatGameTitle, getGameTier, getOrdinalSuffix, getPointsForRank } from './schema.js';
import { calculateScoreContext } from './leaderboard.js';

// ---------------------------------------------------------------------------
// Common Field injection: the server adds preset fields to each game before the browser sees it.
// BEGIN v1 src/servers/collator.js:298-333

function applyTemplate(str, variables) {
    if (!str) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '___');
}

function injectCommonFields(normalizedGame, presets, typeDefaults, leagues) {
    const defaults = typeDefaults[normalizedGame.league];
    if (!defaults || !Array.isArray(normalizedGame.fields)) return;

    const tier = getGameTier(normalizedGame, { leagues: leagues || [] });
    const presetsById = Object.fromEntries(presets.map(p => [p.id, p]));
    const variables = normalizedGame.variables || {};

    function resolvePreset(id) {
        const p = presetsById[id];
        if (!p) return null;
        // Tier safety check: skip presets that belong to the wrong roster tier.
        // Presets with tier "all" are always injected.
        if (tier && p.tier && p.tier !== 'all' && p.tier !== tier) return null;
        const { config = {}, position, sortOrder, ...rest } = p;
        return {
            ...rest,
            label: applyTemplate(p.label, variables),
            placeholder: applyTemplate(config.placeholder, variables),
            ...(config.min !== undefined ? { min: config.min } : {}),
            ...(config.max !== undefined ? { max: config.max } : {}),
            ...(config.options ? { options: config.options } : {}),
            ...(config.defaultValue !== undefined ? { defaultValue: config.defaultValue } : {})
        };
    }

    const prefixFields = (defaults.prefix || []).map(resolvePreset).filter(Boolean);
    const suffixFields = (defaults.suffix || []).map(resolvePreset).filter(Boolean);
    normalizedGame.fields = [...prefixFields, ...normalizedGame.fields, ...suffixFields];
}
// END v1
export { injectCommonFields };

// ---------------------------------------------------------------------------
// Per-game results on the Officials' game detail page (Final Rank and points; ribbons came from these).
// glue: official.js:300-301 open the function with the game lookup.
export function v1OfficialGameResults(appData, gameId) {
    const game = appData.games.find(g => g.id === gameId);
// BEGIN v1 public/js/official.js:330-425
    const sortOrderFn = (a, b) => (a.sortOrder ?? 900) - (b.sortOrder ?? 900);
    const allFields = [
        ...(game.fields || []),
        ...(appData.commonScoring || [])
    ].sort(sortOrderFn);

    const scoreFields = allFields.filter(f => f.id !== 'judge_notes');
    const notesField = allFields.find(f => f.id === 'judge_notes');

    // Inject Heat/Round columns for bracketed games
    if (game.bracketMode) {
        const label = game.match_label || 'Match';
        scoreFields.unshift(
            { id: 'round', label: 'Round', audience: 'judge' },
            { id: 'heat', label: label, audience: 'judge' }
        );
    }

    // Filter, Deduplicate (for Bracket games), and Enrich
    let rawScores = appData.scores.filter(s => s.game_id === gameId);

    // DEDUPLICATION: If a team has multiple scores (e.g. from multiple heats),
    // we prioritize the one with a rank/manual_rank (Final Result), then the most recent.
    const deduped = {};
    rawScores.forEach(s => {
        const existing = deduped[s.entity_id];
        if (!existing) {
            deduped[s.entity_id] = s;
        } else {
            // Priority 1: Has manual_rank
            // Priority 2: Has rank
            // Priority 3: More recent timestamp
            const sHasRank = s.score_payload.manual_rank || s.score_payload.rank || s.score_payload.final_rank;
            const exHasRank = existing.score_payload.manual_rank || existing.score_payload.rank || existing.score_payload.final_rank;

            if (sHasRank && !exHasRank) {
                deduped[s.entity_id] = s;
            } else if (!exHasRank && s.timestamp > existing.timestamp) {
                deduped[s.entity_id] = s;
            } else if (sHasRank && exHasRank && s.timestamp > existing.timestamp) {
                // Both have rank, take the most recent (e.g. they corrected it)
                deduped[s.entity_id] = s;
            }
        }
    });
    rawScores = Object.values(deduped);

    const gameScores = rawScores.map(score => {
        let total = 0;
        scoreFields.forEach(f => {
            if (f.kind === 'points' || f.kind === 'penalty') {
                const val = parseFloat(score.score_payload[f.id]);
                if (!isNaN(val)) {
                    if (f.kind === 'penalty') total -= val;
                    else total += val;
                }
            } else if (f.kind === 'metric') {
                const pts = parseFloat(score.score_payload[f.id + '_pts']);
                if (!isNaN(pts)) total += pts;
            }
        });
        return { ...score, _total: total };
    });

    // 1. Calculate Auto Ranks (Dense: 1, 1, 2)
    const sortedForRank = [...gameScores].sort((a, b) => (b._total || 0) - (a._total || 0));
    let currentAutoRank = 0;
    let lastTotal = null;
    sortedForRank.forEach(s => {
        if (s._total !== lastTotal) {
            currentAutoRank++;
            lastTotal = s._total;
        }
        s._autoRank = getOrdinalSuffix(currentAutoRank);
    });

    // 2. Finalize Rank/Points
    gameScores.forEach(s => {
        // PRIORITY: Manual Admin Rank > Judge Tournament Rank > Auto-calculated Points Rank
        let judgeRank = s.score_payload.rank || s.score_payload.final_rank;
        if (judgeRank && !isNaN(parseInt(judgeRank))) {
            judgeRank = getOrdinalSuffix(parseInt(judgeRank));
        }

        s._finalRank = s.score_payload.manual_rank || judgeRank || s._autoRank;

        // For bracket games, if no rank is submitted at all, don't assume 1st.
        const game = appData.games.find(g => g.id === gameId);
        if (game && game.bracketMode && !s.score_payload.manual_rank && !judgeRank) {
            s._finalRank = "—";
        }

        const autoPts = getPointsForRank(s._finalRank);
        const mPts = s.score_payload.manual_points;
        s._finalPoints = (mPts !== undefined && mPts !== "" && mPts !== null) ? parseFloat(mPts) : autoPts;
    });
// END v1
    return gameScores;
}

// ---------------------------------------------------------------------------
// The Officials' leaderboard: overall points and overall rank per patrol (or troop).
// glue: renderMatrixNormal(table, games, patrols) without the table.
export function v1OfficialLeaderboard(appData, games, patrols) {
// BEGIN v1 public/js/official.js:852-892
    // 1. Calculate points map (points for every score)
    const pointsMap = calculateScoreContext(appData);

    // Build unscoutlike lookup: entity_id -> Set of game_ids with non-zero unscout value
    const unscoutMap = {};
    appData.scores.forEach(s => {
        const val = parseFloat(s.score_payload['unscout'] || s.score_payload['unscoutlike'] || 0);
        if (val > 0) {
            if (!unscoutMap[s.entity_id]) unscoutMap[s.entity_id] = {};
            unscoutMap[s.entity_id][s.game_id] = val;
        }
    });

    // 2. Calculate totals per patrol
    patrols.forEach(p => {
        let total = 0;
        games.forEach(g => {
            if (pointsMap[p.id] && pointsMap[p.id][g.id]) {
                total += pointsMap[p.id][g.id];
            }
        });
        p._leaderboardTotal = total;
    });

    // 3. Dense Rank — exclude patrols with overall DQ flag
    patrols.forEach(p => {
        p._overallExcluded = appData.flags.some(f => f.entity_id === p.id && f.game_id === 'overall' && f.dq);
    });
    const sortedForRank = [...patrols]
        .filter(p => !p._overallExcluded)
        .sort((a, b) => b._leaderboardTotal - a._leaderboardTotal);
    let curRank = 0;
    let lastLT = null;
    sortedForRank.forEach(p => {
        if (p._leaderboardTotal !== lastLT) {
            curRank++;
            lastLT = p._leaderboardTotal;
        }
        p._autoOverallRank = getOrdinalSuffix(curRank);
    });
    patrols.filter(p => p._overallExcluded).forEach(p => { p._autoOverallRank = '—'; });
// END v1
    return patrols;
}

// ---------------------------------------------------------------------------
// The announcer sheet's per-game top places (for comparison only; not the reference).
// glue: renderAnnouncerSheet() up to the per-game blocks, with the view mode passed in.
export function v1AnnouncerGameBlocks(appData, games, currentViewMode) {
    const blocks = [];
// BEGIN v1 public/js/utils.js:738-781
    games.forEach(game => {
        const rawScores = appData.scores.filter(s => s.game_id === game.id);
        if (rawScores.length === 0) return;

        const scored = rawScores.map(s => {
            let total = 0;
            const fields = [...(game.fields || []), ...(appData.commonScoring || [])];
            fields.forEach(f => {
                const val = parseFloat(s.score_payload[f.id]);
                if (!isNaN(val)) {
                    if (f.kind === 'penalty') total -= val;
                    else if (f.kind === 'points') total += val;
                }
            });
            return { ...s, _total: total };
        }).sort((a, b) => b._total - a._total);

        // Assign ranks with tie handling
        const topRankSet = new Set(['1', '1st', '2', '2nd', '3', '3rd']);
        const hasManualRanks = scored.some(s =>
            topRankSet.has(String(s.score_payload.manual_rank || '').toLowerCase().trim()));
        let curRank = 0, lastTotal = null;
        scored.forEach(s => {
            if (s._total !== lastTotal) { curRank++; lastTotal = s._total; }
            s._rank = curRank;
            s._rankLabel = s.score_payload.manual_rank || getOrdinalSuffix(curRank);
        });

        // Mirror ribbon logic: if manual ranks are present, only show explicitly ranked top-3.
        // Auto mode falls back to top-3 positions (ties included).
        const topPlaces = hasManualRanks
            ? scored.filter(s => s.score_payload.manual_rank &&
                topRankSet.has(String(s.score_payload.manual_rank).toLowerCase().trim()))
            : scored.filter(s => s._rank <= 3);
        if (topPlaces.length === 0) return;

        blocks.push({ title: formatGameTitle(game), entries: topPlaces.map(s => ({
            rankLabel: s._rankLabel,
            name: currentViewMode === 'patrol'
                ? `${s.entity_name}  (T${String(s.troop_number).replace(/^T/i, '')})`
                : `T${String(s.troop_number).replace(/^T/i, '')}`,
            score: s._total
        }))});
    });
// END v1
    return blocks;
}
