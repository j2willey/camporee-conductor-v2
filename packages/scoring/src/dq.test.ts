import { describe, expect, it } from "vitest";
import { scoreEvent, type OfficialAction } from "./index.ts";
import { activityId, smallEvent } from "./test-support.ts";

/** DQ (ADR-0019 DQ amendment). Scores 30, 20, 20, 10: dense 1, 2, 2, 3; strict 1, 2, 2, 4. */
const SCORES = { t1: 30, t2: 20, t3: 20, t4: 10 };

const dq = (
  entrantId: string,
  disqualified = true,
  activity?: number,
): OfficialAction => ({
  type: "disqualify",
  entrantId,
  disqualified,
  ...(activity === undefined ? {} : { activityId: activityId(activity) }),
});

/** Each entrant's Activity result as `rank/points`, or `DQ/points`. */
function activityRanks(
  ...args: Parameters<typeof smallEvent>
): Record<string, string> {
  const [activity] = scoreEvent(smallEvent(...args)).activities;
  return Object.fromEntries(
    (activity?.entries ?? []).map((e) => [
      e.entrantId,
      e.disqualified ? `DQ/${e.points}` : `${e.finalRank}/${e.points}`,
    ]),
  );
}

/** Each entrant's overall standing as `rank:total`, or `DQ:total`. */
function overallRanks(
  ...args: Parameters<typeof smallEvent>
): Record<string, string> {
  const [standings] = scoreEvent(smallEvent(...args)).standings;
  return Object.fromEntries(
    (standings?.entrants ?? []).map((s) => [
      s.entrantId,
      s.disqualified ? `DQ:${s.total}` : `${s.rank}:${s.total}`,
    ]),
  );
}

describe("per-Activity DQ: removed before the Activity is ranked", () => {
  it("dense: everyone below moves up; the DQ'd entry has no rank and 0 points", () => {
    expect(
      activityRanks({ scores: [SCORES], actions: [dq("t1", true, 0)] }),
    ).toEqual({ t1: "DQ/0", t2: "1/100", t3: "1/100", t4: "2/90" });
  });

  it("strict: everyone below moves up the same way", () => {
    expect(
      activityRanks({
        scores: [SCORES],
        tieNumbering: "strict",
        actions: [dq("t1", true, 0)],
      }),
    ).toEqual({ t1: "DQ/0", t2: "1/100", t3: "1/100", t4: "3/80" });
  });

  it("keeps the DQ'd entry's total", () => {
    const [activity] = scoreEvent(
      smallEvent({ scores: [SCORES], actions: [dq("t1", true, 0)] }),
    ).activities;
    expect(activity?.entries.find((e) => e.entrantId === "t1")).toEqual({
      entrantId: "t1",
      total: 30,
      points: 0,
      disqualified: true,
    });
  });

  it("scores 0 placement points even if an Official set points or a rank for the entry", () => {
    const target = { activityId: activityId(0), entrantId: "t1" };
    expect(
      activityRanks({
        scores: [SCORES],
        actions: [
          { type: "set-placement-points", ...target, points: 100 },
          { type: "set-final-rank", ...target, rank: 1 },
          dq("t1", true, 0),
        ],
      })["t1"],
    ).toBe("DQ/0");
  });

  it("disqualified: false reinstates (the latest action wins)", () => {
    expect(
      activityRanks({
        scores: [SCORES],
        actions: [dq("t1", true, 0), dq("t1", false, 0)],
      }),
    ).toEqual({ t1: "1/100", t2: "2/90", t3: "2/90", t4: "3/80" });
  });

  it("affects only that Activity: other Activities and the overall rank still count the entrant", () => {
    const input = {
      scores: [SCORES, SCORES],
      actions: [dq("t1", true, 0)],
    };
    const results = scoreEvent(smallEvent(input));
    const second = results.activities[1]?.entries.find(
      (e) => e.entrantId === "t1",
    );
    expect(second).toMatchObject({ disqualified: false, finalRank: 1 });
    // t1: 0 + 100; t2, t3: 100 + 90; t4: 90 + 80.
    expect(overallRanks(input)).toEqual({
      t1: "3:100",
      t2: "1:190",
      t3: "1:190",
      t4: "2:170",
    });
  });
});

describe("overall DQ: keeps its total, removed before the standings are ranked", () => {
  // One Activity: placement points 100, 90, 90, 80 are the overall totals.
  it("dense: everyone below moves up; the DQ'd entrant has no rank", () => {
    expect(overallRanks({ scores: [SCORES], actions: [dq("t1")] })).toEqual({
      t1: "DQ:100",
      t2: "1:90",
      t3: "1:90",
      t4: "2:80",
    });
  });

  it("strict: everyone below moves up the same way", () => {
    expect(
      overallRanks({
        scores: [SCORES],
        tieNumbering: "strict",
        actions: [dq("t1")],
      }),
    ).toEqual({ t1: "DQ:100", t2: "1:90", t3: "1:90", t4: "3:70" });
  });

  it("doesn't change the entrant's Activity results", () => {
    expect(activityRanks({ scores: [SCORES], actions: [dq("t1")] })["t1"]).toBe(
      "1/100",
    );
  });

  it("disqualified: false reinstates (the latest action wins)", () => {
    expect(
      overallRanks({
        scores: [SCORES],
        actions: [dq("t1"), dq("t1", false)],
      }),
    ).toEqual({ t1: "1:100", t2: "2:90", t3: "2:90", t4: "3:80" });
  });

  it("an overall DQ and a per-Activity DQ are separate: reinstating one leaves the other", () => {
    const actions = [dq("t1"), dq("t1", true, 0), dq("t1", false, 0)];
    expect(activityRanks({ scores: [SCORES], actions })["t1"]).toBe("1/100");
    expect(overallRanks({ scores: [SCORES], actions })["t1"]).toBe("DQ:100");
  });
});
