import { z } from "zod";
import { ActivitySchema } from "./activity.ts";
import { CommonFieldSetSchema } from "./common-field-set.ts";
import { EventSchema, TemplateSchema } from "./event.ts";

/** Where the committed JSON Schema files live. */
export const JSON_SCHEMA_DIR = new URL("../json-schema/", import.meta.url);

export const DOCUMENT_SCHEMAS = {
  activity: ActivitySchema,
  "common-field-set": CommonFieldSetSchema,
  event: EventSchema,
  template: TemplateSchema,
} as const;

/**
 * JSON Schema (draft 2020-12) for each document type, generated from the Zod schemas.
 * Custom checks (`refine`, `superRefine`) can't be expressed in JSON Schema, so Zod
 * remains the full validator; these files describe the shape for other tools.
 * They describe documents as stored (`io: "input"`), so a field with a default may be left out.
 */
export function buildJsonSchemas(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(DOCUMENT_SCHEMAS).map(([name, schema]) => [
      name,
      {
        title: name,
        ...z.toJSONSchema(schema, {
          target: "draft-2020-12",
          io: "input",
        }),
      },
    ]),
  );
}
