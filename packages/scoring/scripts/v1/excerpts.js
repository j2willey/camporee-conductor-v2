// Verbatim extracts from v1 (github.com/j2willey/camporee-conductor, MIT) at commit 9ebffa5,
// "Event-day fixes and awards printing": the code the event laptop ran at Circus 2026.
// Each block between "BEGIN v1" and "END v1" is copied byte for byte from the file and lines named.
// Only the function wrappers, imports and returns around them are new ("glue"). Do not edit the v1 blocks:
// they are the reference that packages/scoring must match (issue #3).
/* eslint-disable */
import { formatGameTitle, getOrdinalSuffix, getPointsForRank } from './schema.js';
import { calculateScoreContext } from './leaderboard.js';

// ---------------------------------------------------------------------------
// Common Field injection: the server adds preset fields to each game before the browser sees it.
// BEGIN v1 src/servers/collator.js:223-253
function applyTemplate(str, variables) {
    if (!str) return str;
    return str.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '___');
}

function injectCommonFields(normalizedGame, presets, typeDefaults) {
    const defaults = typeDefaults[normalizedGame.type];
    if (!defaults || !Array.isArray(normalizedGame.fields)) return;

    const presetsById = Object.fromEntries(presets.map(p => [p.id, p]));
    const variables = normalizedGame.variables || {};

    function resolvePreset(id) {
        const p = presetsById[id];
        if (!p) return null;
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
// Per-game results on the Officials' game detail page (Final Rank and points).
// glue: official.js opens the function with the game lookup.
export function v1OfficialGameResults(appData, gameId) {
    const game = appData.games.find(g => g.id === gameId);
// BEGIN v1 public/js/official.js:315-411
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
            // Only sum if kind is "points" or "penalty"
            if (f.kind === 'points' || f.kind === 'penalty') {
                const val = parseFloat(score.score_payload[f.id]);
                if (!isNaN(val)) {
                    if (f.kind === 'penalty') {
                        total -= val;
                    } else {
                        total += val;
                    }
                }
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
// BEGIN v1 public/js/official.js:766-790
    // 1. Calculate points map (points for every score)
    const pointsMap = calculateScoreContext(appData);

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

    // 3. Dense Rank the patrol leaderboard totals
    const sortedForRank = [...patrols].sort((a, b) => b._leaderboardTotal - a._leaderboardTotal);
    let curRank = 0;
    let lastLT = null;
    sortedForRank.forEach(p => {
        if (p._leaderboardTotal !== lastLT) {
            curRank++;
            lastLT = p._leaderboardTotal;
        }
        p._autoOverallRank = getOrdinalSuffix(curRank);
    });
// END v1
    return patrols;
}

// ---------------------------------------------------------------------------
// The award sticker (ribbon) list: what was printed and awarded on Saturday.
// glue: utils.js module state (appData, currentViewMode) passed in.
export function v1WinnersRegistry(appData, currentViewMode) {
// BEGIN v1 public/js/utils.js:380-517
function getWinnersRegistry() {
    const registry = [];
    const pointsMap = calculateScoreContext(appData);

    // 1. Individual Games
    const games = appData.games.filter(g => (g.type || 'patrol') === currentViewMode);

    games.forEach(game => {
        // Calculate scores for this game
        const gameScores = appData.scores.filter(s => s.game_id === game.id).map(score => {
            let total = 0;
            const fields = [...(game.fields || []), ...(appData.commonScoring || [])];
            fields.forEach(f => {
                if (f.kind === 'points' || f.kind === 'penalty') {
                    const val = parseFloat(score.score_payload[f.id]);
                    if (!isNaN(val)) {
                        if (f.kind === 'penalty') total -= val;
                        else total += val;
                    }
                }
            });
            return { ...score, _total: total };
        });

        // Sort
        const sorted = [...gameScores].sort((a,b) => b._total - a._total);
        let curRank = 0;
        let lastT = null;

        // Entry fields for this game
        const entryFields = [...(game.fields || []), ...(appData.commonScoring || [])].filter(f => f.kind === 'entryname');

        sorted.forEach(s => {
            if (s._total !== lastT) {
                curRank++;
                lastT = s._total;
            }
            s._autoRank = getOrdinalSuffix(curRank);
            const finalRank = s.score_payload.manual_rank || s._autoRank;
            const rankClean = String(finalRank).toLowerCase().trim();
            const topRanks = ['1', '1st', '2', '2nd', '3', '3rd'];

            if (topRanks.includes(rankClean)) {
                // Construct line4Text
                let line4 = `${finalRank} Place - T${String(s.troop_number).replace(/^T/i, '')}`;
                if (currentViewMode === 'patrol') {
                    line4 += ` ${s.entity_name}`;
                }
                const entryVals = entryFields.map(f => s.score_payload[f.id]).filter(v => v).join(", ");
                if (entryVals) line4 += `, ${entryVals}`;

                // Collect entry values
                const entryData = {};
                entryFields.forEach(f => {
                    entryData[f.id] = s.score_payload[f.id];
                });

                registry.push({
                    type: 'game',
                    gameId: game.id,
                    gameName: formatGameTitle(game),
                    rank: finalRank,
                    entityName: s.entity_name,
                    troopNumber: s.troop_number,
                    line4Text: line4,
                    entryData: entryData
                });
            }
        });
    });

    // 2. Overall Leaderboard
    const entities = appData.entities.filter(e => e.type === currentViewMode);
    entities.forEach(p => {
        let total = 0;
        games.forEach(g => {
            if (pointsMap[p.id] && pointsMap[p.id][g.id]) {
                total += pointsMap[p.id][g.id];
            }
        });
        p._leaderboardTotal = total;
    });

    const lbSorted = [...entities].sort((a,b) => b._leaderboardTotal - a._leaderboardTotal);

    if (currentViewMode === 'troop') {
        // Troop overall: flat award for top N% — no rank differentiation
        const pct = parseFloat(document.getElementById('troop-overall-pct')?.value) || 25;
        const cutoff = Math.max(1, Math.ceil(lbSorted.length * (pct / 100)));
        const overallName = document.getElementById('troop-overall-name')?.value.trim() || 'Top Dog';
        const awardText  = document.getElementById('troop-overall-award')?.value.trim() || 'Best in Show';

        lbSorted.slice(0, cutoff).forEach(p => {
            if (p._leaderboardTotal <= 0) return;
            registry.push({
                type: 'overall',
                gameId: 'OVERALL',
                gameName: overallName,
                rank: awardText,
                entityName: p.name,
                troopNumber: p.troop_number,
                line4Text: `${awardText} - T${String(p.troop_number).replace(/^T/i, '')}`,
                entryData: {}
            });
        });
    } else {
        // Patrol overall: standard 1st/2nd/3rd ranking
        let curLBRank = 0;
        let lastLBT = null;

        lbSorted.forEach(p => {
            if (p._leaderboardTotal !== lastLBT) {
                curLBRank++;
                lastLBT = p._leaderboardTotal;
            }
            p._autoOverallRank = getOrdinalSuffix(curLBRank);
            const finalRank = p.manual_rank || p._autoOverallRank;
            const rankClean = String(finalRank).toLowerCase().trim();
            const topRanks = ['1', '1st', '2', '2nd', '3', '3rd'];

            if (topRanks.includes(rankClean) || (p.manual_rank && p.manual_rank.length > 0)) {
                let line4 = `${finalRank}${topRanks.includes(rankClean) ? " Place" : ""} - T${String(p.troop_number).replace(/^T/i, '')} ${p.name}`;
                registry.push({
                    type: 'overall',
                    gameId: 'OVERALL',
                    gameName: "OVERALL",
                    rank: finalRank,
                    entityName: p.name,
                    troopNumber: p.troop_number,
                    line4Text: line4,
                    entryData: {}
                });
            }
        });
    }

    return registry;
}
// END v1
    return getWinnersRegistry();
}

// ---------------------------------------------------------------------------
// The announcer sheet's per-game top places (for comparison only; not the reference).
// glue: renderAnnouncerSheet() up to the per-game blocks, with the games and view mode passed in.
export function v1AnnouncerGameBlocks(appData, games, currentViewMode) {
    const blocks = [];
// BEGIN v1 public/js/utils.js:717-753
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
        let curRank = 0, lastTotal = null;
        scored.forEach(s => {
            if (s._total !== lastTotal) { curRank++; lastTotal = s._total; }
            s._rank = curRank;
            s._rankLabel = s.score_payload.manual_rank || getOrdinalSuffix(curRank);
        });

        // Keep top 3 places (including ties)
        const topPlaces = scored.filter(s => s._rank <= 3);
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
