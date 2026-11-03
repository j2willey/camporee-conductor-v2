import { describe, expect, it } from "vitest";
import { scoreEvent, type OfficialAction } from "./index.ts";
import { activityId, smallEvent } from "./test-support.ts";

/** The Official action log's own actions (ADR-0019). Scores 30, 20, 10 → ranks 1, 2, 3. */
const SCORES = { t1: 30, t2: 20, t3: 10 };
const target = (entrantId: string, i = 0) => ({
  activityId: activityId(i),
  entrantId,
});
const adjust = (entrantId: string, points: number): OfficialAction => ({
  type: "adjust-points",
  ...target(entrantId),
  points,
});
const setRank = (entrantId: string, rank: number): OfficialAction => ({
  type: "set-final-rank",
  ...target(entrantId),
  rank,
});
const setPoints = (entrantId: string, points: number): OfficialAction => ({
  type: "set-placement-points",
  ...target(entrantId),
  points,
});

/** Activity 0's entries as `entrant → [total, provisional rank, final rank, points]`. */
function results(actions: OfficialAction[]) {
  return Object.fromEntries(
    (
      scoreEvent(smallEvent({ scores: [SCORES], actions })).activities[0]
        ?.entries ?? []
    ).map((e) => [
      e.entrantId,
      e.disqualified
        ? "DQ"
        : [e.total, e.provisionalRank, e.finalRank, e.points],
    ]),
  );
}

describe("adjust-points: an Official's change to an entry's total (v1 Official Score)", () => {
  it("adds to the total, and the Provisional Ranking follows it", () => {
    expect(results([adjust("t3", 25)])).toEqual({
      t1: [30, 2, 2, 90],
      t2: [20, 3, 3, 80],
      t3: [35, 1, 1, 100],
    });
  });

  it("a negative adjustment subtracts", () => {
    expect(results([adjust("t1", -15)])["t1"]).toEqual([15, 2, 2, 90]);
  });

  it("the latest adjust-points for an entry wins; adjustments don't add up", () => {
    expect(results([adjust("t3", 5), adjust("t3", 3)])["t3"]).toEqual([
      13, 3, 3, 80,
    ]);
  });
});

describe("set-final-rank and set-placement-points", () => {
  it("set-final-rank sets only that entry's Final Ranking; nobody else is re-sorted", () => {
    expect(results([setRank("t3", 1)])).toEqual({
      t1: [30, 1, 1, 100],
      t2: [20, 2, 2, 90],
      t3: [10, 3, 1, 100],
    });
  });

  it("the latest set-final-rank wins", () => {
    expect(results([setRank("t3", 1), setRank("t3", 2)])["t3"]).toEqual([
      10, 3, 2, 90,
    ]);
  });

  it("set-placement-points replaces the table's points; the latest wins", () => {
    expect(results([setPoints("t2", 95), setPoints("t2", 85)])).toEqual({
      t1: [30, 1, 1, 100],
      t2: [20, 2, 2, 85],
      t3: [10, 3, 3, 80],
    });
  });

  it("actions for another entrant or Activity don't apply", () => {
    const other: OfficialAction[] = [
      { type: "set-final-rank", ...target("t3", 1), rank: 1 },
      { type: "adjust-points", ...target("t9"), points: 99 },
    ];
    expect(results(other)).toEqual(results([]));
  });
});
