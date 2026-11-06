import {
  ActivitySchema,
  AwardRuleSchema,
  CommonFieldSetSchema,
  EventSchema,
  FieldId,
  NonEmptyText,
  Slug,
} from "@camporee-conductor/schema";
import { z } from "zod";
import {
  defaultV1ImportOptions,
  importV1Cartridge,
  unresolvedVariables,
  V1ImportError,
  type V1ImportOptions,
  type V1ImportResult,
} from "./import-v1.ts";
import { stableUuid7 } from "./stable-id.ts";
import type { V1Cartridge } from "./types.ts";

/**
 * An event's v2-only design choices, applied after every import of its v1 cartridge (issue #46): what
 * v1 can't express (Awards, primary metrics, Program Guide settings), plus naming and, for Circus 2026
 * only, corrections to v1 Common Fields. Kept in the repo next to the event (no personal data).
 */
export const V1OverlaySchema = z.strictObject({
  /** Naming; anything left out comes from `defaultV1ImportOptions`. */
  import: z
    .strictObject({
      idNamespace: z.string().min(1).optional(),
      /** The UUID v7 date, e.g. "2026-10-30". */
      idDate: z.iso.date().optional(),
      eventSlug: Slug.optional(),
      commonFieldSet: z
        .strictObject({ slug: Slug, title: NonEmptyText })
        .optional(),
    })
    .optional(),
  /** Awards (ADR-0019). `replacesGame`: a v1 game that was really this Award, left out of the import. */
  awards: z
    .array(
      z.strictObject({
        slug: Slug,
        label: NonEmptyText,
        /** The Competition's slug (the v1 league id). */
        competition: Slug,
        scope: z.enum(["event", "division"]).optional(),
        rule: AwardRuleSchema,
        replacesGame: z.string().min(1).optional(),
      }),
    )
    .optional(),
  /** v1 game id → its primary metric (ADR-0019 Measured Activities). */
  primaryMetrics: z
    .record(
      z.string(),
      z.strictObject({
        field: FieldId,
        direction: z.enum(["higher-wins", "lower-wins"]),
      }),
    )
    .optional(),
  /** Competition slug → settings. */
  competitions: z
    .record(
      Slug,
      z.strictObject({
        programGuide: z.strictObject({ listActivities: z.boolean() }),
      }),
    )
    .optional(),
  programGuide: z.strictObject({ skills: z.array(NonEmptyText) }).optional(),
  /** Common Field id → corrected text. For a new event, fix v1's presets instead. */
  commonFields: z
    .record(
      FieldId,
      z.strictObject({
        label: NonEmptyText.optional(),
        placeholder: z.string().optional(),
      }),
    )
    .optional(),
});

export type V1Overlay = z.infer<typeof V1OverlaySchema>;

/** Validates an overlay file's JSON, or refuses with one "overlay: …" line per problem. */
export function parseV1Overlay(json: unknown): V1Overlay {
  const result = V1OverlaySchema.safeParse(json);
  if (result.success) return result.data;
  throw new V1ImportError(
    result.error.issues.map(
      (issue) =>
        `overlay: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
    ),
  );
}

/** The import options for a cartridge: the overlay's naming over the defaults. */
export function v1ImportOptions(
  cartridge: V1Cartridge,
  overlay: V1Overlay = {},
): V1ImportOptions {
  const defaults = defaultV1ImportOptions(cartridge.camporee.meta);
  const naming = overlay.import ?? {};
  return {
    idNamespace: naming.idNamespace ?? defaults.idNamespace,
    idTimestamp: naming.idDate
      ? Date.parse(naming.idDate)
      : defaults.idTimestamp,
    eventSlug: naming.eventSlug ?? defaults.eventSlug,
    commonFieldSet: naming.commonFieldSet ?? defaults.commonFieldSet,
  };
}

/**
 * A v1 cartridge → v2 documents, with the event's overlay applied (issue #46). Without an overlay, it's
 * the plain mechanical import with default naming.
 */
export function importV1(
  cartridge: V1Cartridge,
  overlay: V1Overlay = {},
  { strict = false }: { strict?: boolean } = {},
): V1ImportResult {
  const options = v1ImportOptions(cartridge, overlay);
  const issues: string[] = [];

  // Check the overlay against the cartridge before importing.
  const leagues = new Set(cartridge.camporee.leagues.map((l) => l.id));
  const gameIds = new Set(cartridge.games.map((g) => g.id));
  for (const slug of Object.keys(overlay.competitions ?? {})) {
    if (!leagues.has(slug)) {
      issues.push(`overlay: competitions.${slug}: no such Competition`);
    }
  }
  for (const award of overlay.awards ?? []) {
    if (!leagues.has(award.competition)) {
      issues.push(
        `overlay: awards.${award.slug}: no Competition ${award.competition}`,
      );
    }
    if (award.replacesGame && !gameIds.has(award.replacesGame)) {
      issues.push(
        `overlay: awards.${award.slug}: replacesGame: no game ${award.replacesGame} in the cartridge`,
      );
    }
  }
  const presetIds = new Set(cartridge.presets.map((p) => p.id.trim()));
  for (const fieldId of Object.keys(overlay.commonFields ?? {})) {
    if (!presetIds.has(fieldId)) {
      issues.push(`overlay: commonFields.${fieldId}: no such Common Field`);
    }
  }
  for (const gameId of Object.keys(overlay.primaryMetrics ?? {})) {
    if (!gameIds.has(gameId)) {
      issues.push(
        `overlay: primaryMetrics.${gameId}: no game ${gameId} in the cartridge`,
      );
    }
  }
  if (issues.length > 0) throw new V1ImportError(issues);

  // Games that are really Awards never become Activities.
  const replaced = new Set(
    (overlay.awards ?? []).flatMap((a) =>
      a.replacesGame ? [a.replacesGame] : [],
    ),
  );
  const imported = importV1Cartridge(
    {
      ...cartridge,
      camporee: {
        ...cartridge.camporee,
        playlist: cartridge.camporee.playlist.filter(
          (e) => !replaced.has(e.gameId),
        ),
      },
      games: cartridge.games.filter((g) => !replaced.has(g.id)),
    },
    options,
    { strict },
  );

  const activities = imported.activities.map((activity) => {
    const primary = overlay.primaryMetrics?.[activity.slug];
    if (!primary) return activity;
    if (!activity.scoring.fields.some((f) => f.id === primary.field)) {
      issues.push(
        `overlay: primaryMetrics.${activity.slug}: no field ${primary.field}`,
      );
      return activity;
    }
    return ActivitySchema.parse({
      ...activity,
      scoring: {
        fields: activity.scoring.fields.map((f) =>
          f.id === primary.field
            ? { ...f, primary: { direction: primary.direction } }
            : f,
        ),
      },
    });
  });
  if (issues.length > 0) throw new V1ImportError(issues);

  const commonFieldSet = CommonFieldSetSchema.parse({
    ...imported.commonFieldSet,
    fields: imported.commonFieldSet.fields.map((field) => {
      const fix = overlay.commonFields?.[field.id];
      if (!fix) return field;
      return {
        ...field,
        ...(fix.label !== undefined && { label: fix.label }),
        ...(fix.placeholder !== undefined && {
          config: { ...field.config, placeholder: fix.placeholder },
        }),
      };
    }),
  });

  const competitionId = new Map(
    imported.event.competitions.map((c) => [c.slug, c.id]),
  );
  const event = EventSchema.parse({
    ...imported.event,
    competitions: imported.event.competitions.map((c) => {
      const settings = overlay.competitions?.[c.slug];
      return settings ? { ...c, programGuide: settings.programGuide } : c;
    }),
    ...(overlay.awards && {
      awards: overlay.awards.map((award) => ({
        id: stableUuid7(
          options.idNamespace,
          `award:${award.slug}`,
          options.idTimestamp,
        ),
        slug: award.slug,
        label: award.label,
        competitionId: competitionId.get(award.competition),
        scope: award.scope ?? "event",
        rule: award.rule,
      })),
    }),
    ...(overlay.programGuide && { programGuide: overlay.programGuide }),
  });

  // Re-check {{variables}} now the overlay may have corrected Common Field labels.
  const stale = new Set(
    unresolvedVariables(
      imported.event,
      imported.commonFieldSet,
      imported.activities,
    ),
  );
  return {
    event,
    commonFieldSet,
    activities,
    skipped: imported.skipped,
    notes: [
      ...imported.notes.filter((n) => !stale.has(n)),
      ...unresolvedVariables(event, commonFieldSet, activities),
    ],
  };
}
