/**
 * Core Schema Definitions for Camporee Conductor
 * Shared between Server (Node.js) and Client (Browser)
 */

export const FIELD_TYPES = {
    TEXT: 'text',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    TIMED: 'timed',
    STOPWATCH: 'stopwatch',
    SELECT: 'select',
    RANGE: 'range',
    TEXTAREA: 'textarea'
};

/**
 * Normalizes a raw game definition (from JSON or Composer) into a runtime-ready object.
 * Handles the translation of Composer 'components' to Runtime 'fields'.
 *
 * @param {Object} gameDef - The raw game definition object loaded from disk/network.
 * @param {number} [playlistOrder=0] - The sort order from the playlist manifest.
 * @returns {Object} The normalized game object.
 */
export function normalizeGameDefinition(gameDef, playlistOrder = 0) {
    // Clone to avoid mutating the input
    const game = JSON.parse(JSON.stringify(gameDef));

    // Create source_snapshot if imported from library but missing one
    if ((game.library_uuid || game.library_ref_id) && !game.source_snapshot) {
        game.source_snapshot = {
            content: game.content ? JSON.parse(JSON.stringify(game.content)) : {},
            scoring_model: game.scoring_model ? JSON.parse(JSON.stringify(game.scoring_model)) : {}
        };
    }

    // Support library vs instance titles
    // library templates may provide `base_title`; instances use `content.title`
    if (!game.base_title && game.title) game.base_title = game.title;
    if (!game.content || typeof game.content !== 'object') game.content = {};
    if (!game.content.title && game.title) game.content.title = game.title;
    if (!game.content.title) game.content.title = game.base_title || 'Untitled Game';

    // Normalize variants array: each variant { id, label, description, scoring_override }
    if (!Array.isArray(game.variants)) game.variants = [];
    game.variants = game.variants.map(v => {
        const variant = Object.assign({}, v || {});
        variant.id = variant.id || (`variant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        variant.label = variant.label || variant.name || 'Variant';
        variant.description = variant.description || '';
        if (variant.scoring_override && typeof variant.scoring_override === 'object') {
            // deep-clone scoring_override
            variant.scoring_override = JSON.parse(JSON.stringify(variant.scoring_override));
        } else {
            variant.scoring_override = null;
        }
        return variant;
    });

    // --- THE TRANSLATION LAYER ---
    // Map Composer Schema (scoring.components) -> Collator Schema (fields)
    // Prefer explicit scoring.components; fall back to scoring_model.inputs if present
    let components = [];

    if (game.scoring && Array.isArray(game.scoring.components)) {
        components = game.scoring.components;
    } else if (game.scoring_model && Array.isArray(game.scoring_model.inputs)) {
        components = game.scoring_model.inputs.map(i => ({
            id: i.id || (`score-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            label: i.label || i.name || '',
            type: i.type || 'number',
            kind: i.type === 'timer' ? 'metric' : (i.kind || 'points'),
            weight: typeof i.weight !== 'undefined' ? i.weight : 1,
            audience: i.audience || 'judge',
            phase: i.phase || 1,
            config: {
                min: i.config?.min ?? i.min ?? 0,
                max: i.config?.max ?? i.max_points ?? i.max ?? 0,
                placeholder: i.config?.placeholder ?? i.placeholder ?? '',
                ...(i.config?.options ? { options: i.config.options } : {}),
                ...(i.config?.defaultValue !== undefined ? { defaultValue: i.config.defaultValue } : {})
            }
        }));
    }

    game.scoring_mode = game.scoring_mode || 'sequential';

    game.fields = components.map(comp => ({
        id: comp.id,
        label: comp.label,
        type: comp.type === FIELD_TYPES.STOPWATCH || comp.type === 'timer' ? FIELD_TYPES.TIMED : comp.type,
        kind: comp.kind,
        weight: comp.weight,
        audience: comp.audience || 'judge',
        phase: comp.phase || 1,
        ...(comp.config || {}) // Spread min/max/placeholder into root
    }));

    game.sortOrder = playlistOrder * 10;

    return game;
}
/**
 * Common Utility Functions
 */

export function formatGameTitle(game) {
    if (!game) return '';
    // If name already has Exhibition prefix, assume legacy and leave it
    if (game.name.match(/^(Exhibition)/i)) return game.name;

    // Remove legacy 'Game X. ' prefix if it's already explicitly in the title so we don't duplicate
    let rawName = game.name.replace(/^Game\s*\d+\.\s*/i, '');

    // Use type if available, otherwise fallback to guessing from ID
    let prefixLetter = 'g';
    if (game.type === 'patrol') prefixLetter = 'p';
    else if (game.type === 'troop') prefixLetter = 't';
    else if (game.type === 'exhibition') prefixLetter = 'e';
    else if (game.id?.startsWith('p')) prefixLetter = 'p';
    else if (game.id?.startsWith('t')) prefixLetter = 't';
    else if (game.id?.startsWith('e')) prefixLetter = 'e';

    // Prefer per-type display number (set by Collator), then sortOrder position, then filename number
    let num;
    if (game.displayOrder !== undefined) {
        num = game.displayOrder;
    } else if (game.sortOrder !== undefined) {
        num = game.sortOrder / 10;
    } else {
        const match = game.id?.match(/(\d+)/);
        num = match ? match[1] : '';
    }

    if (num) return `${prefixLetter}${num}. ${rawName}`;
    return rawName;
}

export function getOrdinalSuffix(i) {
    const j = i % 10, k = i % 100;
    if (j == 1 && k != 11) {
        return i + "st";
    }
    if (j == 2 && k != 12) {
        return i + "nd";
    }
    if (j == 3 && k != 13) {
        return i + "rd";
    }
    return i + "th";
}

export function getPointsForRank(r) {
    const m = String(r).match(/\d+/);
    const n = m ? parseInt(m[0]) : 999;
    if (n === 1) return 100;
    if (n === 2) return 90;
    if (n === 3) return 80;
    if (n === 4) return 70;
    if (n === 5) return 60;
    return 50;
}

/**
 * Shared Status Detection Logic
 * Detects if an event is 'empty', 'active' (started/heats), or 'results' (has scores).
 */
export function getEventStatus(gameId, bracketData = {}) {
    const bracket = bracketData[gameId];
    if (!bracket || !bracket.rounds || bracket.rounds.length === 0) return 'empty';

    // Check if any heats have results
    let hasResults = false;
    bracket.rounds.forEach(r => {
        if (r.heats && r.heats.some(h => Object.keys(h.results || {}).length > 0)) {
            hasResults = true;
        }
    });

    if (hasResults) return 'results';
    return 'active';
}

/**
 * Robust UUID Generator
 * Works in non-secure contexts (HTTP) where crypto.randomUUID is unavailable.
 */
export function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        try {
            return crypto.randomUUID();
        } catch (e) {
            // Safari throws if not in secure context even if property exists
        }
    }

    // Fallback for non-HTTPS or missing randomUUID
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        return ([1e7] + -1e3 + -4e3 + -8e3 + -11e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    // Ultimate fallback for ancient/restricted environments
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Return effective scoring for a game, optionally applying a variant's scoring_override.
 * @param {Object} gameDef - raw or normalized game definition
 * @param {string} [variantId] - optional variant id to apply
 * @returns {Array|Object} scoring components/object to use for this game/variant
 */
export function getEffectiveScoring(gameDef, variantId) {
    // Normalize first to ensure variants and scoring are present
    const g = normalizeGameDefinition(gameDef);
    if (variantId && Array.isArray(g.variants)) {
        const v = g.variants.find(x => x.id === variantId);
        if (v && v.scoring_override) {
            // scoring_override might be in either composer or collator shape; return deep clone
            return JSON.parse(JSON.stringify(v.scoring_override));
        }
    }
    // Default to base scoring as originally defined (return deep clone)
    return JSON.parse(JSON.stringify(g.scoring || g.scoring_model || g.fields || []));
}

