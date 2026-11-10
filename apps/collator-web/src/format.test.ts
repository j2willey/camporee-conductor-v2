import { describe, expect, it } from "vitest";
import { clock, entrantLabel, levelLabel, ordinal } from "./format.ts";

describe("ordinal", () => {
  it("names places as people say them", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(
      [
        "1st",
        "2nd",
        "3rd",
        "4th",
        "11th",
        "12th",
        "13th",
        "21st",
        "22nd",
        "23rd",
        "101st",
        "111th",
      ],
    );
  });
});

describe("entrantLabel", () => {
  it("shows a Team with its Group", () => {
    expect(
      entrantLabel("team-1", { name: "Flaming Arrows", group: "Troop 101" }),
    ).toBe("Flaming Arrows (Troop 101)");
  });

  it("shows a Group by its name", () => {
    expect(entrantLabel("group-1", { name: "Troop 101", group: null })).toBe(
      "Troop 101",
    );
  });

  it("falls back to the id for an entrant not on the roster", () => {
    expect(entrantLabel("team-x", { name: null, group: null })).toBe("team-x");
  });
});

describe("levelLabel", () => {
  const labels = { team: "Patrol", group: "Troop" };
  it("names who's scored at a Competition's level, in the event's words", () => {
    expect(levelLabel("team", labels)).toBe("Patrol");
    expect(levelLabel("group", labels)).toBe("Troop");
  });
});

describe("clock", () => {
  const at = new Date("2027-05-15T14:07:09Z");

  it("shows hours and minutes, the same from a Date or its ISO time", () => {
    expect(clock(at)).toBe(clock(at.toISOString()));
    expect(clock(at)).toMatch(/^\d{1,2}[:.]\d{2}/);
    expect(clock(at)).toBe(
      at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
  });

  it("can add seconds", () => {
    expect(clock(at, true)).toBe(
      at.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    );
    expect(clock(at, true)).not.toBe(clock(at));
  });
});
