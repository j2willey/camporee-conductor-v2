import { checkEventBundle } from "@camporee-conductor/cartridge";
import {
  SCHEMA_VERSION,
  type Activity,
  type CommonFieldSet,
  type Event,
} from "@camporee-conductor/schema";
import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { documents, type DocumentKind } from "../db/schema.ts";
import { readEventDocuments } from "../export/read-event-documents.ts";
import { newUuid7, slugify } from "./event-activities.ts";
import { audit } from "./save.ts";

/**
 * New Event and Duplicate Event (ADR-0029, #100 PR 1). Both make new documents in one transaction, checked with
 * `checkEventBundle` like an import, with an audit row for each.
 */

/** The default Terminology Pack (CONTEXT.md): a new Organization's first Event starts with it. */
export const SCOUTING_PACK: Event["terminology"] = {
  pack: "scouting",
  labels: {
    group: "Troop",
    team: "Patrol",
    participant: "Scout",
    event: "Camporee",
  },
};

/** v1's default theme colors, also the Event details page's "reset to defaults". */
export const DEFAULT_THEME_COLORS = {
  main: "#0d6efd",
  header: "#34495e",
  accent: "#3498db",
};

type Who = { userId: string; now: Date };

/**
 * A new Event, with no Competitions or Activities yet. Its terminology is the Organization's newest Event's, or the
 * Scouting pack. The slug is `slug`, or made from the title; 409 if another Event in the Organization has it.
 */
export function createEvent(
  db: Db,
  {
    organizationId,
    title,
    slug,
    userId,
    now,
  }: Who & { organizationId: string; title: string; slug?: string | undefined },
): { eventId: string } {
  return db.transaction(() => {
    requireRole(db, organizationId, userId, "editor");
    const newest = db
      .select({ json: documents.json })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.kind, "event"),
        ),
      )
      .orderBy(desc(documents.updatedAt))
      .get();
    const terminology = newest
      ? (JSON.parse(newest.json) as Event).terminology
      : SCOUTING_PACK;
    const eventId = newUuid7(now);
    const event = {
      schemaVersion: SCHEMA_VERSION,
      id: eventId,
      kind: "event",
      slug: slug ?? slugify(title),
      title,
      terminology,
      presentation: { themeColors: { ...DEFAULT_THEME_COLORS } },
      competitions: [],
      activities: [],
    };
    // The name check (#100): a taken slug is refused, never numbered, so two Events can't share a name by accident.
    requireFreeEventSlug(db, organizationId, event.slug);
    insertChecked(
      db,
      organizationId,
      { event, activities: [], sets: [] },
      {
        userId,
        now,
        detail: {},
      },
    );
    return { eventId };
  });
}

/**
 * A copy of the Event in its Organization: new ids for the Event, every Activity and the Common Field set (so
 * editing one Event never changes the other), each copy naming its source in `lineage.parentId`, without `legacy`.
 * The Officials aren't copied. Title " (copy)" and slug "-copy" (numbered if taken) unless given; Activities keep
 * their slugs.
 */
export function duplicateEvent(
  db: Db,
  {
    eventId,
    title,
    slug,
    userId,
    now,
  }: Who & {
    eventId: string;
    title?: string | undefined;
    slug?: string | undefined;
  },
): { eventId: string } {
  return db.transaction(() => {
    const found = readEventDocuments(db, eventId);
    if (!found) throw new HTTPException(404, { message: "Not found." });
    const { organizationId } = found;
    requireRole(db, organizationId, userId, "editor");
    // Stored documents passed the same checks on import or save (ADR-0012, ADR-0029).
    const source = found.bundle.event as Event;
    const activities = found.bundle.activities as Activity[];
    const sets = found.bundle.commonFieldSets as CommonFieldSet[];

    const newEventId = newUuid7(now);
    const copyTitle = title ?? `${source.title} (copy)`;
    if (slug !== undefined) requireFreeEventSlug(db, organizationId, slug);
    const copySlug =
      slug ?? freeSlug(db, organizationId, "event", `${source.slug}-copy`);

    const activityIds = new Map(
      activities.map((a) => [a.id, newUuid7(now)] as const),
    );
    // Activity slugs stay: they only need to be unique within an Event (cartridge file names).
    const activityCopies = activities.map((a) => {
      const copy: Activity = {
        ...a,
        id: activityIds.get(a.id) ?? a.id,
        lineage: { ...a.lineage, parentId: a.id },
      };
      delete copy.legacy;
      return copy;
    });
    const setIds = new Map(sets.map((s) => [s.id, newUuid7(now)] as const));
    const takenSetSlugs = new Set<string>();
    const setCopies = sets.map((s) => {
      const copy: CommonFieldSet = {
        ...s,
        id: setIds.get(s.id) ?? s.id,
        slug: freeSlug(
          db,
          organizationId,
          "common-field-set",
          `${copySlug}-common-fields`,
          takenSetSlugs,
        ),
        title: `${copyTitle} Common Fields`,
      };
      takenSetSlugs.add(copy.slug);
      delete copy.legacy;
      return copy;
    });
    const event: Event = {
      ...source,
      id: newEventId,
      slug: copySlug,
      title: copyTitle,
      lineage: { ...source.lineage, parentId: source.id },
      competitions: source.competitions.map((c) =>
        c.commonFields
          ? {
              ...c,
              commonFields: {
                ...c.commonFields,
                setId: setIds.get(c.commonFields.setId) ?? c.commonFields.setId,
              },
            }
          : c,
      ),
      activities: source.activities.map((a) => ({
        ...a,
        activityId: activityIds.get(a.activityId) ?? a.activityId,
      })),
    };
    delete event.legacy;
    insertChecked(
      db,
      organizationId,
      { event, activities: activityCopies, sets: setCopies },
      { userId, now, detail: { parentId: source.id } },
    );
    return { eventId: newEventId };
  });
}

/** Checks the new documents as one bundle (422 on a problem), inserts them, and audits each. */
function insertChecked(
  db: Db,
  organizationId: string,
  docs: { event: unknown; activities: Activity[]; sets: CommonFieldSet[] },
  { userId, now, detail }: Who & { detail: Record<string, unknown> },
): void {
  const check = checkEventBundle({
    event: docs.event,
    activities: docs.activities,
    commonFieldSets: docs.sets,
  });
  if (!check.ok) {
    throw new HTTPException(422, { message: check.issues.join("\n") });
  }
  const event = check.bundle.event;
  const rows: { kind: DocumentKind; doc: unknown; parentId?: string }[] = [
    ...docs.sets.map((doc) => ({
      kind: "common-field-set" as const,
      doc,
    })),
    ...docs.activities.map((doc) => ({
      kind: "activity" as const,
      doc,
      ...(doc.lineage?.parentId && { parentId: doc.lineage.parentId }),
    })),
    { kind: "event", doc: docs.event },
  ];
  for (const { kind, doc, parentId } of rows) {
    const { id, slug, title } = doc as {
      id: string;
      slug: string;
      title: string;
    };
    db.insert(documents)
      .values({
        id,
        kind,
        organizationId,
        slug,
        title,
        json: JSON.stringify(doc),
        updatedAt: now,
      })
      .run();
    audit(db, {
      at: now,
      userId,
      organizationId,
      action: `${kind}.create`,
      documentKind: kind,
      documentId: id,
      detail:
        kind === "event"
          ? Object.keys(detail).length > 0
            ? detail
            : null
          : { eventId: event.id, ...(parentId && { parentId }) },
    });
  }
}

/** 409 when another Event in the Organization has `slug`, naming it. */
function requireFreeEventSlug(
  db: Db,
  organizationId: string,
  slug: string,
): void {
  const other = db
    .select({ title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.kind, "event"),
        eq(documents.slug, slug),
      ),
    )
    .get();
  if (other) {
    throw new HTTPException(409, {
      message: `${other.title} already uses the slug ${slug}. Choose another.`,
    });
  }
}

/** `base`, or `base-2`, `base-3`…: the first no document of `kind` in the Organization (or in `alsoTaken`) has. */
function freeSlug(
  db: Db,
  organizationId: string,
  kind: DocumentKind,
  base: string,
  alsoTaken: ReadonlySet<string> = new Set(),
): string {
  const taken = new Set([
    ...alsoTaken,
    ...db
      .select({ slug: documents.slug })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.kind, kind),
        ),
      )
      .all()
      .map((r) => r.slug),
  ]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}
