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
  const event = JSON.parse(row.json) as Event;
  const inOrg = (
    kind: "activity" | "common-field-set" | "officials",
    ids?: string[],
  ) =>
    db
      .select({ id: documents.id, slug: documents.slug, json: documents.json })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, row.organizationId),
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
    .find((doc) => doc.eventId === eventId);
  return {
    organizationId: row.organizationId,
    bundle: {
      event: JSON.parse(row.json),
      activities: inOrg("activity", activityIds)
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .map((r) => JSON.parse(r.json)),
      commonFieldSets: inOrg("common-field-set", setIds).map((r) =>
        JSON.parse(r.json),
      ),
      ...(officials && { officials }),
    },
  };
}
