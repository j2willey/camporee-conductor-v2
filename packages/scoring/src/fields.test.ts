import { ScoringFieldSchema } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { entryTotal } from "./index.ts";

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
});
