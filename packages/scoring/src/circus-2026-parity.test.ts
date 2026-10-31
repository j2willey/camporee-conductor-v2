/**
 * Key test (issue #3): packages/scoring reproduces what v1 computed at Circus 2026, from the same data.
 * Expected values are v1-golden.json, produced by the v1 code the event laptop ran.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "../scripts/circus-2026-as-run.ts";
import {
  GOLDEN_FILE,
  PRINTED_STICKERS_FILE,
  type V1Golden,
} from "../scripts/v1-golden.ts";
import { scoreEvent, type EntryResult } from "./index.ts";

const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as V1Golden;
const printed = (
  JSON.parse(readFileSync(PRINTED_STICKERS_FILE, "utf8")) as {
    stickers: V1Golden["stickers"];
  }
).stickers;
const circus = loadCircus2026AsRun();
const results = scoreEvent(circus.input);

/** v1 ranks are ordinals ("4th") or an Official's text ("3", "3 Place"); compare the number. */
const place = (rank: string): number => Number(/\d+/.exec(rank)?.[0]);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Each finalized game's entries, projected to the given properties, sorted by entrant. */
function perGame<T>(
  pick: (r: EntryResult) => T,
): { gameId: string; results: ({ entityId: string } & T)[] }[] {
  return golden.games.map(({ gameId }) => {
    const activityId = circus.activityIdOf(gameId);
    const activity = results.activities.find(
      (a) => a.activityId === activityId,
    );
    return {
      gameId,
      results: (activity?.entries ?? [])
        .map((r) => ({ entityId: r.entrantId, ...pick(r) }))
        .sort((a, b) => cmp(a.entityId, b.entityId)),
    };
  });
}

describe("Circus 2026 parity with v1's Officials' results", () => {
  it("gives every entry in the 18 finalized games v1's total", () => {
    expect(perGame((r) => ({ total: r.total }))).toEqual(
      golden.games.map((g) => ({
        gameId: g.gameId,
        results: g.results.map(({ entityId, total }) => ({ entityId, total })),
      })),
    );
  });

  it("gives each entry v1's automatic rank as its Provisional Ranking", () => {
    expect(perGame((r) => ({ rank: r.provisionalRank }))).toEqual(
      golden.games.map((g) => ({
        gameId: g.gameId,
        results: g.results.map(({ entityId, autoRank }) => ({
          entityId,
          rank: place(autoRank),
        })),
      })),
    );
  });

  it("gives each entry v1's Final Rank, with the Officials' 88 rank overrides", () => {
    expect(perGame((r) => ({ rank: r.finalRank }))).toEqual(
      golden.games.map((g) => ({
        gameId: g.gameId,
        results: g.results.map(({ entityId, finalRank }) => ({
          entityId,
          rank: place(finalRank),
        })),
      })),
    );
  });

  it("gives each entry v1's placement points", () => {
    expect(perGame((r) => ({ points: r.points }))).toEqual(
      golden.games.map((g) => ({
        gameId: g.gameId,
        results: g.results.map(({ entityId, points }) => ({
          entityId,
          points,
        })),
      })),
    );
  });

  it("ranks all 30 Teams in Patrol Games overall as v1's Officials' leaderboard did", () => {
    const competitionId = circus.competitionIdOf("patrol-games");
    const standings = results.standings.find(
      (s) => s.competitionId === competitionId,
    );
    expect(
      (standings?.entrants ?? [])
        .map((e) => ({ entityId: e.entrantId, total: e.total, rank: e.rank }))
        .sort((a, b) => cmp(a.entityId, b.entityId)),
    ).toEqual(
      golden.overall
        .map(({ entityId, total, rank }) => ({
          entityId,
          total,
          rank: place(rank),
        }))
        .sort((a, b) => cmp(a.entityId, b.entityId)),
    );
  });

  it("places the same Teams 1st to 3rd as the 63 award stickers printed at the event", () => {
    const competitionId = circus.competitionIdOf("patrol-games");
    const perActivity = perGame((r) => ({ rank: r.finalRank })).flatMap((g) =>
      g.results
        .filter((r) => r.rank <= 3)
        .map((r) => `${g.gameId} ${r.rank} ${r.entityId}`),
    );
    const overall = (
      results.standings.find((s) => s.competitionId === competitionId)
        ?.entrants ?? []
    )
      .filter((e) => e.rank <= 3)
      .map((e) => `OVERALL ${e.rank} ${e.entrantId}`);
    expect([...perActivity, ...overall].sort()).toEqual(
      printed.map((s) => `${s.gameId} ${place(s.rank)} ${s.entityId}`).sort(),
    );
  });
});
