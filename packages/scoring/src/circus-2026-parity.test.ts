/**
 * Key test (issue #3): packages/scoring reproduces what v1 computed at Circus 2026, from the same data.
 * Expected values are v1-golden.json, produced by the v1 code the event laptop ran.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "../scripts/circus-2026-as-run.ts";
import { GOLDEN_FILE, type V1Golden } from "../scripts/v1-golden.ts";
import { scoreEvent, type EntryResult } from "./index.ts";

const golden = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")) as V1Golden;
const circus = loadCircus2026AsRun();
const results = scoreEvent(circus.input);

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
});
