import { describe, expect, it } from "vitest";
import {
  provisionalBanner,
  winnerName,
  winnerPlace,
  winnerRow,
} from "./winners-text.ts";

describe("winners text", () => {
  it("names a Team with its Group, a Group alone, and an unknown id", () => {
    expect(winnerName({ group: "Troop 101", team: "Owls" })).toBe(
      "Owls (Troop 101)",
    );
    expect(winnerName({ group: "Troop 101", team: null })).toBe("Troop 101");
    expect(winnerName({ group: null, team: null })).toBe("(unknown)");
  });

  it("says a place name, else an ordinal, else the Award's title", () => {
    expect(winnerPlace({ rank: 1, place: "Gold Axe" }, "Axes")).toBe(
      "Gold Axe",
    );
    expect(winnerPlace({ rank: 2 }, "Clown Car")).toBe("2nd");
    expect(winnerPlace({}, "Top Dog")).toBe("Top Dog");
  });

  it("marks an Official's own choice", () => {
    expect(
      winnerRow(
        { title: "Top Dog" },
        {
          entrantId: "g",
          entrant: { group: "Troop 7", team: null },
          manual: true,
        },
      ),
    ).toEqual({ place: "Top Dog", name: "Troop 7", official: true });
  });

  it("says Provisional until every Activity is final", () => {
    expect(
      provisionalBanner({
        provisional: true,
        finalizedCount: 3,
        rankedCount: 20,
      }),
    ).toBe("Provisional: 3 of 20 Activities final. Awards may change.");
    expect(
      provisionalBanner({
        provisional: false,
        finalizedCount: 20,
        rankedCount: 20,
      }),
    ).toBe("All Activities final.");
  });
});
