import { z } from "zod";
import {
  documentBase,
  LegacySchema,
  LineageSchema,
  NonEmptyText,
} from "./common.ts";
import { ScoringFieldList } from "./field.ts";

export const SupplySchema = z.strictObject({
  item: NonEmptyText,
  /** Free text: Circus 2026 has quantities like "4–5", "1 set" and "1 per judge". */
  quantity: z.string().optional(),
});

/**
 * The fixed sections every Activity has, so the Program Guide is consistent (ADR-0018).
 * Program Guide text must be non-empty; logistics sections may be empty strings.
 */
export const ActivityContentSchema = z.strictObject({
  story: NonEmptyText,
  /** v1 called this `challenge`. */
  objective: NonEmptyText,
  description: NonEmptyText,
  rules: z.array(NonEmptyText).min(1, "must have at least one rule"),
  timeAndScoring: NonEmptyText,
  setup: z.string(),
  reset: z.string(),
  staffing: z.string(),
  supplies: z.array(SupplySchema),
  notes: z.string(),
  /** Optional extra sections, printed after the fixed ones. */
  customSections: z
    .array(z.strictObject({ title: NonEmptyText, body: NonEmptyText }))
    .optional(),
});

/** Template variables, substituted into `{{key}}` tokens in Common Field labels. */
export const VariablesSchema = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/, "variable names must be snake_case"),
  z.string(),
);

/** Anything that happens at a Station (ADR-0003, amended 2026-10-30). */
export const ActivitySchema = z.strictObject({
  ...documentBase,
  kind: z.literal("activity"),
  /** `ranked` counts toward team standings; `exhibition` is individual recognition only. */
  scoringType: z.enum(["ranked", "exhibition"]),
  content: ActivityContentSchema,
  scoring: z.strictObject({
    /** v1 `points_desc` = higher-wins, `timed_asc` = lower-wins. */
    direction: z.enum(["higher-wins", "lower-wins"]),
    fields: ScoringFieldList.min(1, "must have at least one scoring field"),
  }),
  variables: VariablesSchema.optional(),
  tags: z.array(NonEmptyText).optional(),
  lineage: LineageSchema.optional(),
  legacy: LegacySchema.optional(),
});

export type Activity = z.infer<typeof ActivitySchema>;
