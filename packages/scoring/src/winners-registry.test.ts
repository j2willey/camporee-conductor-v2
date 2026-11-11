import type { Award } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import {
  finalizeRanking,
  scoreEvent,
  WINNER_PLACES,
  winnersRegistry,
  type OfficialAction,
  type ScoringInput,
} from "./index.ts";
import { activityId, COMPETITION, smallEvent } from "./test-support.ts";

const AWARD = "0196cfa2-4c00-7000-8000-000000000030";
const AWARD_2 = "0196cfa2-4c00-7000-8000-000000000031";
const COMPETITION_2 = "0196cfa2-4c00-7000-8000-000000000021";

const award = (
  rule: Award["rule"],
  id = AWARD,
  competitionId = COMPETITION,
): Award => ({
  id,
  slug: `award-${id.slice(-2)}`,
  label: "The Award",
  competitionId,
  scope: "event",
  rule,
});

/** The registry for an input, scored as the box would. */
function registry(input: ScoringInput) {
  return winnersRegistry(input.event, scoreEvent(input), input.activities);
}

/** A `finalize` for Activity `index` as scored now. */
function finalizeNow(input: ScoringInput, index: number): OfficialAction {
  const results = scoreEvent(input).activities[index];
  if (!results) throw new Error("no such Activity");
  return {
    type: "finalize",
    activityId: results.activityId,
    ranking: finalizeRanking(results),
  };
}

/** [activity index or award, rank, entrant] for each line, to compare short. */
const brief = (input: ScoringInput) =>
  registry(input).lines.map((l) => [
    l.kind === "activity" ? l.activityId : l.awardId,
    l.rank,
    l.entrantId,
  ]);

it("lists three places", () => {
  expect(WINNER_PLACES).toBe(3);
});

describe("Activity places", () => {
  it("lists 1st to 3rd by finalRank, best first, and leaves out 4th", () => {
    const input = smallEvent({ scores: [{ a: 1, b: 4, c: 3, d: 2 }] });
    expect(brief(input)).toEqual([
      [activityId(0), 1, "b"],
      [activityId(0), 2, "c"],
      [activityId(0), 3, "d"],
    ]);
  });

  it("includes every entrant in a tie at 3rd: four lines", () => {
    const input = smallEvent({ scores: [{ a: 9, b: 8, c: 7, d: 7 }] });
    expect(registry(input).lines.map((l) => [l.rank, l.entrantId])).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "c"],
      [3, "d"],
    ]);
  });

  it("leaves out a DQ'd entrant at 1st, and the next entrant moves up", () => {
    const input = smallEvent({
      scores: [{ a: 9, b: 8, c: 7, d: 6 }],
      actions: [
        {
          type: "disqualify",
          activityId: activityId(0),
          entrantId: "a",
          disqualified: true,
        },
      ],
    });
    expect(registry(input).lines.map((l) => [l.rank, l.entrantId])).toEqual([
      [1, "b"],
      [2, "c"],
      [3, "d"],
    ]);
  });

  it("an Official's rank override moves an entrant into 3rd, and marks it manual", () => {
    const input = smallEvent({
      scores: [{ a: 9, b: 8, c: 7, d: 6 }],
      actions: [
        {
          type: "set-final-rank",
          activityId: activityId(0),
          entrantId: "d",
          rank: 3,
        },
      ],
    });
    const lines = registry(input).lines.filter((l) => l.rank === 3);
    expect(lines.map((l) => [l.entrantId, l.manual])).toEqual([
      ["d", true],
      ["c", false],
    ]);
  });

  it("an entrant ranked by score alone isn't manual", () => {
    const input = smallEvent({ scores: [{ a: 9, b: 8 }] });
    expect(registry(input).lines.map((l) => l.manual)).toEqual([false, false]);
  });

  it("a finalized Activity lists its stored Final Ranking, not a recompute", () => {
    const input = smallEvent({ scores: [{ a: 9, b: 8, c: 7 }] });
    const finalized = {
      ...input,
      actions: [finalizeNow(input, 0)],
    };
    // A later score change can't reorder the places.
    const later = {
      ...finalized,
      entries: [
        ...finalized.entries,
        { activityId: activityId(0), entrantId: "c", values: { score: 99 } },
      ],
    };
    expect(registry(later).lines.map((l) => [l.rank, l.entrantId])).toEqual([
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]);
  });
});

describe("Awards", () => {
  it("a named place gets its rank and name; Top Dog (top percent) has neither", () => {
    const input = smallEvent({
      scores: [{ a: 9, b: 8, c: 7, d: 6 }],
      awards: [
        award({ type: "places", names: ["1st", "2nd", "3rd"] }),
        award({ type: "top-percent", percent: 25 }, AWARD_2),
      ],
    });
    const lines = registry(input).lines.filter((l) => l.kind === "award");
    expect(lines.map((l) => [l.awardId, l.rank, l.place, l.entrantId])).toEqual(
      [
        [AWARD, 1, "1st", "a"],
        [AWARD, 2, "2nd", "b"],
        [AWARD, 3, "3rd", "c"],
        [AWARD_2, undefined, undefined, "a"],
      ],
    );
  });

  it("includes a manual set-award, marked manual", () => {
    const input = smallEvent({
      scores: [{ a: 9, b: 8 }],
      awards: [award({ type: "manual" })],
      actions: [
        { type: "set-award", awardId: AWARD, entrantId: "b", awarded: true },
      ],
    });
    expect(registry(input).lines.filter((l) => l.kind === "award")).toEqual([
      {
        kind: "award",
        competitionId: COMPETITION,
        awardId: AWARD,
        entrantId: "b",
        manual: true,
      },
    ]);
  });

  it("a manual place set by an Official has its rank from the Award's names", () => {
    const input = smallEvent({
      scores: [{ a: 9, b: 8 }],
      awards: [award({ type: "places", names: ["Gold", "Silver"] })],
      actions: [
        {
          type: "set-award",
          awardId: AWARD,
          entrantId: "b",
          awarded: true,
          place: "Gold",
        },
      ],
    });
    const lines = registry(input).lines.filter((l) => l.kind === "award");
    expect(lines.map((l) => [l.entrantId, l.rank, l.place, l.manual])).toEqual([
      ["a", 1, "Gold", false],
      ["b", 1, "Gold", true],
    ]);
  });
});

describe("order", () => {
  /** Two Competitions: Activities 0 and 1 in the first, 2 in the second; an Award in each. */
  function twoCompetitions(): ScoringInput {
    const base = smallEvent({
      scores: [
        { a: 3, b: 2 },
        { a: 3, b: 1 },
        { x: 3, y: 2 },
      ],
      awards: [
        award({ type: "places", names: ["1st"] }, AWARD, COMPETITION_2),
        award({ type: "places", names: ["1st"] }, AWARD_2, COMPETITION),
      ],
    });
    const [first] = base.event.competitions;
    if (!first) throw new Error("no Competition");
    return {
      ...base,
      event: {
        ...base.event,
        competitions: [first, { ...first, id: COMPETITION_2, slug: "second" }],
        activities: base.event.activities.map((a, i) =>
          i === 2 ? { ...a, competitionId: COMPETITION_2 } : a,
        ),
      },
      entrants: base.entrants.map((e) =>
        e.id === "x" || e.id === "y"
          ? { ...e, competitionId: COMPETITION_2 }
          : e,
      ),
    };
  }

  it("goes by Competition, then Activities, then Awards, in the Event's order", () => {
    expect(
      registry(twoCompetitions()).lines.map((l) => [
        l.competitionId === COMPETITION ? 1 : 2,
        l.kind === "activity" ? l.activityId : l.awardId,
        l.entrantId,
      ]),
    ).toEqual([
      [1, activityId(0), "a"],
      [1, activityId(0), "b"],
      [1, activityId(1), "a"],
      [1, activityId(1), "b"],
      [1, AWARD_2, "a"],
      [2, activityId(2), "x"],
      [2, activityId(2), "y"],
      [2, AWARD, "x"],
    ]);
  });
});

describe("provisional", () => {
  it("is true until every ranked Activity is finalized, then false", () => {
    const input = smallEvent({
      scores: [
        { a: 2, b: 1 },
        { a: 1, b: 2 },
      ],
    });
    expect(registry(input).provisional).toBe(true);
    const one = { ...input, actions: [finalizeNow(input, 0)] };
    expect(registry(one).provisional).toBe(true);
    const all = {
      ...input,
      actions: [finalizeNow(input, 0), finalizeNow(input, 1)],
    };
    expect(registry(all).provisional).toBe(false);
  });

  it("doesn't count an Exhibition", () => {
    const input = smallEvent({ scores: [{ a: 2, b: 1 }, { a: 1 }] });
    const exhibition = {
      ...input,
      activities: input.activities.map((a, i) =>
        i === 1 ? { ...a, scoringType: "exhibition" as const } : a,
      ),
    };
    const done = { ...exhibition, actions: [finalizeNow(exhibition, 0)] };
    expect(registry(done).provisional).toBe(false);
  });
});
