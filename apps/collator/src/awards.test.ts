import { describe, expect, it } from "vitest";
import type { EventResults } from "@camporee-conductor/scoring";
import { scoreOfActivityLine, scoreOfAwardLine } from "./awards.ts";

// The Awards view passes scores through from scoring's results (#43 PR 4): a lookup, never arithmetic.

const results = {
  activities: [
    {
      activityId: "act-1",
      entries: [
        { entrantId: "team-1", total: 14, disqualified: false },
        { entrantId: "team-2", total: 0, disqualified: false },
      ],
    },
  ],
  standings: [
    {
      competitionId: "comp-1",
      entrants: [{ entrantId: "team-1", total: 18, disqualified: false }],
    },
  ],
} as unknown as EventResults;

describe("a line's score, looked up from scoring's results", () => {
  it("an Activity line's is the entry's total, 0 included", () => {
    expect(scoreOfActivityLine(results, "act-1", "team-1")).toBe(14);
    expect(scoreOfActivityLine(results, "act-1", "team-2")).toBe(0);
  });

  it("an Award line's is the standing's total in the Award's Competition", () => {
    expect(scoreOfAwardLine(results, "comp-1", "team-1")).toBe(18);
  });

  it("is undefined when there is no entry or standing", () => {
    expect(scoreOfActivityLine(results, "act-1", "nobody")).toBeUndefined();
    expect(scoreOfActivityLine(results, "act-9", "team-1")).toBeUndefined();
    expect(scoreOfAwardLine(results, "comp-1", "nobody")).toBeUndefined();
    expect(scoreOfAwardLine(results, "comp-9", "team-1")).toBeUndefined();
  });
});
