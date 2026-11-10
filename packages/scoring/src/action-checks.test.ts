import { describe, expect, it } from "vitest";
import { actionProblem, scoreEvent, type OfficialAction } from "./index.ts";
import { activityId, smallEvent } from "./test-support.ts";

// One check for an Official action, shared by the box (refuses when written) and scoreEvent (warns) (#24).
const context = smallEvent({ scores: [{ t1: 30, t2: 20 }] });

const dq = (
  entrantId: string,
  activity?: string,
  disqualified = true,
): OfficialAction => ({
  type: "disqualify",
  entrantId,
  disqualified,
  ...(activity === undefined ? {} : { activityId: activity }),
});

describe("actionProblem: disqualify at an Activity", () => {
  it("accepts an entrant of the Activity's Competition", () => {
    expect(actionProblem(context, dq("t1", activityId(0)))).toBeUndefined();
  });

  it("refuses an Activity the Event doesn't have", () => {
    const missing = "0196cfa2-4c00-7000-8000-0000000009ff";
    expect(actionProblem(context, dq("t1", missing))).toBe(
      `disqualify: no Activity ${missing} in the Event; left out`,
    );
  });

  it("refuses an entrant from another Competition", () => {
    const other = {
      ...context,
      entrants: [{ id: "x1", competitionId: "some-other-competition" }],
    };
    expect(actionProblem(other, dq("x1", activityId(0)))).toBe(
      "disqualify: x1 isn't in Competition teams; left out",
    );
  });
});

describe("actionProblem: overall disqualify", () => {
  it("accepts an entrant of any Competition", () => {
    expect(actionProblem(context, dq("t2"))).toBeUndefined();
  });

  it("refuses an entrant who isn't in any Competition", () => {
    expect(actionProblem(context, dq("nobody"))).toBe(
      "disqualify: nobody isn't in any Competition; left out",
    );
  });
});

describe("actionProblem: other action types", () => {
  it("returns undefined (their checks are #24, 2c)", () => {
    expect(
      actionProblem(context, {
        type: "adjust-points",
        activityId: "nowhere",
        entrantId: "nobody",
        points: 5,
      }),
    ).toBeUndefined();
  });
});

describe("scoreEvent warns on an invalid effective disqualify", () => {
  it("leaves it out with actionProblem's message, and still scores the rest", () => {
    const bad = dq("ghost", activityId(0));
    const input = smallEvent({
      scores: [{ t1: 30, t2: 20 }],
      actions: [dq("t1", activityId(0)), bad],
    });
    const results = scoreEvent(input);
    const message = actionProblem(input, bad);
    expect(message).toBeDefined();
    expect(results.warnings).toEqual([{ action: bad, message }]);
    // The valid DQ still applies.
    expect(results.activities[0]?.entries).toEqual([
      { entrantId: "t1", total: 30, points: 0, disqualified: true },
      expect.objectContaining({ entrantId: "t2", finalRank: 1 }),
    ]);
  });

  it("warns for an unknown Activity and for an overall DQ of an unknown entrant", () => {
    const noActivity = dq("t1", "0196cfa2-4c00-7000-8000-0000000009ff");
    const noEntrant = dq("ghost");
    const input = smallEvent({
      scores: [{ t1: 30, t2: 20 }],
      actions: [noActivity, noEntrant],
    });
    const results = scoreEvent(input);
    expect(results.warnings).toEqual([
      { action: noActivity, message: actionProblem(input, noActivity) },
      { action: noEntrant, message: actionProblem(input, noEntrant) },
    ]);
    expect(results.standings[0]?.entrants.map((e) => e.disqualified)).toEqual([
      false,
      false,
    ]);
  });

  it("warns only for the effective (latest) action of that entrant and Activity", () => {
    const first = dq("ghost", activityId(0));
    const last = dq("ghost", activityId(0), false);
    const results = scoreEvent(
      smallEvent({ scores: [{ t1: 30 }], actions: [first, last] }),
    );
    expect(results.warnings).toEqual([
      { action: last, message: expect.stringContaining("ghost") },
    ]);
  });
});
