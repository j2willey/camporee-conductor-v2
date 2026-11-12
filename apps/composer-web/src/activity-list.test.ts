import { describe, expect, it } from "vitest";
import { entriesOf, moveTo, moveWithin, setEnabled } from "./activity-list.ts";

const A = "games";
const B = "challenges";
const list = [
  { activityId: "a1", competitionId: A, sortOrder: 1 },
  { activityId: "b1", competitionId: B, sortOrder: 2 },
  { activityId: "a2", competitionId: A, sortOrder: 3 },
  { activityId: "a3", competitionId: A, sortOrder: 4 },
];
const ids = (entries: typeof list, competitionId: string) =>
  entriesOf(entries, competitionId).map((e) => e.activityId);

describe("moveWithin", () => {
  it("swaps with the neighbor in the same Competition, skipping other Competitions", () => {
    const moved = moveWithin(list, "a2", -1);
    expect(ids(moved, A)).toEqual(["a2", "a1", "a3"]);
    expect(ids(moved, B)).toEqual(["b1"]);
    expect(moved.find((e) => e.activityId === "b1")?.sortOrder).toBe(2);
  });

  it("leaves the list alone at either end", () => {
    expect(moveWithin(list, "a1", -1)).toEqual(list);
    expect(moveWithin(list, "a3", 1)).toEqual(list);
  });
});

describe("moveTo", () => {
  it("puts the Activity last in the other Competition, with a sortOrder nobody has", () => {
    const moved = moveTo(list, "a1", B);
    expect(ids(moved, B)).toEqual(["b1", "a1"]);
    expect(ids(moved, A)).toEqual(["a2", "a3"]);
    expect(new Set(moved.map((e) => e.sortOrder)).size).toBe(moved.length);
  });

  it("does nothing when it's already in that Competition", () => {
    expect(moveTo(list, "a1", A)).toEqual(list);
  });
});

describe("setEnabled", () => {
  it("writes enabled: false to switch off, and removes the key to switch on", () => {
    const off = setEnabled(list, "a2", false);
    expect(off[2]).toEqual({ ...list[2], enabled: false });
    const on = setEnabled(off, "a2", true);
    expect(on[2]).toEqual(list[2]);
    expect(on[2]).not.toHaveProperty("enabled");
  });
});
