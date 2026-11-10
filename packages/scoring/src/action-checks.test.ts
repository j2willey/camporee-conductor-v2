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

describe("actionProblem: set-field-value and revert-field-value", () => {
  const set = (
    over: Partial<Extract<OfficialAction, { type: "set-field-value" }>> = {},
  ): OfficialAction => ({
    type: "set-field-value",
    activityId: activityId(0),
    entrantId: "t1",
    entryId: "e1",
    fieldId: "score",
    value: 5,
    ...over,
  });
  const revert: OfficialAction = {
    type: "revert-field-value",
    activityId: activityId(0),
    entrantId: "t1",
    entryId: "e1",
    fieldId: "score",
  };
  const missing = "0196cfa2-4c00-7000-8000-0000000009ff";

  it("accepts a field of the Activity, even a value outside a range, and a blank", () => {
    expect(actionProblem(context, set())).toBeUndefined();
    expect(actionProblem(context, set({ value: null }))).toBeUndefined();
    expect(actionProblem(context, revert)).toBeUndefined();
  });

  it("refuses an unknown Activity", () => {
    expect(actionProblem(context, set({ activityId: missing }))).toBe(
      `set-field-value: no Activity ${missing} in the Event; left out`,
    );
    expect(actionProblem(context, { ...revert, activityId: missing })).toBe(
      `revert-field-value: no Activity ${missing} in the Event; left out`,
    );
  });

  it("refuses an entrant from another Competition", () => {
    const other = {
      ...context,
      entrants: [{ id: "x1", competitionId: "some-other-competition" }],
    };
    expect(actionProblem(other, set({ entrantId: "x1" }))).toBe(
      "set-field-value: x1 isn't in Competition teams; left out",
    );
  });

  it("refuses an unknown field", () => {
    expect(actionProblem(context, set({ fieldId: "nope" }))).toBe(
      "set-field-value: Activity 0 has no field nope; left out",
    );
    expect(actionProblem(context, { ...revert, fieldId: "nope" })).toBe(
      "revert-field-value: Activity 0 has no field nope; left out",
    );
  });

  it("refuses a value of the wrong kind", () => {
    expect(actionProblem(context, set({ value: "lots" }))).toBe(
      "set-field-value: Score must be a number; left out",
    );
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
    expect(results.activities[0]?.entries).toMatchObject([
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

describe("actionProblem: choose-entry and entry ids", () => {
  const withEntries = {
    ...context,
    entries: [
      { id: "a", activityId: activityId(0), entrantId: "t1", values: {} },
      { id: "b", activityId: activityId(0), entrantId: "t2", values: {} },
    ],
  };
  const choose = (entryId: string, newestEntryId = "a"): OfficialAction => ({
    type: "choose-entry",
    activityId: activityId(0),
    entrantId: "t1",
    entryId,
    newestEntryId,
  });

  it("accepts entries of that entrant at that Activity", () => {
    expect(actionProblem(withEntries, choose("a"))).toBeUndefined();
  });

  it("refuses an unknown entry, another entrant's entry, or an unknown newest entry", () => {
    expect(actionProblem(withEntries, choose("zz"))).toMatch(/choose-entry/);
    expect(actionProblem(withEntries, choose("b"))).toMatch(/choose-entry/);
    expect(actionProblem(withEntries, choose("a", "zz"))).toMatch(
      /choose-entry/,
    );
  });

  it("refuses a correction of an entry that isn't there", () => {
    expect(
      actionProblem(withEntries, {
        type: "revert-field-value",
        activityId: activityId(0),
        entrantId: "t1",
        entryId: "b",
        fieldId: "score",
      }),
    ).toMatch(/revert-field-value/);
  });
});
