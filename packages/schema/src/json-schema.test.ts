import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildJsonSchemas, JSON_SCHEMA_DIR } from "./json-schema.ts";

describe("generated JSON Schema files", () => {
  const generated = buildJsonSchemas();

  it("covers every document type", () => {
    expect(Object.keys(generated).sort()).toEqual([
      "activity",
      "common-field-set",
      "event",
      "template",
    ]);
  });

  it.each(Object.entries(generated))(
    "%s.schema.json is up to date with the Zod schema",
    (name, schema) => {
      const file = new URL(`${name}.schema.json`, JSON_SCHEMA_DIR);
      const committed: unknown = JSON.parse(readFileSync(file, "utf8"));
      expect(
        committed,
        "stale: run `pnpm --filter @camporee-conductor/schema generate` and commit the result",
      ).toEqual(schema);
    },
  );

  it("rejects unknown keys, as the Zod schemas do", () => {
    expect(generated["activity"]).toMatchObject({
      additionalProperties: false,
    });
  });
});
