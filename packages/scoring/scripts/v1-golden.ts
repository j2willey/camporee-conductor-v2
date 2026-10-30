/**
 * Golden results for Circus 2026, produced by v1's own code (copied verbatim in ./v1/) from the
 * anonymized fixtures (issue #3). packages/scoring must reproduce `games` and `overall`.
 *
 * Reference: the Officials' results path. Per-game Final Ranks and points come from official.js
 * (what Officials finalized and ribbons came from). Overall standings come from the Officials'
 * leaderboard, which v1 computed with leaderboard.js. The announcer sheet is compared, not trusted.
 */
import { readFileSync } from "node:fs";
import {
  injectCommonFields,
  v1AnnouncerGameBlocks,
  v1OfficialGameResults,
  v1OfficialLeaderboard,
} from "./v1/excerpts.js";
import { calculateScoreContext } from "./v1/leaderboard.js";
import { normalizeGameDefinition } from "./v1/schema.js";
import type { V1AppData, V1Entity, V1Game, V1Score } from "./v1/types.d.ts";

const V1_SOURCE = new URL(
  "../../schema/fixtures/circus-2026/v1-source/",
  import.meta.url,
);
const RESULTS = new URL("../fixtures/circus-2026-results/", import.meta.url);
export const GOLDEN_FILE = new URL("v1-golden.json", RESULTS);

/** The v1 Competition whose standings are checked. */
const TEAM_COMPETITION = "patrol-games";

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
  comparisons: {
    /** official.js and leaderboard.js gave different placement points for the same entry. */
    leaderboardPointsVsOfficial: {
      gameId: string;
      entityId: string;
      official: number;
      leaderboard: number;
    }[];
    /** The announcer sheet's top places differ from official.js. */
    announcerVsOfficial: {
      gameId: string;
      official: string[];
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
    leagues: unknown[];
  }>(new URL("camporee.json", V1_SOURCE));
  const presets = readJson<unknown[]>(new URL("presets.json", V1_SOURCE));
  const games: V1Game[] = [];
  for (const item of manifest.playlist) {
    if (item.enabled === false) continue;
    const gameDef = readJson<{
      name?: string;
      content?: { title?: string };
    }>(new URL(`games/${item.gameId}.json`, V1_SOURCE));
    const game = normalizeGameDefinition(gameDef, item.order);
    if (!gameDef.name && gameDef.content?.title)
      game.name = gameDef.content.title;
    injectCommonFields(game, presets, manifest.type_defaults, manifest.leagues);
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
    // This database predates v1's official_game_flags table, so there are no DQ flags.
    flags: [],
  };
}

const rankNumber = (rank: string): number =>
  Number(/\d+/.exec(rank)?.[0] ?? Number.NaN);

export function buildV1Golden(): V1Golden {
  const appData = loadV1AppData();
  const finalized = readJson<{ game_id: string; status: string | null }[]>(
    new URL("game-status.json", RESULTS),
  )
    .filter((g) => g.status === "finalized")
    .map((g) => g.game_id)
    .sort();
  const gameById = new Map(appData.games.map((g) => [g.id, g]));
  const leaderboardPoints = calculateScoreContext(appData);

  const games: V1Golden["games"] = [];
  const comparisons: V1Golden["comparisons"] = {
    leaderboardPointsVsOfficial: [],
    announcerVsOfficial: [],
    overallFromOfficialPoints: [],
  };
  const officialPoints = new Map<string, number>();

  for (const gameId of finalized) {
    const game = gameById.get(gameId);
    if (!game)
      throw new Error(`finalized game ${gameId} is not in the cartridge`);
    const results = v1OfficialGameResults(appData, gameId).sort((a, b) =>
      a.entity_id.localeCompare(b.entity_id),
    );
    games.push({
      gameId,
      competition: game.league ?? "",
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

    const label = (s: { entity_name: string; troop_number: string }): string =>
      `${s.entity_name}  (T${String(s.troop_number).replace(/^T/i, "")})`;
    const idByLabel = new Map(results.map((s) => [label(s), s.entity_id]));
    const official = results
      .filter((s) => rankNumber(String(s._finalRank)) <= 3)
      .map((s) => `${rankNumber(String(s._finalRank))}:${s.entity_id}`)
      .sort();
    const announcer = (
      v1AnnouncerGameBlocks(appData, [game], "patrol")[0]?.entries ?? []
    )
      .map(
        (e) =>
          `${rankNumber(e.rankLabel)}:${idByLabel.get(e.name) ?? `?${e.name}`}`,
      )
      .sort();
    if (official.join() !== announcer.join()) {
      comparisons.announcerVsOfficial.push({ gameId, official, announcer });
    }
  }

  const teamGames = appData.games.filter(
    (g) => (g.league ?? TEAM_COMPETITION) === TEAM_COMPETITION,
  );
  const teams = appData.entities.filter((e) => e.type === "patrol");
  const standings = v1OfficialLeaderboard(appData, teamGames, teams)
    .map((p) => ({
      entityId: p.id,
      total: p._leaderboardTotal,
      rank: p.manual_rank || p._autoOverallRank,
    }))
    .sort(
      (a, b) =>
        rankNumber(a.rank) - rankNumber(b.rank) ||
        a.entityId.localeCompare(b.entityId),
    );

  // What the overall standings would be if summed from official.js's per-game points.
  const officialTotals = teams.map((t) => ({
    id: t.id,
    total: officialPoints.get(t.id) ?? 0,
  }));
  const distinctDesc = [...new Set(officialTotals.map((t) => t.total))].sort(
    (a, b) => b - a,
  );
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
      "v1 commit 3947fd6: official.js (per-game), official.js + leaderboard.js (overall); see scripts/v1/",
    games,
    overall: standings,
    comparisons,
  };
}
