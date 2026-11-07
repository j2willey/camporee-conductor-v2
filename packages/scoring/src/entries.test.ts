import { describe, expect, it } from "vitest";
import { inRankOrder, newestEntries, type ActivityResults } from "./index.ts";

// Two helpers for showing an Activity's results (#40 PR 3): which score entry counts when one entrant has
// several, and the order to list results in. Both are scoring rules, so they live here (ADR-0019, 0027).

const entry = (id: string, activityId: string, entrantId: string) => ({
  id,
  activityId,
  entrantId,
  values: {},
});

describe("newestEntries: one entry per entrant per Activity, the newest received (ADR-0027 item 9)", () => {
  it("keeps the last entry received for each entrant at each Activity", () => {
    const entries = [
      entry("a1", "clown-car", "team-1"),
      entry("a2", "clown-car", "team-2"),
      entry("a3", "clown-car", "team-1"),
    ];
    expect(newestEntries(entries).map((e) => e.id)).toEqual(["a2", "a3"]);
  });

  it("keeps entries for the same entrant at different Activities apart", () => {
    const entries = [
      entry("a1", "clown-car", "team-1"),
      entry("b1", "high-wire", "team-1"),
    ];
    expect(newestEntries(entries).map((e) => e.id)).toEqual(["a1", "b1"]);
  });

  it("keeps everything else the entries carry", () => {
    const entries = [{ ...entry("a1", "x", "t"), receivedSeq: 7 }];
    expect(newestEntries(entries)).toEqual(entries);
  });

  it("gives nothing for nothing", () => {
    expect(newestEntries([])).toEqual([]);
  });
});

describe("inRankOrder: an Activity's results in the order to list them", () => {
  const ranked = (entrantId: string, finalRank: number, total = 0) => ({
    entrantId,
    total,
    provisionalRank: finalRank,
    finalRank,
    points: 0,
    disqualified: false as const,
  });
  const dq = (entrantId: string) => ({
    entrantId,
    total: 0,
    points: 0 as const,
    disqualified: true as const,
  });
  const results = (
    entries: ActivityResults["entries"],
    finalized = false,
  ): ActivityResults => ({
    activityId: "clown-car",
    competitionId: "games",
    finalized,
    entries,
  });

  it("lists by Final Ranking, best first", () => {
    expect(
      inRankOrder(
        results([ranked("c", 3), ranked("a", 1), ranked("b", 2)]),
      ).map((e) => e.entrantId),
    ).toEqual(["a", "b", "c"]);
  });

  it("keeps the listing order among tied entrants", () => {
    expect(
      inRankOrder(
        results([ranked("y", 2), ranked("x", 1), ranked("z", 1)]),
      ).map((e) => e.entrantId),
    ).toEqual(["x", "z", "y"]);
  });

  it("lists DQ'd entrants last, in listing order", () => {
    expect(
      inRankOrder(
        results([dq("q"), ranked("a", 1), dq("p"), ranked("b", 2)]),
      ).map((e) => e.entrantId),
    ).toEqual(["a", "b", "q", "p"]);
  });

  it("never re-sorts a finalized Activity: its stored order stands (ADR-0019)", () => {
    expect(
      inRankOrder(results([ranked("b", 2), ranked("a", 1)], true)).map(
        (e) => e.entrantId,
      ),
    ).toEqual(["b", "a"]);
  });
});
