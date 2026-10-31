/**
 * Golden results for Circus 2026, produced by the v1 code the event laptop ran (commit 9ebffa5, copied
 * verbatim in ./v1/) from the event-day cartridge and the anonymized results (issue #3).
 * packages/scoring must reproduce `games`, `overall` and `stickers`.
 *
 * The award stickers were printed Saturday afternoon and are what was awarded, so they are the truth;
 * printed-stickers.json records them and a test checks `stickers` against it. Per-game Final Ranks and
 * points come from official.js, overall standings from the Officials' leaderboard. The announcer sheet,
 * written Saturday night, is compared but not trusted.
 */
import { readFileSync } from "node:fs";
import {
  injectCommonFields,
  v1AnnouncerGameBlocks,
  v1OfficialGameResults,
  v1OfficialLeaderboard,
  v1WinnersRegistry,
} from "./v1/excerpts.js";
import { calculateScoreContext } from "./v1/leaderboard.js";
import { normalizeGameDefinition } from "./v1/schema.js";
import type { V1AppData, V1Entity, V1Game, V1Score } from "./v1/types.d.ts";

const RESULTS = new URL("../fixtures/circus-2026-results/", import.meta.url);
/** The cartridge the event laptop ran (schema 2.9). Its field kinds differ from the later v3 copy. */
export const EVENT_DAY_CARTRIDGE = new URL("v1-event-day-cartridge/", RESULTS);
export const GOLDEN_FILE = new URL("v1-golden.json", RESULTS);
export const PRINTED_STICKERS_FILE = new URL("printed-stickers.json", RESULTS);

/** The v1 view mode, and game type, whose standings are checked. */
const VIEW_MODE = "patrol";

export interface V1Golden {
  source: string;
  games: {
    gameId: string;
    competition: string;
    results: {
      entityId: string;
      total: number;
      autoRank: string;
      finalRank: string;
      points: number;
    }[];
  }[];
  overall: { entityId: string; total: number; rank: string }[];
  /** Award stickers; `gameId` "OVERALL" for the overall standings. Ranks as printed. */
  stickers: { gameId: string; rank: string; entityId: string }[];
  comparisons: {
    /** official.js and leaderboard.js gave different placement points for the same entry. */
    leaderboardPointsVsOfficial: {
      gameId: string;
      entityId: string;
      official: number;
      leaderboard: number;
    }[];
    /** Games whose stickers differ from official.js's entries ranked 1-3. */
    stickersVsOfficial: {
      gameId: string;
      official: string[];
      stickers: string[];
    }[];
    /** Games whose announcer sheet, as printed (patrol + position), differs from the stickers. */
    announcerVsStickers: {
      gameId: string;
      stickers: string[];
      announcer: string[];
    }[];
    /** Patrols whose overall total or rank changes if summed from official.js points instead. */
    overallFromOfficialPoints: {
      entityId: string;
      leaderboardTotal: number;
      officialTotal: number;
      leaderboardRank: string;
      officialRank: string;
    }[];
  };
}

const readJson = <T>(url: URL): T => JSON.parse(readFileSync(url, "utf8")) as T;

/** Builds v1's games the way its server did (collator.js loadCamporeeData, minus file I/O). */
function loadV1Games(): V1Game[] {
  const manifest = readJson<{
    playlist: { gameId: string; order: number; enabled?: boolean }[];
    type_defaults: Record<string, unknown>;
  }>(new URL("camporee.json", EVENT_DAY_CARTRIDGE));
  const presets = readJson<unknown[]>(
    new URL("presets.json", EVENT_DAY_CARTRIDGE),
  );
  const games: V1Game[] = [];
  for (const item of manifest.playlist) {
    if (item.enabled === false) continue;
    const gameDef = readJson<{
      name?: string;
      content?: { title?: string };
    }>(new URL(`games/${item.gameId}.json`, EVENT_DAY_CARTRIDGE));
    const game = normalizeGameDefinition(gameDef, item.order);
    if (!gameDef.name && gameDef.content?.title)
      game.name = gameDef.content.title;
    injectCommonFields(game, presets, manifest.type_defaults);
    games.push(game);
  }
  return games.sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Builds the browser's appData the way v1's API returned it. */
function loadV1AppData(): V1AppData {
  const entities = readJson<V1Entity[]>(new URL("entities.json", RESULTS));
  const byId = new Map(entities.map((e) => [e.id, e]));
  const rows = readJson<
    Omit<V1Score, "entity_name" | "troop_number" | "entity_type">[]
  >(new URL("scores.json", RESULTS));
  // /api/admin/all-data joins each score to its entity.
  const scores = rows.flatMap((s) => {
    const e = byId.get(s.entity_id);
    return e
      ? [
          {
            uuid: s.uuid,
            game_id: s.game_id,
            entity_id: s.entity_id,
            timestamp: s.timestamp,
            entity_name: e.name,
            troop_number: e.troop_number,
            entity_type: e.type,
            score_payload: s.score_payload,
          },
        ]
      : [];
  });
  return {
    games: loadV1Games(),
    entities,
    scores,
    // games.json has no common_scoring; Common Fields are injected into each game instead.
    commonScoring: undefined,
    // 9ebffa5 had no DQ flags (added later in v1).
    flags: [],
  };
}

const rankNumber = (rank: string): number =>
  Number(/\d+/.exec(rank)?.[0] ?? Number.NaN);

/** v1 prints troop numbers as "T251" whether or not the T was stored. */
const troop = (t: string): string => `T${String(t).replace(/^T/i, "")}`;

/** Code-unit order, so sorting doesn't depend on the machine's locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortStickers = (
  a: { gameId: string; rank: string; entityId: string },
  b: { gameId: string; rank: string; entityId: string },
): number =>
  cmp(a.gameId, b.gameId) || cmp(a.rank, b.rank) || cmp(a.entityId, b.entityId);

export function buildV1Golden(): V1Golden {
  const appData = loadV1AppData();
  const finalized = readJson<{ game_id: string; status: string | null }[]>(
    new URL("game-status.json", RESULTS),
  )
    .filter((g) => g.status === "finalized")
    .map((g) => g.game_id)
    .sort();
  const gameById = new Map(appData.games.map((g) => [g.id, g]));
  const teams = appData.entities.filter((e) => e.type === VIEW_MODE);
  const idByName = new Map(
    teams.map((e) => [`${troop(e.troop_number)} ${e.name}`, e.id]),
  );
  const idOf = (name: string): string => idByName.get(name) ?? `?${name}`;
  const leaderboardPoints = calculateScoreContext(appData);

  const stickers = v1WinnersRegistry(appData, VIEW_MODE)
    .map((s) => ({
      gameId: s.gameId,
      rank: String(s.rank),
      entityId: idOf(`${troop(s.troopNumber)} ${s.entityName}`),
    }))
    .sort(sortStickers);
  const stickerKeys = (gameId: string): string[] =>
    stickers
      .filter((s) => s.gameId === gameId)
      .map((s) => `${rankNumber(s.rank)}:${s.entityId}`)
      .sort();

  const games: V1Golden["games"] = [];
  const comparisons: V1Golden["comparisons"] = {
    leaderboardPointsVsOfficial: [],
    stickersVsOfficial: [],
    announcerVsStickers: [],
    overallFromOfficialPoints: [],
  };
  const officialPoints = new Map<string, number>();

  for (const gameId of finalized) {
    const game = gameById.get(gameId);
    if (!game)
      throw new Error(`finalized game ${gameId} is not in the cartridge`);
    const results = v1OfficialGameResults(appData, gameId).sort((a, b) =>
      cmp(a.entity_id, b.entity_id),
    );
    games.push({
      gameId,
      competition: game.type ?? "",
      results: results.map((s) => ({
        entityId: s.entity_id,
        total: s._total,
        autoRank: s._autoRank,
        finalRank: String(s._finalRank),
        points: s._finalPoints,
      })),
    });

    for (const s of results) {
      officialPoints.set(
        s.entity_id,
        (officialPoints.get(s.entity_id) ?? 0) + s._finalPoints,
      );
      const lb = leaderboardPoints[s.entity_id]?.[gameId];
      if (lb !== s._finalPoints) {
        comparisons.leaderboardPointsVsOfficial.push({
          gameId,
          entityId: s.entity_id,
          official: s._finalPoints,
          leaderboard: lb ?? 0,
        });
      }
    }

    const official = results
      .filter((s) => rankNumber(String(s._finalRank)) <= 3)
      .map((s) => `${rankNumber(String(s._finalRank))}:${s.entity_id}`)
      .sort();
    if (official.join() !== stickerKeys(gameId).join()) {
      comparisons.stickersVsOfficial.push({
        gameId,
        official,
        stickers: stickerKeys(gameId),
      });
    }

    const announcer = (
      v1AnnouncerGameBlocks(appData, [game], VIEW_MODE)[0]?.entries ?? []
    )
      .map((e, i) => {
        // The sheet prints each entry as "<position>. Dark Dragons  (T251)": it numbers by position
        // in the raw-total order (utils.js renderAnnouncerSheet), not by rankLabel.
        const m = /^(.*) {2}\((T[^)]*)\)$/.exec(e.name);
        return `${i + 1}:${idOf(m ? `${m[2]} ${m[1]}` : e.name)}`;
      })
      .sort();
    if (stickerKeys(gameId).join() !== announcer.join()) {
      comparisons.announcerVsStickers.push({
        gameId,
        stickers: stickerKeys(gameId),
        announcer,
      });
    }
  }

  const teamGames = appData.games.filter(
    (g) => (g.type ?? VIEW_MODE) === VIEW_MODE,
  );
  const standings = v1OfficialLeaderboard(appData, teamGames, teams)
    .map((p) => ({
      entityId: p.id,
      total: p._leaderboardTotal,
      rank: p.manual_rank || p._autoOverallRank,
    }))
    .sort(
      (a, b) =>
        rankNumber(a.rank) - rankNumber(b.rank) || cmp(a.entityId, b.entityId),
    );

  // What the overall standings would be if summed from official.js's per-game points.
  const distinctDesc = [
    ...new Set(teams.map((t) => officialPoints.get(t.id) ?? 0)),
  ].sort((a, b) => b - a);
  for (const s of standings) {
    const officialTotal = officialPoints.get(s.entityId) ?? 0;
    const officialRank = distinctDesc.indexOf(officialTotal) + 1;
    if (officialTotal !== s.total || officialRank !== rankNumber(s.rank)) {
      comparisons.overallFromOfficialPoints.push({
        entityId: s.entityId,
        leaderboardTotal: s.total,
        officialTotal,
        leaderboardRank: s.rank,
        officialRank: String(officialRank),
      });
    }
  }

  return {
    source:
      "v1 commit 9ebffa5 (event day) with the event-day cartridge: official.js (per-game), official.js + leaderboard.js (overall), utils.js getWinnersRegistry (stickers); see scripts/v1/",
    games,
    overall: standings,
    stickers,
    comparisons,
  };
}
