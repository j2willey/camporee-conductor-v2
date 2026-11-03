import { describe, expect, it } from "vitest";
import {
  scoreEvent,
  type FinalizedResult,
  type OfficialAction,
} from "./index.ts";
import { activityId, COMPETITION, smallEvent } from "./test-support.ts";

/** Finalization (ADR-0019). Scores 30, 20, 10 → ranks 1, 2, 3 and placement points 100, 90, 80. */
const SCORES = { t1: 30, t2: 20, t3: 10 };
const ACTIVITY = activityId(0);

const ranked = (
  entrantId: string,
  rank: number,
  points: number,
): FinalizedResult => ({ entrantId, rank, points, disqualified: false });

const finalize = (
  ranking: FinalizedResult[],
  id = ACTIVITY,
): OfficialAction => ({ type: "finalize", activityId: id, ranking });
const unfinalize = (id = ACTIVITY): OfficialAction => ({
  type: "unfinalize",
  activityId: id,
});

/** The ranking a recompute gives today, frozen. */
const AS_SCORED = [
  ranked("t1", 1, 100),
  ranked("t2", 2, 90),
  ranked("t3", 3, 80),
];

const target = (entrantId: string) => ({ activityId: ACTIVITY, entrantId });

/** Activity 0's entries as `[entrant, rank or "DQ", points]`, whether it's finalized, and the warnings. */
function scored(
  actions: OfficialAction[],
  scores: Record<string, number>[] = [SCORES],
) {
  const results = scoreEvent(smallEvent({ scores, actions }));
  const activity = results.activities[0];
  return {
    entries: (activity?.entries ?? []).map((e) => [
      e.entrantId,
      e.disqualified ? "DQ" : e.finalRank,
      e.points,
    ]),
    finalized: activity?.finalized,
    warnings: results.warnings,
    results,
  };
}

describe("finalize: the Activity's Final Ranking is frozen as stored", () => {
  it("an Activity nobody finalized isn't finalized", () => {
    expect(scored([]).finalized).toBe(false);
  });

  it("returns the stored ranking, in its order, with no warning when a recompute agrees", () => {
    const { entries, finalized, warnings } = scored([finalize(AS_SCORED)]);
    expect(finalized).toBe(true);
    expect(entries).toEqual([
      ["t1", 1, 100],
      ["t2", 2, 90],
      ["t3", 3, 80],
    ]);
    expect(warnings).toEqual([]);
  });

  it("a stored DQ is a DQ with 0 points", () => {
    const stored = [
      ranked("t1", 1, 100),
      ranked("t3", 2, 90),
      { entrantId: "t2", disqualified: true } as const,
    ];
    const pre: OfficialAction = {
      type: "disqualify",
      ...target("t2"),
      disqualified: true,
    };
    const { entries, warnings } = scored([pre, finalize(stored)]);
    expect(entries).toEqual([
      ["t1", 1, 100],
      ["t3", 2, 90],
      ["t2", "DQ", 0],
    ]);
    expect(warnings).toEqual([]);
  });

  it("totals and the Provisional Ranking stay live, as information", () => {
    const { results } = scored(
      [finalize(AS_SCORED)],
      [{ t1: 5, t2: 20, t3: 10 }],
    );
    expect(
      results.activities[0]?.entries.map((e) => [
        e.entrantId,
        e.total,
        e.disqualified ? "DQ" : e.provisionalRank,
      ]),
    ).toEqual([
      ["t1", 5, 3],
      ["t2", 20, 1],
      ["t3", 10, 2],
    ]);
  });

  it("standings and Awards use the stored ranking", () => {
    // Stored: t3 1st. A recompute would put t1 1st.
    const stored = [
      ranked("t3", 1, 100),
      ranked("t1", 2, 90),
      ranked("t2", 3, 80),
    ];
    const results = scoreEvent(
      smallEvent({
        scores: [SCORES],
        actions: [finalize(stored)],
        awards: [
          {
            id: "0196cfa2-4c00-7000-8000-000000000030",
            slug: "winner",
            label: "Winner",
            competitionId: COMPETITION,
            scope: "event",
            rule: { type: "places", names: ["Winner"] },
          },
        ],
      }),
    );
    expect(
      results.standings[0]?.entrants.map((s) => [
        s.entrantId,
        s.total,
        s.disqualified ? "DQ" : s.rank,
      ]),
    ).toEqual([
      ["t1", 90, 2],
      ["t2", 80, 3],
      ["t3", 100, 1],
    ]);
    expect(results.awards[0]?.recipients).toEqual([
      { entrantId: "t3", place: "Winner", manual: false },
    ]);
  });

  it("only that Activity is frozen", () => {
    const results = scoreEvent(
      smallEvent({
        scores: [SCORES, { t1: 1, t2: 2 }],
        actions: [finalize(AS_SCORED)],
      }),
    );
    expect(results.activities.map((a) => a.finalized)).toEqual([true, false]);
    expect(
      results.activities[1]?.entries.map((e) => [
        e.entrantId,
        e.disqualified ? "DQ" : e.finalRank,
      ]),
    ).toEqual([
      ["t1", 2],
      ["t2", 1],
    ]);
  });
});

describe("a finalized Activity is never re-sorted silently", () => {
  it("a score changed since finalize: the stored ranking stands, with a warning naming the Activity", () => {
    const action = finalize(AS_SCORED);
    const { entries, warnings } = scored([action], [{ t1: 5, t2: 20, t3: 10 }]);
    expect(entries).toEqual([
      ["t1", 1, 100],
      ["t2", 2, 90],
      ["t3", 3, 80],
    ]);
    expect(warnings).toEqual([
      {
        action,
        message: expect.stringMatching(
          /activity-0 is finalized.*recomputing.*differ.*t1.*t2.*t3/,
        ) as string,
      },
    ]);
  });

  it("an entry added since finalize isn't listed; warning", () => {
    const action = finalize(AS_SCORED);
    const { entries, warnings } = scored([action], [{ ...SCORES, t4: 5 }]);
    expect(entries.map(([id]) => id)).toEqual(["t1", "t2", "t3"]);
    expect(warnings).toEqual([
      {
        action,
        message: expect.stringMatching(/activity-0 is finalized.*t4/) as string,
      },
    ]);
  });

  it("actions logged before finalize are part of the recompute: no warning", () => {
    const stored = [
      ranked("t3", 1, 100),
      ranked("t1", 2, 90),
      ranked("t2", 3, 80),
    ];
    const before: OfficialAction[] = [
      { type: "set-final-rank", ...target("t3"), rank: 1 },
      { type: "set-final-rank", ...target("t1"), rank: 2 },
      { type: "set-final-rank", ...target("t2"), rank: 3 },
    ];
    expect(scored([...before, finalize(stored)]).warnings).toEqual([]);
  });
});

describe("actions logged after finalize wait for unfinalize", () => {
  it.each<[string, OfficialAction]>([
    ["adjust-points", { type: "adjust-points", ...target("t3"), points: 50 }],
    ["set-final-rank", { type: "set-final-rank", ...target("t3"), rank: 1 }],
    [
      "set-placement-points",
      { type: "set-placement-points", ...target("t3"), points: 5 },
    ],
    [
      "a per-Activity disqualify",
      { type: "disqualify", ...target("t1"), disqualified: true },
    ],
  ])("%s: not applied, with a warning", (_label, late) => {
    const { entries, warnings } = scored([finalize(AS_SCORED), late]);
    expect(entries).toEqual([
      ["t1", 1, 100],
      ["t2", 2, 90],
      ["t3", 3, 80],
    ]);
    expect(warnings).toEqual([
      {
        action: late,
        message: expect.stringMatching(
          /activity-0 is finalized.*until it's unfinalized/,
        ) as string,
      },
    ]);
  });

  it("they apply once the Activity is unfinalized", () => {
    const late: OfficialAction = {
      type: "set-final-rank",
      ...target("t3"),
      rank: 1,
    };
    const { entries, finalized, warnings } = scored([
      finalize(AS_SCORED),
      late,
      unfinalize(),
    ]);
    expect(finalized).toBe(false);
    expect(entries).toEqual([
      ["t1", 1, 100],
      ["t2", 2, 90],
      ["t3", 1, 100],
    ]);
    expect(warnings).toEqual([]);
  });

  it("an action for another Activity isn't held back", () => {
    const other: OfficialAction = {
      type: "set-final-rank",
      activityId: activityId(1),
      entrantId: "t1",
      rank: 1,
    };
    const results = scoreEvent(
      smallEvent({
        scores: [SCORES, { t1: 1, t2: 2 }],
        actions: [finalize(AS_SCORED), other],
      }),
    );
    expect(results.warnings).toEqual([]);
    expect(
      results.activities[1]?.entries.map((e) =>
        e.disqualified ? "DQ" : e.finalRank,
      ),
    ).toEqual([1, 1]);
  });

  it("an overall DQ and set-overall-rank don't change the Activity, so they still apply", () => {
    const actions: OfficialAction[] = [
      finalize(AS_SCORED),
      { type: "disqualify", entrantId: "t1", disqualified: true },
      {
        type: "set-overall-rank",
        competitionId: COMPETITION,
        entrantId: "t3",
        rank: 1,
      },
    ];
    const { entries, warnings, results } = scored(actions);
    expect(entries).toEqual([
      ["t1", 1, 100],
      ["t2", 2, 90],
      ["t3", 3, 80],
    ]);
    expect(warnings).toEqual([]);
    expect(
      results.standings[0]?.entrants.map((s) => [
        s.entrantId,
        s.disqualified ? "DQ" : s.rank,
      ]),
    ).toEqual([
      ["t1", "DQ"],
      ["t2", 1],
      ["t3", 1],
    ]);
  });
});

describe("unfinalize, and the latest action wins", () => {
  it("unfinalize reopens the Activity: a recompute, no warning", () => {
    const { entries, finalized, warnings } = scored(
      [finalize(AS_SCORED), unfinalize()],
      [{ t1: 5, t2: 20, t3: 10 }],
    );
    expect(finalized).toBe(false);
    expect(entries).toEqual([
      ["t1", 3, 80],
      ["t2", 1, 100],
      ["t3", 2, 90],
    ]);
    expect(warnings).toEqual([]);
  });

  it("finalize again after unfinalize: the latest ranking is the one stored", () => {
    const second = [
      ranked("t2", 1, 100),
      ranked("t3", 2, 90),
      ranked("t1", 3, 80),
    ];
    const { entries } = scored(
      [finalize(AS_SCORED), unfinalize(), finalize(second)],
      [{ t1: 5, t2: 20, t3: 10 }],
    );
    expect(entries).toEqual([
      ["t2", 1, 100],
      ["t3", 2, 90],
      ["t1", 3, 80],
    ]);
  });

  it("unfinalize on an Activity that isn't finalized changes nothing", () => {
    expect(scored([unfinalize()])).toMatchObject({
      finalized: false,
      warnings: [],
    });
  });
});

describe("an invalid effective finalize is a warning, not an error", () => {
  it.each<[string, FinalizedResult[], RegExp]>([
    [
      "an entrant with no entry at the Activity",
      [...AS_SCORED, ranked("t9", 4, 70)],
      /t9 has no entry at activity-0/,
    ],
    [
      "an entrant listed twice",
      [...AS_SCORED, ranked("t1", 4, 70)],
      /t1 is listed twice/,
    ],
    [
      "rank 0",
      [ranked("t1", 0, 100), ranked("t2", 2, 90), ranked("t3", 3, 80)],
      /whole number from 1/,
    ],
    [
      "a fractional rank",
      [ranked("t1", 1.5, 100), ranked("t2", 2, 90), ranked("t3", 3, 80)],
      /whole number from 1/,
    ],
    [
      "negative points",
      [ranked("t1", 1, -1), ranked("t2", 2, 90), ranked("t3", 3, 80)],
      /points -1 for t1/,
    ],
  ])(
    "%s: left out, the Activity scores as not finalized",
    (_label, ranking, message) => {
      const bad = finalize(ranking);
      const { entries, finalized, warnings } = scored(
        [bad],
        [{ t1: 5, t2: 20, t3: 10 }],
      );
      expect(finalized).toBe(false);
      expect(entries).toEqual([
        ["t1", 3, 80],
        ["t2", 1, 100],
        ["t3", 2, 90],
      ]);
      expect(warnings).toEqual([
        { action: bad, message: expect.stringMatching(message) as string },
      ]);
    },
  );

  it.each([
    ["finalize", finalize(AS_SCORED, "0196cfa2-4c00-7000-8000-000000000099")],
    ["unfinalize", unfinalize("0196cfa2-4c00-7000-8000-000000000099")],
  ])("%s for an Activity not in the Event: warning", (_label, bad) => {
    expect(scored([bad]).warnings).toEqual([
      { action: bad, message: expect.stringMatching(/no Activity/) as string },
    ]);
  });

  it("only the effective one is checked: a bad finalize replaced by a good one, no warning", () => {
    const { finalized, warnings } = scored([
      finalize([ranked("t9", 1, 100)]),
      finalize(AS_SCORED),
    ]);
    expect(finalized).toBe(true);
    expect(warnings).toEqual([]);
  });
});
