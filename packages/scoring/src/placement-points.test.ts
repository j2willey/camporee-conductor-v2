import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLACEMENT_POINTS,
  placementPoints,
  scoreEvent,
} from "./index.ts";
import { smallEvent } from "./test-support.ts";

/** Each entrant's placement points at the first Activity, and its overall total. */
function pointsOf(...args: Parameters<typeof smallEvent>) {
  const results = scoreEvent(smallEvent(...args));
  return {
    activity: Object.fromEntries(
      (results.activities[0]?.entries ?? []).map((e) => [
        e.entrantId,
        e.points,
      ]),
    ),
    overall: Object.fromEntries(
      (results.standings[0]?.entrants ?? []).map((s) => [s.entrantId, s.total]),
    ),
  };
}

const SCORES = { t1: 40, t2: 30, t3: 20, t4: 10 };

describe("placement points table per Competition (ADR-0019)", () => {
  it("defaults to v1's table: 100, 90, 80, 70, 60, then 50 for taking part", () => {
    expect(DEFAULT_PLACEMENT_POINTS).toEqual({
      places: [100, 90, 80, 70, 60],
      participation: 50,
    });
    expect([1, 2, 3, 4, 5, 6, 9].map((r) => placementPoints(r))).toEqual([
      100, 90, 80, 70, 60, 50, 50,
    ]);
  });

  it("uses v1's table when the Competition doesn't set one", () => {
    expect(pointsOf({ scores: [SCORES] }).activity).toEqual({
      t1: 100,
      t2: 90,
      t3: 80,
      t4: 70,
    });
  });

  it("uses the Competition's table: named places, then participation", () => {
    expect(
      pointsOf({
        scores: [SCORES],
        placementPoints: { places: [25, 15], participation: 5 },
      }).activity,
    ).toEqual({ t1: 25, t2: 15, t3: 5, t4: 5 });
  });

  it("gives 0 for no result in an Activity, whatever the table says", () => {
    const { overall } = pointsOf({
      scores: [SCORES, { t1: 10, t2: 5 }],
      placementPoints: { places: [25, 15], participation: 5 },
    });
    // t3 and t4 have no result in the second Activity: 5 + 0 each.
    expect(overall).toEqual({ t1: 50, t2: 30, t3: 5, t4: 5 });
  });
});
