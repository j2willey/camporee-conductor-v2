import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildV1Golden,
  GOLDEN_FILE,
  PRINTED_STICKERS_FILE,
  type V1Golden,
} from "./v1-golden.ts";

const readJson = <T>(url: URL): T => JSON.parse(readFileSync(url, "utf8")) as T;
const committed = readJson<V1Golden>(GOLDEN_FILE);
const printed = readJson<{ stickers: V1Golden["stickers"] }>(
  PRINTED_STICKERS_FILE,
).stickers;

describe("v1 golden results for Circus 2026", () => {
  it("are up to date with v1's event-day code and the fixtures", () => {
    expect(
      committed,
      "stale: run `pnpm --filter @camporee-conductor/scoring golden` and commit the result",
    ).toEqual(buildV1Golden());
  });

  it("reproduce every award sticker printed at the event, exactly", () => {
    expect(committed.stickers).toEqual(printed);
  });

  it("cover the 18 finalized patrol games, with a Final Rank and points for every entry", () => {
    expect(committed.games).toHaveLength(18);
    for (const game of committed.games) {
      expect(game.competition).toBe("patrol");
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
