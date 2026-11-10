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
import {
  scoreEvent,
  type EntryResult,
  type OfficialAction,
  type Standing,
} from "./index.ts";

const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as V1Golden;
const printed = (
  JSON.parse(readFileSync(PRINTED_STICKERS_FILE, "utf8")) as {
    stickers: V1Golden["stickers"];
  }
).stickers;
const circus = loadCircus2026AsRun();
const results = scoreEvent(circus.input);

// v1 had no DQ at the event (it was added 2026-05-21), so every result here is ranked. A DQ would
// have no rank and fail the comparison with the golden files.
const provisionalRank = (r: EntryResult) =>
  r.disqualified ? undefined : r.provisionalRank;
const finalRank = (r: EntryResult) =>
  r.disqualified ? undefined : r.finalRank;
const standingRank = (s: Standing) => (s.disqualified ? undefined : s.rank);

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
  it("has no DQs: v1 had no DQ at Circus 2026", () => {
    expect(
      results.activities
        .flatMap((a) => a.entries)
        .filter((e) => e.disqualified),
    ).toEqual([]);
    expect(
      results.standings
        .flatMap((c) => c.entrants)
        .filter((e) => e.disqualified),
    ).toEqual([]);
  });

  it("gives every entry in the 18 finalized games v1's total", () => {
    expect(perGame((r) => ({ total: r.total }))).toEqual(
      golden.games.map((g) => ({
        gameId: g.gameId,
        results: g.results.map(({ entityId, total }) => ({ entityId, total })),
      })),
    );
  });

  it("gives each entry v1's automatic rank as its Provisional Ranking", () => {
    expect(perGame((r) => ({ rank: provisionalRank(r) }))).toEqual(
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
    expect(perGame((r) => ({ rank: finalRank(r) }))).toEqual(
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
        .map((e) => ({
          entityId: e.entrantId,
          total: e.total,
          rank: standingRank(e),
        }))
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
    const perActivity = perGame((r) => ({ rank: finalRank(r) })).flatMap((g) =>
      g.results
        .filter((r) => r.rank !== undefined && r.rank <= 3)
        .map((r) => `${g.gameId} ${r.rank} ${r.entityId}`),
    );
    const overall = (
      results.standings.find((s) => s.competitionId === competitionId)
        ?.entrants ?? []
    ).flatMap((e) => {
      const rank = standingRank(e);
      return rank !== undefined && rank <= 3
        ? [`OVERALL ${rank} ${e.entrantId}`]
        : [];
    });
    expect([...perActivity, ...overall].sort()).toEqual(
      printed.map((s) => `${s.gameId} ${place(s.rank)} ${s.entityId}`).sort(),
    );
  });
});

describe("Circus 2026 finalized as v1's Officials left it", () => {
  // v1 stored only a Draft/Final switch per game, not a ranking: it recomputed every time. So each of
  // the 18 finalized games is frozen here with the Final Rank and points v1 showed, logged after every
  // override, as a v2 Official would have. The real check is that a recompute agrees: no warning.
  const finalizeActions = golden.games.map((g): OfficialAction => ({
    type: "finalize",
    activityId: circus.activityIdOf(g.gameId),
    ranking: [...g.results]
      .sort(
        (a, b) =>
          place(a.finalRank) - place(b.finalRank) ||
          cmp(a.entityId, b.entityId),
      )
      .map((r) => ({
        entrantId: r.entityId,
        rank: place(r.finalRank),
        points: r.points,
        disqualified: false,
      })),
  }));
  const finalized = scoreEvent({
    ...circus.input,
    actions: [...circus.input.actions, ...finalizeActions],
  });

  it("finalizes the 18 games, and a recompute from the scores agrees with every one", () => {
    expect(finalized.warnings).toEqual([]);
    expect(
      finalized.activities.filter((a) => a.finalized).map((a) => a.activityId),
    ).toEqual(
      expect.arrayContaining(
        golden.games.map((g) => circus.activityIdOf(g.gameId)),
      ) as string[],
    );
    expect(finalized.activities.filter((a) => a.finalized)).toHaveLength(18);
  });

  it("gives the same results and standings as the recompute", () => {
    expect(finalized.activities).toEqual(
      results.activities.map((a) =>
        finalizeActions.some(
          (f) => f.type === "finalize" && f.activityId === a.activityId,
        )
          ? {
              ...a,
              finalized: true,
              finalizedBy: expect.any(Object) as { actionIndex: number },
              entries: expect.arrayContaining(a.entries) as EntryResult[],
            }
          : a,
      ),
    );
    expect(finalized.standings).toEqual(results.standings);
    expect(finalized.awards).toEqual(results.awards);
  });
});
