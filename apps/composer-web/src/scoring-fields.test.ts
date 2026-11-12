import { describe, expect, it } from "vitest";
import {
  addField,
  duplicateField,
  moveField,
  removeField,
  setKind,
  setPrimary,
  setType,
  type Field,
} from "./scoring-fields.ts";

const field = (id: string, sortOrder: number, extra: Partial<Field> = {}) =>
  ({
    id,
    label: id,
    type: "number",
    kind: "points",
    audience: "judge",
    sortOrder,
    weight: 1,
    ...extra,
  }) as Field;
const fields = [field("a", 10), field("b", 20), field("c", 30)];
const ids = (list: Field[]) => list.map((f) => f.id);

describe("adding and copying fields", () => {
  it("adds a points field last, with an id nobody has, and numbers the list in tens", () => {
    const added = addField([...fields, field("new_field", 40)]);
    expect(added.at(-1)).toMatchObject({
      id: "new_field_2",
      label: "New field",
      type: "number",
      kind: "points",
      audience: "judge",
      sortOrder: 50,
    });
  });

  it("copies a field right after it, with a new id and no primary", () => {
    const copied = duplicateField(
      [
        field("a", 10, {
          kind: "metric",
          primary: { direction: "lower-wins" },
        }),
      ],
      0,
    );
    expect(ids(copied)).toEqual(["a", "a_copy"]);
    expect(copied[1]).toMatchObject({ label: "a (copy)", sortOrder: 20 });
    expect(copied[1]).not.toHaveProperty("primary");
  });
});

describe("moving and removing", () => {
  it("swaps neighbors and renumbers; the ends stay put", () => {
    const moved = moveField(fields, 2, -1);
    expect(ids(moved)).toEqual(["a", "c", "b"]);
    expect(moved.map((f) => f.sortOrder)).toEqual([10, 20, 30]);
    expect(moveField(fields, 0, -1)).toEqual(fields);
  });

  it("removes and renumbers", () => {
    expect(removeField(fields, 0).map((f) => [f.id, f.sortOrder])).toEqual([
      ["b", 10],
      ["c", 20],
    ]);
  });
});

describe("the primary metric (ADR-0019)", () => {
  const metrics = [
    field("time", 10, { kind: "metric", type: "stopwatch" }),
    field("count", 20, {
      kind: "metric",
      primary: { direction: "higher-wins" },
    }),
  ];

  it("is one field at most: choosing one clears the other, keeping a direction", () => {
    const chosen = setPrimary(metrics, 0, "lower-wins");
    expect(chosen[0]?.primary).toEqual({ direction: "lower-wins" });
    expect(chosen[1]).not.toHaveProperty("primary");
  });

  it("can be cleared", () => {
    expect(setPrimary(metrics, 1, null)[1]).not.toHaveProperty("primary");
  });

  it("goes when the field stops being a metric, or a number or stopwatch", () => {
    expect(setKind(metrics, 1, "points")[1]).not.toHaveProperty("primary");
    expect(setType(metrics, 1, "text")[1]).not.toHaveProperty("primary");
    expect(setType(metrics, 1, "stopwatch")[1]?.primary).toEqual({
      direction: "higher-wins",
    });
  });
});
