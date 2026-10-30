import { z } from "zod";

export const SCHEMA_VERSION = "4.0";

export const SchemaVersion = z.literal(SCHEMA_VERSION);

export const Uuid7 = z.uuid({ version: "v7", error: "must be a UUID v7" });

export const Slug = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "must be lowercase letters, digits and single hyphens",
  );

/** A string with at least one non-whitespace character. Unlike `.trim()`, it doesn't change the value. */
export const NonEmptyText = z
  .string()
  .refine((s) => s.trim().length > 0, "must not be empty");

/** External credit, e.g. "Theme from XYZ District, ABC Council 2025" (ADR-0017). */
export const AttributionSchema = z.strictObject({
  text: NonEmptyText,
  url: z.url().optional(),
});

/** Where a document came from: a parent document in v2 and/or external credit (ADR-0017). */
export const LineageSchema = z.strictObject({
  parentId: Uuid7.optional(),
  attribution: z.array(AttributionSchema).optional(),
});

/** Original v1 identifiers, kept on transcoded documents for the v1-compatible export (#8). */
export const LegacySchema = z.strictObject({
  v1Id: NonEmptyText,
  v1LibraryUuid: z.string().optional(),
  v1LibraryTitle: z.string().optional(),
});

/** Fields every top-level document has. Spread into each document schema. */
export const documentBase = {
  schemaVersion: SchemaVersion,
  id: Uuid7,
  slug: Slug,
  title: NonEmptyText,
};

/** Adds a "duplicate … id" issue for each item whose `key` was already seen in the array. */
export function rejectDuplicates<T>(
  items: readonly T[],
  ctx: z.RefinementCtx,
  key: (item: T) => string | number,
  { label, path }: { label: string; path: string },
): void {
  const seen = new Set<string | number>();
  items.forEach((item, index) => {
    const value = key(item);
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: [index, path],
        message: `duplicate ${label} ${JSON.stringify(value)}`,
      });
    }
    seen.add(value);
  });
}
