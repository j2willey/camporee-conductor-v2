import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "../scripts/circus-2026-as-run.ts";
import {
  denseRanking,
  placementPoints,
  rankingFor,
  scoreEvent,
  strictRanking,
  withinCutoff,
} from "./index.ts";

/** Three tied for 1st, then two tied (ADR-0019 tie-numbering amendment). */
const SCORES = [10, 10, 10, 8, 8, 5];

describe("tie numbering (ADR-0019 amendment 2026-11-02)", () => {
  it("dense: the next place follows on after a tie (1, 1, 1, 2, 2, 3)", () => {
    expect(SCORES.map(denseRanking(SCORES))).toEqual([1, 1, 1, 2, 2, 3]);
  });

  it("strict: places are skipped after a tie (1, 1, 1, 4, 4, 6)", () => {
    expect(SCORES.map(strictRanking(SCORES))).toEqual([1, 1, 1, 4, 4, 6]);
  });

  it("picks the ranking from the Event's tieNumbering", () => {
    expect(SCORES.map(rankingFor("dense")(SCORES))).toEqual([1, 1, 1, 2, 2, 3]);
    expect(SCORES.map(rankingFor("strict")(SCORES))).toEqual([
      1, 1, 1, 4, 4, 6,
    ]);
  });

  it("gives tied places the same placement points, never split", () => {
    expect(
      SCORES.map(strictRanking(SCORES)).map((r) => placementPoints(r)),
    ).toEqual([100, 100, 100, 70, 70, 50]);
  });
});

describe("scoreEvent uses the Event's tieNumbering", () => {
  const circus = loadCircus2026AsRun();
  const strict = scoreEvent({
    ...circus.input,
    event: { ...circus.input.event, tieNumbering: "strict" },
  });

  /** Strict rank = 1 + how many scored higher. */
  const strictRankOf = (total: number, totals: readonly number[]) =>
    1 + totals.filter((t) => t > total).length;

  it("numbers each Activity's Provisional Ranking strictly", () => {
    let skipped = 0;
    for (const activity of strict.activities) {
      const totals = activity.entries.map((e) => e.total);
      for (const entry of activity.entries) {
        expect(entry.provisionalRank).toBe(strictRankOf(entry.total, totals));
      }
      if (
        totals.some((t) => strictRankOf(t, totals) !== denseRanking(totals)(t))
      )
        skipped++;
    }
    expect(skipped).toBeGreaterThan(0);
  });

  it("numbers overall standings strictly", () => {
    for (const { entrants } of strict.standings) {
      const totals = entrants.map((e) => e.total);
      for (const e of entrants) {
        expect(e.rank).toBe(strictRankOf(e.total, totals));
      }
    }
  });
});

describe("award cutoffs include every entrant tied at the cutoff", () => {
  const ranked = (ranks: number[]) =>
    ranks.map((rank, i) => ({ entrantId: `t${i + 1}`, rank }));

  it("dense: top 4 of 1, 1, 1, 2, 2, 3 takes both tied 2nds (5 entrants)", () => {
    expect(
      withinCutoff(ranked([1, 1, 1, 2, 2, 3]), 4).map((e) => e.entrantId),
    ).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });

  it("strict: top 4 of 1, 1, 1, 4, 4, 6 takes both tied 4ths (5 entrants)", () => {
    expect(
      withinCutoff(ranked([1, 1, 1, 4, 4, 6]), 4).map((e) => e.entrantId),
    ).toEqual(["t1", "t2", "t3", "t4", "t5"]);
  });

  it("takes exactly the count when nobody is tied at the cutoff", () => {
    expect(
      withinCutoff(ranked([3, 1, 2, 4]), 2).map((e) => e.entrantId),
    ).toEqual(["t2", "t3"]);
  });

  it("takes everyone when the count is at least the number of entrants", () => {
    expect(withinCutoff(ranked([1, 2]), 5)).toHaveLength(2);
    expect(withinCutoff(ranked([1, 2]), 0)).toEqual([]);
  });
});
