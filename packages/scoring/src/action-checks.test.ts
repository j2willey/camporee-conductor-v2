import type { Award } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { actionProblem, scoreEvent, type OfficialAction } from "./index.ts";
import { activityId, COMPETITION, smallEvent } from "./test-support.ts";

// One check for an Official action, shared by the box (refuses when written) and scoreEvent (warns) (#24).
const context = {
  ...smallEvent({ scores: [{ t1: 30, t2: 20 }] }),
  // Entries the corrections below name.
  entries: [
    { id: "e1", activityId: activityId(0), entrantId: "t1", values: {} },
  ],
};

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

const MISSING = "0196cfa2-4c00-7000-8000-0000000009ff";
const AWARD_ID = "0196cfa2-4c00-7000-8000-000000000030";
const withAward = (rule: Award["rule"]) => ({
  ...smallEvent({
    scores: [{ t1: 30, t2: 20 }],
    awards: [
      {
        id: AWARD_ID,
        slug: "the-award",
        label: "The Award",
        competitionId: COMPETITION,
        scope: "event",
        rule,
      },
    ],
  }),
  entries: context.entries,
});
const outsider = {
  ...context,
  entrants: [{ id: "x1", competitionId: "some-other-competition" }],
};

describe("actionProblem: adjust-points, set-final-rank and set-placement-points", () => {
  const adjust = (over: Record<string, unknown> = {}) =>
    ({
      type: "adjust-points",
      activityId: activityId(0),
      entrantId: "t1",
      points: -5,
      ...over,
    }) as OfficialAction;
  const finalRank = (over: Record<string, unknown> = {}) =>
    ({
      type: "set-final-rank",
      activityId: activityId(0),
      entrantId: "t1",
      rank: 2,
      ...over,
    }) as OfficialAction;
  const placement = (over: Record<string, unknown> = {}) =>
    ({
      type: "set-placement-points",
      activityId: activityId(0),
      entrantId: "t1",
      points: 0,
      ...over,
    }) as OfficialAction;

  it("accepts a valid action of each type (a negative adjustment, placement points of 0)", () => {
    for (const a of [adjust(), finalRank(), placement()]) {
      expect(actionProblem(context, a)).toBeUndefined();
    }
  });

  it.each([
    ["adjust-points", adjust],
    ["set-final-rank", finalRank],
    ["set-placement-points", placement],
  ])("%s: refuses an Activity the Event doesn't have", (type, make) => {
    expect(actionProblem(context, make({ activityId: MISSING }))).toBe(
      `${type}: no Activity ${MISSING} in the Event; left out`,
    );
  });

  it.each([
    ["adjust-points", adjust],
    ["set-final-rank", finalRank],
    ["set-placement-points", placement],
  ])("%s: refuses an entrant from another Competition", (type, make) => {
    expect(actionProblem(outsider, make({ entrantId: "x1" }))).toBe(
      `${type}: x1 isn't in Competition teams; left out`,
    );
  });

  it("adjust-points: points must be a finite number", () => {
    for (const points of [Number.NaN, Infinity]) {
      expect(actionProblem(context, adjust({ points }))).toBe(
        `adjust-points: points ${points} for t1 isn't a number; left out`,
      );
    }
  });

  it("set-final-rank: rank must be a whole number from 1", () => {
    for (const rank of [0, 1.5, -1, Number.NaN]) {
      expect(actionProblem(context, finalRank({ rank }))).toBe(
        `set-final-rank: rank ${rank} for t1 isn't a whole number from 1; left out`,
      );
    }
  });

  it("set-placement-points: points must be a finite number from 0", () => {
    for (const points of [-1, Number.NaN, Infinity]) {
      expect(actionProblem(context, placement({ points }))).toBe(
        `set-placement-points: points ${points} for t1 isn't a number from 0; left out`,
      );
    }
  });
});

describe("actionProblem: set-overall-rank", () => {
  const overall = (over: Record<string, unknown> = {}) =>
    ({
      type: "set-overall-rank",
      competitionId: COMPETITION,
      entrantId: "t1",
      rank: 2,
      ...over,
    }) as OfficialAction;

  it("accepts a valid rank", () => {
    expect(actionProblem(context, overall())).toBeUndefined();
  });

  it("refuses a Competition the Event doesn't have", () => {
    expect(actionProblem(context, overall({ competitionId: MISSING }))).toBe(
      `set-overall-rank: no Competition ${MISSING} in the Event; left out`,
    );
  });

  it("refuses an entrant outside the Competition", () => {
    expect(actionProblem(outsider, overall({ entrantId: "x1" }))).toBe(
      "set-overall-rank: x1 isn't in Competition teams; left out",
    );
  });

  it("refuses a rank that isn't a whole number from 1", () => {
    expect(actionProblem(context, overall({ rank: 0 }))).toBe(
      "set-overall-rank: rank 0 for t1 isn't a whole number from 1; left out",
    );
  });
});

describe("actionProblem: set-award", () => {
  const places: Award["rule"] = {
    type: "places",
    names: ["Gold Axe", "Silver Hatchet"],
  };
  const setAward = (over: Record<string, unknown> = {}) =>
    ({
      type: "set-award",
      awardId: AWARD_ID,
      entrantId: "t1",
      awarded: true,
      ...over,
    }) as OfficialAction;

  it("accepts an entrant of the Award's Competition, with or without a place", () => {
    const ctx = withAward(places);
    expect(actionProblem(ctx, setAward())).toBeUndefined();
    expect(actionProblem(ctx, setAward({ place: "Gold Axe" }))).toBeUndefined();
  });

  it("refuses an Award the Event doesn't have", () => {
    expect(
      actionProblem(withAward(places), setAward({ awardId: MISSING })),
    ).toBe(`set-award: no Award ${MISSING} in the Event; left out`);
  });

  it("refuses an entrant outside the Award's Competition", () => {
    const ctx = { ...withAward(places), entrants: outsider.entrants };
    expect(actionProblem(ctx, setAward({ entrantId: "x1" }))).toBe(
      "set-award: x1 isn't in Competition teams; left out",
    );
  });

  it("refuses a place that isn't one of the Award's names", () => {
    expect(
      actionProblem(withAward(places), setAward({ place: "Bronze Saw" })),
    ).toBe(
      `"Bronze Saw" isn't a place of Award the-award (Gold Axe, Silver Hatchet); left out`,
    );
  });

  it("refuses a place on an Award that isn't named places", () => {
    expect(
      actionProblem(
        withAward({ type: "manual" }),
        setAward({ place: "Gold Axe" }),
      ),
    ).toBe(
      `set-award gives place "Gold Axe" for Award the-award, but only a named-places Award takes a place; left out`,
    );
  });
});

describe("actionProblem: finalize and unfinalize", () => {
  const finalize = (
    ranking: Extract<OfficialAction, { type: "finalize" }>["ranking"],
    id = activityId(0),
  ): OfficialAction => ({ type: "finalize", activityId: id, ranking });
  const row = (entrantId: string, rank = 1, points = 100) => ({
    entrantId,
    rank,
    points,
    disqualified: false as const,
  });

  it("accepts a ranking of entrants with entries", () => {
    expect(actionProblem(context, finalize([row("t1")]))).toBeUndefined();
  });

  it("refuses an Activity the Event doesn't have", () => {
    expect(actionProblem(context, finalize([], MISSING))).toBe(
      `finalize: no Activity ${MISSING} in the Event; left out`,
    );
    expect(
      actionProblem(context, { type: "unfinalize", activityId: MISSING }),
    ).toBe(`unfinalize: no Activity ${MISSING} in the Event; left out`);
  });

  it("accepts unfinalize for an Activity of the Event", () => {
    expect(
      actionProblem(context, { type: "unfinalize", activityId: activityId(0) }),
    ).toBeUndefined();
  });

  it("refuses an entrant with no entry, one listed twice, a bad rank and bad points", () => {
    expect(actionProblem(context, finalize([row("t9")]))).toBe(
      "finalize: t9 has no entry at activity-0; left out",
    );
    expect(actionProblem(context, finalize([row("t1"), row("t1", 2)]))).toBe(
      "finalize: t1 is listed twice at activity-0; left out",
    );
    expect(actionProblem(context, finalize([row("t1", 0)]))).toBe(
      "finalize: rank 0 for t1 at activity-0 isn't a whole number from 1; left out",
    );
    expect(actionProblem(context, finalize([row("t1", 1, -1)]))).toBe(
      "finalize: points -1 for t1 at activity-0 aren't a number from 0; left out",
    );
  });
});

describe("scoreEvent warns with actionProblem's message, once", () => {
  const input = {
    ...withAward({ type: "manual" }),
    entries: [
      {
        id: "e1",
        activityId: activityId(0),
        entrantId: "t1",
        values: { score: 30 },
      },
      {
        id: "e2",
        activityId: activityId(0),
        entrantId: "t1",
        values: { score: 31 },
      },
      {
        id: "e3",
        activityId: activityId(0),
        entrantId: "t2",
        values: { score: 20 },
      },
    ],
  };
  const A = activityId(0);
  const bad: OfficialAction[] = [
    { type: "disqualify", entrantId: "nobody", disqualified: true },
    {
      type: "adjust-points",
      activityId: A,
      entrantId: "t1",
      points: Number.NaN,
    },
    { type: "set-final-rank", activityId: A, entrantId: "t1", rank: 0 },
    {
      type: "set-placement-points",
      activityId: A,
      entrantId: "t1",
      points: -1,
    },
    { type: "set-award", awardId: MISSING, entrantId: "t1", awarded: true },
    {
      type: "set-overall-rank",
      competitionId: COMPETITION,
      entrantId: "x9",
      rank: 1,
    },
    {
      type: "choose-entry",
      activityId: A,
      entrantId: "t1",
      entryId: "nope",
      newestEntryId: "e2",
    },
    {
      type: "set-field-value",
      activityId: A,
      entrantId: "t1",
      entryId: "e1",
      fieldId: "nope",
      value: 1,
    },
    {
      type: "revert-field-value",
      activityId: A,
      entrantId: "t1",
      entryId: "e1",
      fieldId: "nope",
    },
    {
      type: "finalize",
      activityId: A,
      ranking: [{ entrantId: "t9", rank: 1, points: 1, disqualified: false }],
    },
    { type: "unfinalize", activityId: MISSING },
  ];

  it.each(bad.map((a) => [a.type, a] as const))("%s", (_type, action) => {
    const message = actionProblem(input, action);
    expect(message).toBeDefined();
    expect(
      scoreEvent({ ...input, actions: [action] }).warnings.map(
        (w) => w.message,
      ),
    ).toEqual([message]);
  });
});

describe("scoreEvent leaves out an invalid effective action", () => {
  const A = activityId(0);
  const run = (actions: OfficialAction[]) =>
    scoreEvent({ ...smallEvent({ scores: [{ t1: 30, t2: 20 }] }), actions });
  const ranks = (r: ReturnType<typeof run>) =>
    r.activities[0]?.entries.map((e) => [
      e.entrantId,
      "finalRank" in e ? e.finalRank : "DQ",
      e.total,
    ]);

  it("an invalid set-final-rank: the provisional rank stands, one warning", () => {
    const r = run([
      { type: "set-final-rank", activityId: A, entrantId: "t1", rank: 0 },
    ]);
    expect(ranks(r)).toEqual([
      ["t1", 1, 30],
      ["t2", 2, 20],
    ]);
    expect(r.warnings).toHaveLength(1);
  });

  it("an invalid adjust-points doesn't change the total", () => {
    const r = run([
      {
        type: "adjust-points",
        activityId: A,
        entrantId: "t1",
        points: Number.NaN,
      },
    ]);
    expect(ranks(r)).toEqual([
      ["t1", 1, 30],
      ["t2", 2, 20],
    ]);
    expect(r.warnings).toHaveLength(1);
  });

  it("a set-award for an unknown Award gives one warning", () => {
    const r = run([
      { type: "set-award", awardId: MISSING, entrantId: "t1", awarded: true },
    ]);
    expect(r.warnings.map((w) => w.message)).toEqual([
      `set-award: no Award ${MISSING} in the Event; left out`,
    ]);
  });

  it("a superseded invalid action doesn't warn", () => {
    const r = run([
      { type: "set-final-rank", activityId: A, entrantId: "t1", rank: 0 },
      { type: "set-final-rank", activityId: A, entrantId: "t1", rank: 2 },
    ]);
    expect(r.warnings).toEqual([]);
    expect(ranks(r)?.[0]).toEqual(["t1", 2, 30]);
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
