import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { ScoringFieldSchema, type ScoringField } from "./field.ts";
import { issuesOf } from "./test-support.ts";

const numberField = (): ScoringField => ({
  id: "p_flag",
  label: "Patrol Flag",
  type: "number",
  kind: "points",
  audience: "judge",
  sortOrder: 10,
  weight: 10,
  config: { min: 0, max: 5, placeholder: "0-5 Points" },
});

describe("ScoringFieldSchema", () => {
  it("accepts a valid field", () => {
    expect(ScoringFieldSchema.parse(numberField())).toEqual(numberField());
  });

  it("allows fractional and zero weights", () => {
    expect(
      ScoringFieldSchema.safeParse({ ...numberField(), weight: 0.1 }).success,
    ).toBe(true);
    expect(
      ScoringFieldSchema.safeParse({ ...numberField(), weight: 0 }).success,
    ).toBe(true);
  });

  it("defaults weight to 1 when it's left out", () => {
    const input: z.input<typeof ScoringFieldSchema> = { ...numberField() };
    delete input.weight;
    expect(ScoringFieldSchema.parse(input).weight).toBe(1);
  });

  it("still rejects a negative weight", () => {
    expect(
      issuesOf(ScoringFieldSchema, { ...numberField(), weight: -1 }),
    ).toContain("weight: Too small: expected number to be >=0");
  });

  it("keeps the original v1 weight in legacy", () => {
    const field = { ...numberField(), weight: 1, legacy: { v1Weight: 10 } };
    expect(ScoringFieldSchema.parse(field)).toEqual(field);
    expect(
      issuesOf(ScoringFieldSchema, { ...field, legacy: { v1Wieght: 10 } }),
    ).toContain('legacy: Unrecognized key: "v1Wieght"');
  });

  it("uses generic audiences: judge or official (v1 'admin' is rejected)", () => {
    expect(
      issuesOf(ScoringFieldSchema, { ...numberField(), audience: "admin" }),
    ).toContain('audience: Invalid option: expected one of "judge"|"official"');
  });

  it("requires a snake_case field id", () => {
    expect(
      issuesOf(ScoringFieldSchema, { ...numberField(), id: "Patrol Flag" }),
    ).toContain(
      "id: must be lowercase letters, digits and underscores, starting with a letter",
    );
  });

  it("rejects min greater than max", () => {
    const field = { ...numberField(), config: { min: 10, max: 5 } };
    expect(issuesOf(ScoringFieldSchema, field)).toContain(
      "config.max: must be >= min (10)",
    );
  });

  it("requires options on a select field", () => {
    const field = { ...numberField(), type: "select", config: {} };
    expect(issuesOf(ScoringFieldSchema, field)).toContain(
      "config.options: a select field needs at least one option",
    );
  });

  it("requires defaultValue to match the field type", () => {
    const field = { ...numberField(), config: { defaultValue: false } };
    expect(issuesOf(ScoringFieldSchema, field)).toContain(
      "config.defaultValue: a number field needs a number default",
    );
    const checkbox = {
      ...numberField(),
      type: "checkbox",
      config: { defaultValue: 0 },
    };
    expect(issuesOf(ScoringFieldSchema, checkbox)).toContain(
      "config.defaultValue: a checkbox field needs a boolean default",
    );
  });
});
