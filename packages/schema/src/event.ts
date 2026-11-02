import { z } from "zod";
import {
  documentBase,
  LegacySchema,
  LineageSchema,
  NonEmptyText,
  rejectDuplicates,
  Slug,
  Uuid7,
} from "./common.ts";
import { FieldId } from "./field.ts";

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "must be a hex color like #C62828");

/** Packs relabel only the participant hierarchy and the event name (ADR-0003, amended). */
export const TerminologySchema = z.strictObject({
  pack: NonEmptyText,
  labels: z
    .strictObject({
      group: NonEmptyText.optional(),
      team: NonEmptyText.optional(),
      participant: NonEmptyText.optional(),
      event: NonEmptyText.optional(),
    })
    .optional(),
});

const LabelStyleSchema = z.strictObject({
  font: NonEmptyText,
  size: NonEmptyText,
  bold: z.boolean(),
});

/** The printed award sticker: two header lines, then the Activity name, then the winner. */
export const AwardLabelSchema = z.strictObject({
  line1: z.string(),
  line2: z.string(),
  /** One font for all four lines. */
  syncFonts: z.boolean(),
  styles: z.strictObject({
    line1: LabelStyleSchema,
    line2: LabelStyleSchema,
    activityName: LabelStyleSchema,
    winner: LabelStyleSchema,
  }),
});

export const DivisionSchema = z.strictObject({
  id: Uuid7,
  slug: Slug,
  label: NonEmptyText,
});

/**
 * Placement points a Final Ranking earns (ADR-0019): `places[0]` for 1st, `places[1]` for 2nd…, and
 * `participation` for any other placement. No result in an Activity is always 0.
 */
export const PlacementPointsSchema = z.strictObject({
  places: z.array(z.number().min(0)).min(1),
  participation: z.number().min(0),
});

/** A ranking pool of Activities and entrants (ADR-0003). Its label names its Activities on screen. */
export const CompetitionSchema = z.strictObject({
  id: Uuid7,
  slug: Slug,
  label: NonEmptyText,
  /** Who competes: Teams, or Groups (Teams' parents). */
  level: z.enum(["team", "group"]),
  /** `registered` = entrants come from the Collator roster; `open` = the Judge enters names. */
  registration: z.enum(["registered", "open"]),
  divisions: z.array(DivisionSchema).superRefine((divisions, ctx) =>
    rejectDuplicates(divisions, ctx, (d) => d.id, {
      label: "division id",
      path: "id",
    }),
  ),
  /** Set at design time; left out = v1's table, 100/90/80/70/60 and 50 for taking part. */
  placementPoints: PlacementPointsSchema.optional(),
  /** Common Fields applied before and after each Activity's own fields (ADR-0020). */
  commonFields: z
    .strictObject({
      setId: Uuid7,
      before: z.array(FieldId),
      after: z.array(FieldId),
    })
    .optional(),
  legacy: LegacySchema.optional(),
});

/**
 * How an Award picks its recipients from a Competition's standings (ADR-0019 Awards amendment).
 * `places`: by place number, 1st gets `names[0]`…; `top-percent`: a counted cutoff, ties at the line
 * included; `manual`: only Officials' `set-award` actions.
 */
export const AwardRuleSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("places"),
    names: z.array(NonEmptyText).min(1),
  }),
  z.strictObject({
    type: z.literal("top-percent"),
    percent: z.number().gt(0).max(100),
  }),
  z.strictObject({ type: z.literal("manual") }),
]);

/** Recognition drawn from one Competition's standings, e.g. Gold Axe or Top Dog. */
export const AwardSchema = z.strictObject({
  id: Uuid7,
  slug: Slug,
  label: NonEmptyText,
  competitionId: Uuid7,
  /** The whole Competition, or each Division separately (ADR-0007). */
  scope: z.enum(["event", "division"]).default("event"),
  rule: AwardRuleSchema,
});

/** One Activity in this Event. The list order is `sortOrder`, not array position. */
export const EventActivitySchema = z.strictObject({
  activityId: Uuid7,
  competitionId: Uuid7,
  sortOrder: z.int(),
});

const eventShape = {
  ...documentBase,
  theme: z.string().optional(),
  year: z.int().optional(),
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  organizerName: z.string().optional(),
  terminology: TerminologySchema,
  presentation: z.strictObject({
    themeColors: z.strictObject({
      main: HexColor,
      header: HexColor,
      accent: HexColor,
    }),
    awardLabel: AwardLabelSchema.optional(),
  }),
  competitions: z.array(CompetitionSchema).superRefine((competitions, ctx) =>
    rejectDuplicates(competitions, ctx, (c) => c.id, {
      label: "competition id",
      path: "id",
    }),
  ),
  activities: z.array(EventActivitySchema).superRefine((activities, ctx) => {
    rejectDuplicates(activities, ctx, (a) => a.activityId, {
      label: "activity id",
      path: "activityId",
    });
    rejectDuplicates(activities, ctx, (a) => a.sortOrder, {
      label: "sort order",
      path: "sortOrder",
    });
  }),
  /**
   * How tied places are numbered, for every Competition in the Event (ADR-0019): `dense` (1, 1, 2)
   * or `strict` (1, 1, 3). Defaults to dense when left out.
   */
  tieNumbering: z.enum(["dense", "strict"]).default("dense"),
  awards: z
    .array(AwardSchema)
    .superRefine((awards, ctx) =>
      rejectDuplicates(awards, ctx, (a) => a.id, {
        label: "award id",
        path: "id",
      }),
    )
    .optional(),
  lineage: LineageSchema.optional(),
  legacy: LegacySchema.optional(),
};

/** Checks that span several fields of an Event or Template. */
function checkEventReferences(
  event: z.infer<z.ZodObject<typeof eventShape>>,
  ctx: z.RefinementCtx,
): void {
  const competitionIds = new Set(event.competitions.map((c) => c.id));
  event.activities.forEach((entry, index) => {
    if (!competitionIds.has(entry.competitionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["activities", index, "competitionId"],
        message: "no Competition with this id in the Event",
      });
    }
  });
  event.awards?.forEach((award, index) => {
    if (!competitionIds.has(award.competitionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["awards", index, "competitionId"],
        message: "no Competition with this id in the Event",
      });
    }
  });
  if (event.startDate && event.endDate && event.endDate < event.startDate) {
    ctx.addIssue({
      code: "custom",
      path: ["endDate"],
      message: `must not be before startDate (${event.startDate})`,
    });
  }
}

/** One occurrence, with dates and venue. Holds presentation and the ordered Activity list. */
export const EventSchema = z
  .strictObject({ ...eventShape, kind: z.literal("event") })
  .superRefine(checkEventReferences);

/** A shareable, Event-shaped starting point, with lineage and attribution (ADR-0017). */
export const TemplateSchema = z
  .strictObject({ ...eventShape, kind: z.literal("template") })
  .superRefine(checkEventReferences);

export type Event = z.infer<typeof EventSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type Competition = z.infer<typeof CompetitionSchema>;
export type Award = z.infer<typeof AwardSchema>;
export type PlacementPoints = z.infer<typeof PlacementPointsSchema>;
