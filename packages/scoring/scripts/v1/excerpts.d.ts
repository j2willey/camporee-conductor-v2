import type { V1AppData, V1Entity, V1Game, V1Score } from "./types.d.ts";

export function injectCommonFields(
  normalizedGame: V1Game,
  presets: unknown[],
  typeDefaults: Record<string, unknown>,
): void;

export function v1OfficialGameResults(
  appData: V1AppData,
  gameId: string,
): (V1Score & {
  _total: number;
  _autoRank: string;
  _finalRank: string;
  _finalPoints: number;
})[];

export function v1OfficialLeaderboard(
  appData: V1AppData,
  games: V1Game[],
  patrols: V1Entity[],
): (V1Entity & { _leaderboardTotal: number; _autoOverallRank: string })[];

/** One award sticker. `gameId` is "OVERALL" for overall standings. */
export function v1WinnersRegistry(
  appData: V1AppData,
  currentViewMode: string,
): {
  type: string;
  gameId: string;
  rank: string;
  entityName: string;
  troopNumber: string;
  line4Text: string;
}[];

export function v1AnnouncerGameBlocks(
  appData: V1AppData,
  games: V1Game[],
  currentViewMode: string,
): {
  title: string;
  entries: { rankLabel: string; name: string; score: number }[];
}[];
