import { describe, expect, it } from "vitest";
import { finalizeRanking, scoreEvent, type OfficialAction } from "./index.ts";
import { activityId, smallEvent } from "./test-support.ts";

/** Scoring reports the actions behind each result (ADR-0019 2026-11-10, #42). */
const A = activityId(0);
const SCORES = { t1: 30, t2: 20, t3: 10 };
const target = (entrantId: string) => ({ activityId: A, entrantId });

const finalize = (): OfficialAction => ({
  type: "finalize",
  activityId: A,
  ranking: [
    { entrantId: "t1", rank: 1, points: 100, disqualified: false },
    { entrantId: "t2", rank: 2, points: 90, disqualified: false },
    { entrantId: "t3", rank: 3, points: 80, disqualified: false },
  ],
});

function run(actions: OfficialAction[]) {
  const results = scoreEvent(smallEvent({ scores: [SCORES], actions }));
  const activity = results.activities[0];
  const of = (id: string) => activity?.entries.find((e) => e.entrantId === id);
  return { results, activity, of };
}

describe("rankOverride", () => {
  const rank: OfficialAction = {
    type: "set-final-rank",
    ...target("t2"),
    rank: 1,
  };
  it("is reported as applied with its action index", () => {
    const { of } = run([
      finalize(),
      { type: "unfinalize", activityId: A },
      rank,
    ]);
    expect(of("t2")).toMatchObject({
      finalRank: 1,
      rankOverride: { actionIndex: 2, rank: 1, state: "applied" },
    });
    expect(of("t1")?.rankOverride).toBeUndefined();
  });
  it("the latest wins", () => {
    const { of } = run([rank, { ...rank, rank: 3 }]);
    expect(of("t2")?.rankOverride).toEqual({
      actionIndex: 1,
      rank: 3,
      state: "applied",
    });
  });
  it("is held after a finalize, and the place doesn't move", () => {
    const { of } = run([finalize(), rank]);
    expect(of("t2")).toMatchObject({
      finalRank: 2,
      rankOverride: { actionIndex: 1, rank: 1, state: "held" },
    });
  });
  it("a held one is reported in place of an earlier applied one, which still decides", () => {
    const { of } = run([{ ...rank, rank: 3 }, finalize(), rank]);
    expect(of("t2")?.rankOverride).toEqual({
      actionIndex: 2,
      rank: 1,
      state: "held",
    });
  });
});

describe("adjustment", () => {
  const adjust: OfficialAction = {
    type: "adjust-points",
    ...target("t2"),
    points: 15,
  };
  it("is reported as applied", () => {
    const { of } = run([adjust]);
    expect(of("t2")).toMatchObject({
      total: 35,
      adjustment: { actionIndex: 0, points: 15, state: "applied" },
    });
  });
  it("is held after a finalize", () => {
    const { of } = run([finalize(), adjust]);
    expect(of("t2")).toMatchObject({
      total: 20,
      adjustment: { actionIndex: 1, points: 15, state: "held" },
    });
  });
});

describe("dq", () => {
  const dq = (disqualified: boolean): OfficialAction => ({
    type: "disqualify",
    ...target("t1"),
    disqualified,
  });
  it("is reported when DQ'd and when reinstated", () => {
    expect(run([dq(true)]).of("t1")).toMatchObject({
      disqualified: true,
      dq: { actionIndex: 0, disqualified: true, state: "applied" },
    });
    expect(run([dq(true), dq(false)]).of("t1")).toMatchObject({
      disqualified: false,
      dq: { actionIndex: 1, disqualified: false, state: "applied" },
    });
  });
  it("is held after a finalize", () => {
    const { of } = run([finalize(), dq(true)]);
    expect(of("t1")).toMatchObject({
      disqualified: false,
      dq: { actionIndex: 1, disqualified: true, state: "held" },
    });
  });
});

describe("finalizedBy", () => {
  it("points at the finalize behind a finalized Activity", () => {
    const { activity } = run([
      { type: "adjust-points", ...target("t3"), points: 0 },
      finalize(),
    ]);
    expect(activity?.finalized).toBe(true);
    expect(activity?.finalizedBy).toEqual({ actionIndex: 1 });
  });
  it("is absent when not finalized or after unfinalize", () => {
    expect(run([]).activity?.finalizedBy).toBeUndefined();
    expect(
      run([finalize(), { type: "unfinalize", activityId: A }]).activity
        ?.finalizedBy,
    ).toBeUndefined();
  });
});

describe("finalizeRanking", () => {
  it("lists ranks and points in rank order, DQs last", () => {
    const { activity } = run([
      { type: "disqualify", ...target("t1"), disqualified: true },
    ]);
    if (!activity) throw new Error("no activity");
    expect(finalizeRanking(activity)).toEqual([
      { entrantId: "t2", rank: 1, points: 100, disqualified: false },
      { entrantId: "t3", rank: 2, points: 90, disqualified: false },
      { entrantId: "t1", disqualified: true },
    ]);
  });
  it("round-trips: finalizing with it gives no warning", () => {
    const first = run([
      { type: "set-final-rank", ...target("t3"), rank: 1 },
      { type: "disqualify", ...target("t1"), disqualified: true },
    ]);
    if (!first.activity) throw new Error("no activity");
    const ranking = finalizeRanking(first.activity);
    const { results, activity } = run([
      { type: "set-final-rank", ...target("t3"), rank: 1 },
      { type: "disqualify", ...target("t1"), disqualified: true },
      { type: "finalize", activityId: A, ranking },
    ]);
    expect(activity?.finalized).toBe(true);
    expect(results.warnings).toEqual([]);
    expect(finalizeRanking(activity!)).toEqual(ranking);
  });
});
