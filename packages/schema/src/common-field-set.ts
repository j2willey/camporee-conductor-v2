import { z } from "zod";
import { documentBase, LegacySchema } from "./common.ts";
import { ScoringFieldList } from "./field.ts";

/**
 * Common Fields, defined once and referenced by Competitions, which apply them to every
 * Activity at runtime (ADR-0020). Replaces v1 `presets.json`.
 */
export const CommonFieldSetSchema = z.strictObject({
  ...documentBase,
  kind: z.literal("common-field-set"),
  fields: ScoringFieldList.min(1, "must have at least one field"),
  legacy: LegacySchema.optional(),
});

export type CommonFieldSet = z.infer<typeof CommonFieldSetSchema>;
