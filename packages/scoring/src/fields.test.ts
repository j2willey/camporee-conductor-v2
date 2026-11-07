import { ScoringFieldSchema } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { entryTotal, numberOf } from "./index.ts";

/** A judge number field as stored; `weight` is left out unless given. */
function field(id: string, kind: string, weight?: number) {
  return ScoringFieldSchema.parse({
    id,
    label: id,
    type: "number",
    kind,
    audience: "judge",
    sortOrder: 0,
    ...(weight === undefined ? {} : { weight }),
  });
}

describe("entryTotal: weight (ADR-0019 amendment 2026-10-30)", () => {
  it("multiplies a points field's value by its weight", () => {
    expect(entryTotal([field("knots", "points", 2)], { knots: 7 })).toBe(14);
  });

  it("multiplies a penalty field's value by its weight before subtracting it", () => {
    const fields = [field("knots", "points"), field("late", "penalty", 3)];
    expect(entryTotal(fields, { knots: 10, late: 2 })).toBe(4);
  });

  it("records a weight-0 field but doesn't score it", () => {
    const fields = [field("knots", "points"), field("bonus", "points", 0)];
    expect(entryTotal(fields, { knots: 10, bonus: 5 })).toBe(10);
  });

  it("treats a field stored without a weight as weight 1", () => {
    expect(field("knots", "points").weight).toBe(1);
    expect(entryTotal([field("knots", "points")], { knots: 7 })).toBe(7);
  });

  it("allows a fractional weight", () => {
    expect(entryTotal([field("knots", "points", 0.5)], { knots: 7 })).toBe(3.5);
  });
});

describe("numberOf: how every reader turns a value into a number", () => {
  it("reads numbers and numeric text; blank, non-numeric and non-finite are undefined", () => {
    expect(numberOf(7)).toBe(7);
    expect(numberOf(" 2.5 ")).toBe(2.5);
    expect(numberOf("-3")).toBe(-3);
    expect(numberOf("")).toBeUndefined();
    expect(numberOf("  ")).toBeUndefined();
    expect(numberOf("abc")).toBeUndefined();
    expect(numberOf(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(numberOf(true)).toBeUndefined();
    expect(numberOf(undefined)).toBeUndefined();
  });
});
