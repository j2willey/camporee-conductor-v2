import { z } from "zod";
import { NonEmptyText, rejectDuplicates } from "./common.ts";

export const FieldId = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "must be lowercase letters, digits and underscores, starting with a letter",
  );

export const FIELD_TYPES = [
  "number",
  "stopwatch",
  "text",
  "textarea",
  "checkbox",
  "select",
] as const;

/** What a field's value means to scoring (ADR-0019). `info` never affects points. */
export const FIELD_KINDS = ["points", "metric", "penalty", "info"] as const;

const defaultValueKind = {
  number: "number",
  stopwatch: "number",
  text: "string",
  textarea: "string",
  select: "string",
  checkbox: "boolean",
} as const satisfies Record<
  (typeof FIELD_TYPES)[number],
  "number" | "string" | "boolean"
>;

/**
 * One scored or recorded item on a judge or Official form. Used for an Activity's own fields
 * and for Common Fields (ADR-0020).
 */
export const ScoringFieldSchema = z
  .strictObject({
    id: FieldId,
    label: NonEmptyText,
    type: z.enum(FIELD_TYPES),
    kind: z.enum(FIELD_KINDS),
    audience: z.enum(["judge", "official"]),
    sortOrder: z.int(),
    /**
     * Per-field multiplier; 1 = no change, 0 = recorded but not scored. Defaults to 1 when left
     * out. Design default only; event-day changes live on the Collator (ADR-0019).
     */
    weight: z.number().min(0).default(1),
    required: z.boolean().optional(),
    config: z
      .strictObject({
        min: z.number().optional(),
        max: z.number().optional(),
        placeholder: z.string().optional(),
        defaultValue: z.union([z.number(), z.string(), z.boolean()]).optional(),
        options: z.array(NonEmptyText).optional(),
      })
      .optional(),
    /** Values from v1 that v4 doesn't use. v1 stored a weight but never applied it. */
    legacy: z.strictObject({ v1Weight: z.number().optional() }).optional(),
  })
  .superRefine((field, ctx) => {
    const config = field.config ?? {};
    if (
      config.min !== undefined &&
      config.max !== undefined &&
      config.min > config.max
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "max"],
        message: `must be >= min (${config.min})`,
      });
    }
    if (field.type === "select" && (config.options ?? []).length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "options"],
        message: "a select field needs at least one option",
      });
    }
    const expected = defaultValueKind[field.type];
    if (
      config.defaultValue !== undefined &&
      typeof config.defaultValue !== expected
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["config", "defaultValue"],
        message: `a ${field.type} field needs a ${expected} default`,
      });
    }
  });

export type ScoringField = z.infer<typeof ScoringFieldSchema>;

/** A list of fields whose ids are unique within the list. */
export const ScoringFieldList = z
  .array(ScoringFieldSchema)
  .superRefine((fields, ctx) =>
    rejectDuplicates(fields, ctx, (f) => f.id, {
      label: "field id",
      path: "id",
    }),
  );
