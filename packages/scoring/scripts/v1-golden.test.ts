import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildV1Golden, GOLDEN_FILE, type V1Golden } from "./v1-golden.ts";

const committed = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as V1Golden;

describe("v1 golden results for Circus 2026", () => {
  it("are up to date with v1's code and the fixtures", () => {
    expect(
      committed,
      "stale: run `pnpm --filter @camporee-conductor/scoring golden` and commit the result",
    ).toEqual(buildV1Golden());
  });

  it("cover the 18 finalized patrol games, with a Final Rank and points for every entry", () => {
    expect(committed.games).toHaveLength(18);
    for (const game of committed.games) {
      expect(game.competition).toBe("patrol-games");
      expect(game.results.length).toBeGreaterThan(0);
      for (const r of game.results) {
        expect(r.finalRank).toMatch(/\d/);
        expect(typeof r.points).toBe("number");
      }
    }
  });

  it("rank all 30 patrols overall", () => {
    expect(committed.overall).toHaveLength(30);
    expect(
      committed.overall.every((p) => /^\d+(st|nd|rd|th)$/.test(p.rank)),
    ).toBe(true);
  });
});
