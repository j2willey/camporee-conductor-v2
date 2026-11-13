import { SCHEMA_VERSION, type Officials } from "@camporee-conductor/schema";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { documents, type Role } from "../db/schema.ts";
import { newUuid7 } from "./event-activities.ts";
import { audit, officialsIssues } from "./save.ts";

/**
 * The Event's Officials (ADR-0027 item 5, #100 PR 4): emails that sign in on the Collator, so editors and owners
 * only, even to read; a viewer gets 403. One document per Event, travelling only in its event-day cartridge.
 * Saved like any document (`PUT /api/officials/:id`, ADR-0029).
 */

function eventRow(db: Db, eventId: string) {
  const row = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, eventId), eq(documents.kind, "event")))
    .get();
  if (!row) throw new HTTPException(404, { message: "Not found." });
  return row;
}

function officialsRow(db: Db, organizationId: string, eventId: string) {
  return db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.kind, "officials"),
      ),
    )
    .all()
    .find((r) => (JSON.parse(r.json) as Officials).eventId === eventId);
}

/** The Event's Officials document as stored, its `updatedAt` and the caller's role; null when it has none. */
export function readOfficials(
  db: Db,
  eventId: string,
  userId: string,
): { officials: Officials | null; updatedAt: number | null; role: Role } {
  const event = eventRow(db, eventId);
  const role = requireRole(db, event.organizationId, userId, "editor");
  const row = officialsRow(db, event.organizationId, eventId);
  return row
    ? {
        officials: JSON.parse(row.json) as Officials,
        updatedAt: row.updatedAt.getTime(),
        role,
      }
    : { officials: null, updatedAt: null, role };
}

/** Creates the Event's Officials document; 409 if it has one (save that instead), 422 if the list is invalid. */
export function createOfficials(
  db: Db,
  {
    eventId,
    officials,
    userId,
    now,
  }: { eventId: string; officials: unknown; userId: string; now: Date },
): { id: string; updatedAt: number } {
  return db.transaction(() => {
    const event = eventRow(db, eventId);
    requireRole(db, event.organizationId, userId, "editor");
    if (officialsRow(db, event.organizationId, eventId)) {
      throw new HTTPException(409, {
        message: "This Event already has Officials. Reload to see them.",
      });
    }
    const id = newUuid7(now);
    const doc = {
      schemaVersion: SCHEMA_VERSION,
      id,
      kind: "officials",
      slug: `${event.slug}-officials`,
      title: `${event.title} Officials`,
      eventId,
      officials,
    };
    const issues = officialsIssues(db, id, doc);
    if (issues.length > 0) {
      throw new HTTPException(422, { message: issues.join("\n") });
    }
    db.insert(documents)
      .values({
        id,
        kind: "officials",
        organizationId: event.organizationId,
        slug: doc.slug,
        title: doc.title,
        json: JSON.stringify(doc),
        updatedAt: now,
        createdAt: now,
      })
      .run();
    audit(db, {
      at: now,
      userId,
      organizationId: event.organizationId,
      action: "officials.create",
      documentKind: "officials",
      documentId: id,
      detail: { eventId },
    });
    return { id, updatedAt: now.getTime() };
  });
}
