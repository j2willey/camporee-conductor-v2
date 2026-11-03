import { describe, expect, it } from "vitest";
import {
  CommonFieldSetSchema,
  type CommonFieldSet,
} from "./common-field-set.ts";
import { issuesOf } from "./test-support.ts";

const validSet = (): CommonFieldSet => ({
  schemaVersion: "4.0",
  kind: "common-field-set",
  id: "0196cfa2-4c00-7000-8000-000000000010",
  slug: "circus-2026-common-fields",
  title: "Circus 2026 Common Fields",
  fields: [
    {
      id: "p_yell",
      label: "Patrol Yell",
      type: "number",
      kind: "points",
      audience: "judge",
      sortOrder: 20,
      weight: 5,
      config: { min: 0, max: 5 },
    },
  ],
});

describe("CommonFieldSetSchema", () => {
  it("accepts a valid set", () => {
    expect(CommonFieldSetSchema.parse(validSet())).toEqual(validSet());
  });

  it("requires at least one field", () => {
    expect(
      issuesOf(CommonFieldSetSchema, { ...validSet(), fields: [] }),
    ).toContain("fields: must have at least one field");
  });

  it("rejects duplicate field ids", () => {
    const set = validSet();
    expect(
      issuesOf(CommonFieldSetSchema, {
        ...set,
        fields: [...set.fields, ...set.fields],
      }),
    ).toContain('fields.1.id: duplicate field id "p_yell"');
  });

  it("rejects a primary metric: it belongs to one Activity (ADR-0019)", () => {
    const set = validSet();
    expect(
      issuesOf(CommonFieldSetSchema, {
        ...set,
        fields: [
          {
            ...set.fields[0],
            kind: "metric",
            primary: { direction: "higher-wins" },
          },
        ],
      }),
    ).toContain("fields.0.primary: a Common Field can't be a primary metric");
  });
});
