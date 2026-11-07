import { ScoringFieldSchema } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { valueProblem } from "./index.ts";

// One check for an entered value against its field, used by the judge page and by the Collator, which is
// the record of truth on event day: an old cached page or a modified client can't store an out-of-range
// value (#40 PR 2).

const field = (
  type: "number" | "stopwatch" | "text" | "select" | "checkbox",
  config?: { min?: number; max?: number; options?: string[] },
  required?: boolean,
) =>
  ScoringFieldSchema.parse({
    id: "flag",
    label: "Patrol Flag",
    type,
    kind: "points",
    audience: "judge",
    sortOrder: 0,
    ...(config && { config }),
    ...(required !== undefined && { required }),
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
    expect(valueProblem(flag, undefined)).toBeUndefined();
    expect(valueProblem(flag, "  ")).toBeUndefined();
  });

  it("leaves other field types alone (stopwatch text is read by scoring)", () => {
    expect(
      valueProblem(field("stopwatch", { max: 5 }), "1:23"),
    ).toBeUndefined();
    expect(valueProblem(field("text"), "anything")).toBeUndefined();
  });

  describe("a required field", () => {
    // The phone and the box agree on what's required (#40 PR 3). Which fields a Judge must fill in is the
    // caller's choice: only Judge fields (`audience: "judge"`); Officials fill in theirs later.
    const required = field("number", { min: 0, max: 5 }, true);

    it("refuses a blank: null, missing, empty or only spaces", () => {
      for (const blank of [null, undefined, "", "   "]) {
        expect(valueProblem(required, blank)).toBe("Patrol Flag is required");
      }
    });

    it("accepts a value, and still checks it", () => {
      expect(valueProblem(required, 0)).toBeUndefined();
      expect(valueProblem(required, 6)).toBe("Patrol Flag must be from 0 to 5");
    });

    it("applies to every field type", () => {
      expect(valueProblem(field("text", undefined, true), "")).toBe(
        "Patrol Flag is required",
      );
      expect(
        valueProblem(field("text", undefined, true), "ok"),
      ).toBeUndefined();
    });

    it("takes an unticked checkbox as a value, not a blank", () => {
      expect(
        valueProblem(field("checkbox", undefined, true), false),
      ).toBeUndefined();
    });

    it("isn't required when `required` is false or left out", () => {
      expect(
        valueProblem(field("number", undefined, false), null),
      ).toBeUndefined();
      expect(valueProblem(field("number"), null)).toBeUndefined();
    });
  });

  describe("a select field", () => {
    const pick = field("select", { options: ["Red", "Blue"] });

    it("accepts one of its options", () => {
      expect(valueProblem(pick, "Blue")).toBeUndefined();
    });

    it("refuses anything else, including a different case", () => {
      const problem = "Patrol Flag must be one of the listed options";
      expect(valueProblem(pick, "Green")).toBe(problem);
      expect(valueProblem(pick, "blue")).toBe(problem);
      expect(valueProblem(pick, 1)).toBe(problem);
      expect(valueProblem(pick, true)).toBe(problem);
    });

    it("lets a blank through unless required", () => {
      expect(valueProblem(pick, null)).toBeUndefined();
      expect(valueProblem(pick, "")).toBeUndefined();
      expect(
        valueProblem(field("select", { options: ["Red"] }, true), ""),
      ).toBe("Patrol Flag is required");
    });
  });
});
