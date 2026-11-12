import type { EventBundle } from "@camporee-conductor/cartridge";
import type { Event } from "@camporee-conductor/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/open.ts";
import { documents } from "../db/schema.ts";

/**
 * An Event and every document it references, exactly as stored (ADR-0012), for a cartridge export
 * (issue #8): its Activities (sorted by slug), the Common Field sets its Competitions use, and its
 * Officials document if it has one. `undefined` if there's no such Event.
 */
export function readEventDocuments(
  db: Db,
  eventId: string,
): { organizationId: string; bundle: EventBundle } | undefined {
  const row = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, eventId), eq(documents.kind, "event")))
    .get();
  if (!row) return undefined;
  return {
    organizationId: row.organizationId,
    bundle: eventBundleFor(db, row.organizationId, JSON.parse(row.json)),
  };
}

/**
 * A Template and the documents it references, exactly as stored (#102 PR 4), like `readEventDocuments`. A Template
 * never has Officials. `undefined` if there's no such Template.
 */
export function readTemplateDocuments(
  db: Db,
  templateId: string,
):
  | {
      organizationId: string;
      visibility: "private" | "library";
      bundle: EventBundle;
    }
  | undefined {
  const row = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, templateId), eq(documents.kind, "template")))
    .get();
  if (!row) return undefined;
  // Event-shaped (ADR-0017): its Activities and set are found the same way.
  const bundle = eventBundleFor(db, row.organizationId, JSON.parse(row.json));
  delete bundle.officials;
  return {
    organizationId: row.organizationId,
    visibility: row.visibility,
    bundle,
  };
}

/**
 * The bundle for `rawEvent` (stored, or about to be saved, ADR-0029) with the documents it references from its
 * Organization only. Documents it names that aren't there are left out, so `checkEventBundle` reports them.
 * `rawEvent` must already pass `EventSchema`.
 */
export function eventBundleFor(
  db: Db,
  organizationId: string,
  rawEvent: unknown,
): EventBundle {
  const event = rawEvent as Event;
  const inOrg = (
    kind: "activity" | "common-field-set" | "officials",
    ids?: string[],
  ) =>
    db
      .select({ id: documents.id, slug: documents.slug, json: documents.json })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.kind, kind),
          ...(ids ? [inArray(documents.id, ids)] : []),
        ),
      )
      .all();

  const activityIds = event.activities.map((a) => a.activityId);
  const setIds = [
    ...new Set(
      event.competitions.flatMap((c) =>
        c.commonFields ? [c.commonFields.setId] : [],
      ),
    ),
  ];
  const officials = inOrg("officials")
    .map((r) => JSON.parse(r.json) as { eventId?: string })
    .find((doc) => doc.eventId === event.id);
  return {
    event: rawEvent,
    activities: inOrg("activity", activityIds)
      .sort((a, b) => a.slug.localeCompare(b.slug))
      .map((r) => JSON.parse(r.json)),
    commonFieldSets: inOrg("common-field-set", setIds).map((r) =>
      JSON.parse(r.json),
    ),
    ...(officials && { officials }),
  };
}
