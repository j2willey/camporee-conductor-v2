import type { Award } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { scoreEvent, type OfficialAction } from "./index.ts";
import { COMPETITION, smallEvent } from "./test-support.ts";

/** Overall rank override (ADR-0019). Scores 30, 20, 10 → automatic ranks 1, 2, 3. */
const SCORES = { t1: 30, t2: 20, t3: 10 };

const overrideRank = (
  entrantId: string,
  rank: number,
  competitionId = COMPETITION,
): OfficialAction => ({
  type: "set-overall-rank",
  competitionId,
  entrantId,
  rank,
});

const dq = (entrantId: string): OfficialAction => ({
  type: "disqualify",
  entrantId,
  disqualified: true,
});

/** Each entrant's overall result as `rank (provisional)`, or `DQ`, plus the warnings. */
function overall(actions: OfficialAction[], awards: Award[] = []) {
  const results = scoreEvent(smallEvent({ scores: [SCORES], actions, awards }));
  return {
    ranks: Object.fromEntries(
      (results.standings[0]?.entrants ?? []).map((s) => [
        s.entrantId,
        s.disqualified ? "DQ" : `${s.rank} (${s.provisionalRank})`,
      ]),
    ),
    results,
  };
}

describe("set-overall-rank: the Official owns the result", () => {
  it("sets the entrant's rank and doesn't re-sort anyone else", () => {
    expect(overall([overrideRank("t3", 1)]).ranks).toEqual({
      t1: "1 (1)",
      t2: "2 (2)",
      t3: "1 (3)",
    });
  });

  it("the latest override for a Competition and entrant wins", () => {
    expect(
      overall([overrideRank("t3", 1), overrideRank("t3", 2)]).ranks["t3"],
    ).toBe("2 (3)");
  });

  it("Awards use the overridden rank", () => {
    const axes: Award = {
      id: "0196cfa2-4c00-7000-8000-000000000030",
      slug: "axes",
      label: "Axes",
      competitionId: COMPETITION,
      scope: "event",
      rule: { type: "places", names: ["Gold Axe", "Silver Hatchet"] },
    };
    expect(
      overall([overrideRank("t3", 1)], [axes]).results.awards[0]?.recipients,
    ).toEqual([
      { entrantId: "t1", place: "Gold Axe", manual: false },
      { entrantId: "t3", place: "Gold Axe", manual: false },
      { entrantId: "t2", place: "Silver Hatchet", manual: false },
    ]);
  });

  it("an overall DQ beats an override, whichever was logged last", () => {
    for (const actions of [
      [overrideRank("t1", 1), dq("t1")],
      [dq("t1"), overrideRank("t1", 1)],
    ]) {
      const { ranks, results } = overall(actions);
      expect(ranks["t1"]).toBe("DQ");
      expect(results.warnings).toEqual([]);
    }
  });
});

describe("an invalid effective set-overall-rank is a warning, not an error", () => {
  it.each([
    ["rank 0", overrideRank("t3", 0)],
    ["a fractional rank", overrideRank("t3", 1.5)],
  ])("%s: left out, the automatic rank stands", (_label, bad) => {
    const { ranks, results } = overall([bad]);
    expect(ranks["t3"]).toBe("3 (3)");
    expect(results.warnings).toEqual([
      { action: bad, message: expect.stringMatching(/whole number from 1/) },
    ]);
  });

  it("an entrant not in the Competition: left out with a warning", () => {
    const bad = overrideRank("t9", 1);
    const { ranks, results } = overall([bad]);
    expect(Object.keys(ranks)).not.toContain("t9");
    expect(results.warnings).toEqual([
      {
        action: bad,
        message: expect.stringMatching(/t9 isn't in Competition/),
      },
    ]);
  });

  it("a Competition that isn't in the Event: left out with a warning", () => {
    const bad = overrideRank("t1", 2, "0196cfa2-4c00-7000-8000-000000000099");
    const { ranks, results } = overall([bad]);
    expect(ranks["t1"]).toBe("1 (1)");
    expect(results.warnings).toEqual([
      { action: bad, message: expect.stringMatching(/no Competition/) },
    ]);
  });

  it("a bad override replaced by a good one scores fine, with no warning", () => {
    const { ranks, results } = overall([
      overrideRank("t3", 0),
      overrideRank("t3", 1),
    ]);
    expect(ranks["t3"]).toBe("1 (3)");
    expect(results.warnings).toEqual([]);
  });
});
