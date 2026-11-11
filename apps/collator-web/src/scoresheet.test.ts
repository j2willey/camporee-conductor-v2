import { describe, expect, it } from "vitest";
import {
  fieldHint,
  sheetColumns,
  sheetRows,
  withDuplex,
  type SheetField,
  rowCount,
} from "./scoresheet.ts";

const field = (
  type: SheetField["type"],
  config: SheetField["config"] = {},
  label = "F",
): SheetField => ({ id: "f", label, type, config });
const labels = { team: "Patrol", group: "Troop" };

describe("fieldHint", () => {
  it("shows a number's range, or the one limit it has", () => {
    expect(fieldHint(field("number", { min: 0, max: 10 }))).toBe("0–10");
    expect(fieldHint(field("number", { max: 10 }))).toBe("max 10");
    expect(fieldHint(field("number", { min: 0 }))).toBe("min 0");
    expect(fieldHint(field("number"))).toBe("");
  });
  it("shows the shape of the other types", () => {
    expect(fieldHint(field("stopwatch"))).toBe("m:ss");
    expect(fieldHint(field("checkbox"))).toBe("✓ / ✗");
    expect(fieldHint(field("select", { options: ["A", "B", "C"] }))).toBe(
      "A / B / C",
    );
    expect(fieldHint(field("select"))).toBe("");
    expect(fieldHint(field("textarea"))).toBe("notes");
    expect(fieldHint(field("text"))).toBe("");
  });
});

describe("sheetRows", () => {
  const entrants = ["a", "b", "c"];
  it("lists the entrants, then blank rows up to the minimum", () => {
    const rows = sheetRows(entrants, 6);
    expect(rows).toEqual(["a", "b", "c", null, null, null]);
  });
  it("always leaves at least 3 blank rows after the entrants", () => {
    expect(sheetRows(entrants, 5)).toEqual(["a", "b", "c", null, null, null]);
    expect(sheetRows(["a", "b", "c", "d"], 5)).toHaveLength(7);
  });
  it("is all blank with no entrants", () => {
    expect(sheetRows([], 5)).toEqual([null, null, null, null, null]);
    expect(sheetRows([], 1)).toHaveLength(3);
  });
});

describe("sheetColumns", () => {
  const fields = [
    field("number", { min: 0, max: 10 }, "Patrol Flag"),
    field("stopwatch", {}, "Time"),
    field("textarea", {}, "Remarks"),
  ].map((f, i) => ({ ...f, id: `f${i}` }));

  it("a ranked team-level Activity: #, Group, Team, then each field with its hint and width", () => {
    const cols = sheetColumns(
      { scoringType: "ranked", level: "team", fields },
      labels,
    );
    expect(cols.map((c) => [c.label, c.hint, c.width])).toEqual([
      ["#", "", 24],
      ["Troop", "", 90],
      ["Patrol", "", 130],
      ["Patrol Flag", "0–10", 52],
      ["Time", "m:ss", 58],
      ["Remarks", "notes", 120],
    ]);
  });
  it("a group-level Activity leaves the Team column off", () => {
    const cols = sheetColumns(
      { scoringType: "ranked", level: "group", fields: [] },
      labels,
    );
    expect(cols.map((c) => c.label)).toEqual(["#", "Troop"]);
  });
  it("widths by type: checkbox 52, select 80", () => {
    const cols = sheetColumns(
      {
        scoringType: "ranked",
        level: "group",
        fields: [field("checkbox"), field("select", { options: ["x"] })],
      },
      labels,
    );
    expect(cols.slice(2).map((c) => c.width)).toEqual([52, 80]);
  });
  it("an Exhibition: #, Name, Group, Team, Place, Notes, whatever its level", () => {
    const cols = sheetColumns(
      { scoringType: "exhibition", level: "group", fields },
      labels,
    );
    expect(cols.map((c) => c.label)).toEqual([
      "#",
      "Name",
      "Troop",
      "Patrol",
      "Place",
      "Notes",
    ]);
  });
});

describe("withDuplex", () => {
  it("prints each sheet twice, in order", () => {
    expect(withDuplex(["a", "b"])).toEqual(["a", "a", "b", "b"]);
    expect(withDuplex([])).toEqual([]);
  });
});

describe("rowCount: the Rows box as typed, for the sheets", () => {
  it("keeps 5–60 as typed, so typing 40 passes through 4 without snapping", () => {
    expect(rowCount("40")).toBe(40);
    expect(rowCount("4")).toBe(5);
  });

  it("holds to 5–60, and an empty or unreadable box means v1's 20", () => {
    expect(rowCount("99")).toBe(60);
    expect(rowCount("")).toBe(20);
    expect(rowCount("abc")).toBe(20);
    expect(rowCount("12.7")).toBe(12);
  });
});
