import { describe, expect, it } from "vitest";
import {
  moveItem,
  removeItem,
  renameVariable,
  replaceItem,
  withOptional,
} from "./draft.ts";

describe("list helpers", () => {
  const list = ["a", "b", "c"];
  it("moves an item up or down, and leaves the ends alone", () => {
    expect(moveItem(list, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 2, 1)).toEqual(list);
  });
  it("removes and replaces by index, without touching the original", () => {
    expect(removeItem(list, 1)).toEqual(["a", "c"]);
    expect(replaceItem(list, 1, "B")).toEqual(["a", "B", "c"]);
    expect(list).toEqual(["a", "b", "c"]);
  });
});

describe("withOptional", () => {
  it("sets a value, and removes the key for an empty one, so the stored document keeps its shape", () => {
    const doc: { title: string; tags?: string[] } = { title: "x" };
    expect(withOptional(doc, "tags", ["#knots"])).toEqual({
      title: "x",
      tags: ["#knots"],
    });
    expect(withOptional({ ...doc, tags: ["#knots"] }, "tags", [])).toEqual({
      title: "x",
    });
    expect(
      withOptional({ ...doc, tags: ["#knots"] }, "tags", undefined),
    ).not.toHaveProperty("tags");
  });
  it("treats an empty string and an empty object as empty", () => {
    const supply: { item: string; group?: string } = { item: "Rope" };
    expect(withOptional(supply, "group", "")).toEqual({ item: "Rope" });
    const activity: { variables?: Record<string, string> } = {
      variables: { a: "1" },
    };
    expect(withOptional(activity, "variables", {})).toEqual({});
  });
});

describe("renameVariable", () => {
  const vars = { ten_essentials: "Buddy", rope_length: "6 ft" };
  it("keeps the value and the order", () => {
    const renamed = renameVariable(vars, "ten_essentials", "essential");
    expect(renamed).toEqual({ essential: "Buddy", rope_length: "6 ft" });
    expect(Object.keys(renamed)).toEqual(["essential", "rope_length"]);
  });
  it("refuses a name another variable has", () => {
    expect(() => renameVariable(vars, "ten_essentials", "rope_length")).toThrow(
      /already/,
    );
  });
});
