import { describe, expect, it } from "vitest";
import { scoreEvent, type OfficialAction } from "./index.ts";
import { COMPETITION, activityId, smallEvent } from "./test-support.ts";

/** Standings report the actions behind each entrant's result (ADR-0019 2026-11-10, #42 PR 4). Scores 30, 20, 10. */
const SCORES = { t1: 30, t2: 20, t3: 10 };

const dq = (entrantId: string, disqualified = true): OfficialAction => ({
  type: "disqualify",
  entrantId,
  disqualified,
});
const rank = (entrantId: string, r: number): OfficialAction => ({
  type: "set-overall-rank",
  competitionId: COMPETITION,
  entrantId,
  rank: r,
});
const finalize: OfficialAction = {
  type: "finalize",
  activityId: activityId(0),
  ranking: [
    { entrantId: "t1", rank: 1, points: 100, disqualified: false },
    { entrantId: "t2", rank: 2, points: 90, disqualified: false },
    { entrantId: "t3", rank: 3, points: 80, disqualified: false },
  ],
};

function standing(actions: OfficialAction[], id: string) {
  const results = scoreEvent(smallEvent({ scores: [SCORES], actions }));
  return results.standings[0]?.entrants.find((s) => s.entrantId === id);
}

describe("Standing reports the actions behind it", () => {
  it("an overall DQ, by its index", () => {
    expect(standing([rank("t2", 1), dq("t1")], "t1")).toMatchObject({
      disqualified: true,
      dq: { actionIndex: 1, disqualified: true, state: "applied" },
    });
  });
  it("a reinstate is reported: the latest wins", () => {
    expect(standing([dq("t1"), dq("t1", false)], "t1")).toMatchObject({
      disqualified: false,
      dq: { actionIndex: 1, disqualified: false, state: "applied" },
    });
  });
  it("an overall rank, by its index; the latest wins", () => {
    expect(
      standing([dq("t2"), rank("t3", 1), rank("t3", 2)], "t3"),
    ).toMatchObject({
      rank: 2,
      rankOverride: { actionIndex: 2, rank: 2, state: "applied" },
    });
    expect(standing([rank("t3", 1)], "t1")?.rankOverride).toBeUndefined();
    expect(standing([], "t1")?.dq).toBeUndefined();
  });
  it("is never held: it applies after a finalize", () => {
    expect(standing([finalize, dq("t1"), rank("t2", 1)], "t1")).toMatchObject({
      disqualified: true,
      dq: { actionIndex: 1, state: "applied" },
    });
    expect(standing([finalize, rank("t3", 1)], "t3")).toMatchObject({
      rank: 1,
      rankOverride: { actionIndex: 1, state: "applied" },
    });
  });
});
