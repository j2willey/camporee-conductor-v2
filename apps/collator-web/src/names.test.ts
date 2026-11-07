import { describe, expect, it } from "vitest";
import { matchingGroup, matchingTeam, sameName } from "./names.ts";

// Two Judges adding the same Patrol on separate phones makes duplicate Teams (#40 PR 2). Picking an
// existing one is the default; adding a name that matches one warns first. Merging duplicates is #42.

const groups = [
  { id: "g-101", name: "Troop 101" },
  { id: "g-7", name: "Troop 7" },
];
const teams = [
  { id: "t-1", groupId: "g-101", name: "Flaming Arrows" },
  { id: "t-2", groupId: "g-7", name: "Owls" },
];

describe("sameName", () => {
  it("ignores case, spacing, punctuation and accents", () => {
    expect(sameName("Flaming Arrows", "  flaming   ARROWS ")).toBe(true);
    expect(sameName("Flaming-Arrows!", "flaming arrows")).toBe(true);
    expect(sameName("Crème Brûlée", "creme brulee")).toBe(true);
  });

  it("tells different names apart", () => {
    expect(sameName("Flaming Arrows", "Flaming Arrow")).toBe(false);
    expect(sameName("Troop 101", "Troop 10")).toBe(false);
  });

  it("ignores a label word when given: '101' is 'Troop 101'", () => {
    expect(sameName("101", "Troop 101", "Troop")).toBe(true);
    expect(sameName("troop101", "Troop 101", "Troop")).toBe(true);
    expect(sameName("101", "Troop 101")).toBe(false);
  });
});

describe("matchingTeam", () => {
  it("finds a Team with the same name in the same Group", () => {
    expect(matchingTeam(teams, "g-101", "flaming arrows")?.id).toBe("t-1");
  });

  it("doesn't match a same-named Team in another Group", () => {
    expect(matchingTeam(teams, "g-7", "Flaming Arrows")).toBeUndefined();
  });

  it("finds nothing for a new name or a blank one", () => {
    expect(matchingTeam(teams, "g-101", "Eagles")).toBeUndefined();
    expect(matchingTeam(teams, "g-101", "   ")).toBeUndefined();
  });
});

describe("matchingGroup", () => {
  it("finds a Group by name, with or without the pack's Group label", () => {
    expect(matchingGroup(groups, "troop 101", "Troop")?.id).toBe("g-101");
    expect(matchingGroup(groups, "101", "Troop")?.id).toBe("g-101");
    expect(matchingGroup(groups, "Troop 1010", "Troop")).toBeUndefined();
  });
});
