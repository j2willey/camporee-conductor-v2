import { ScoringFieldSchema } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { valueProblem } from "./index.ts";

// One check for an entered value against its field, used by the judge page and by the Collator, which is
// the record of truth on event day: an old cached page or a modified client can't store an out-of-range
// value (#40 PR 2).

const field = (
  type: "number" | "stopwatch" | "text",
  config?: { min?: number; max?: number },
) =>
  ScoringFieldSchema.parse({
    id: "flag",
    label: "Patrol Flag",
    type,
    kind: "points",
    audience: "judge",
    sortOrder: 0,
    ...(config && { config }),
  });

describe("valueProblem", () => {
  const flag = field("number", { min: 0, max: 5 });

  it("accepts a number in range, including both ends", () => {
    expect(valueProblem(flag, 3)).toBeUndefined();
    expect(valueProblem(flag, 0)).toBeUndefined();
    expect(valueProblem(flag, 5)).toBeUndefined();
  });

  it("refuses a number below min or above max", () => {
    expect(valueProblem(flag, -1)).toBe("Patrol Flag must be from 0 to 5");
    expect(valueProblem(flag, 6)).toBe("Patrol Flag must be from 0 to 5");
  });

  it("checks one end when only one is set", () => {
    const atLeastTwo = field("number", { min: 2 });
    expect(valueProblem(atLeastTwo, 1)).toBe("Patrol Flag must be at least 2");
    expect(valueProblem(atLeastTwo, 99)).toBeUndefined();
    const atMostTen = field("number", { max: 10 });
    expect(valueProblem(atMostTen, 11)).toBe("Patrol Flag must be at most 10");
  });

  it("accepts any number for a field with no range", () => {
    expect(valueProblem(field("number"), -1000)).toBeUndefined();
    expect(valueProblem(field("number"), 1e9)).toBeUndefined();
  });

  it("reads a number typed as text, as scoring does", () => {
    expect(valueProblem(flag, "4")).toBeUndefined();
    expect(valueProblem(flag, "9")).toBe("Patrol Flag must be from 0 to 5");
  });

  it("refuses something that isn't a number in a number field", () => {
    expect(valueProblem(flag, "lots")).toBe("Patrol Flag must be a number");
    expect(valueProblem(flag, true)).toBe("Patrol Flag must be a number");
    expect(valueProblem(flag, Number.NaN)).toBe("Patrol Flag must be a number");
  });

  it("lets a blank through: blank means not entered", () => {
    expect(valueProblem(flag, null)).toBeUndefined();
    expect(valueProblem(flag, "")).toBeUndefined();
  });

  it("leaves other field types alone (stopwatch text is read by scoring)", () => {
    expect(
      valueProblem(field("stopwatch", { max: 5 }), "1:23"),
    ).toBeUndefined();
    expect(valueProblem(field("text"), "anything")).toBeUndefined();
  });
});
