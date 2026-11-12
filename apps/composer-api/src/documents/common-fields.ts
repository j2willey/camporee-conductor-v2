import {
  SCHEMA_VERSION,
  type CommonFieldSet,
  type Event,
} from "@camporee-conductor/schema";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { documents, type Role } from "../db/schema.ts";
import {
  newUuid7,
  openEvent,
  slugify,
  type Change,
} from "./event-activities.ts";
import {
  audit,
  commonFieldSetIssues,
  eventIssues,
  writeDocument,
} from "./save.ts";

/**
 * The Event's Common Field set (ADR-0020, #99): the one its Competitions use. A cartridge holds one set per Event,
 * and `checkEventBundle` refuses Competitions on different sets, so the first Competition that uses one names it.
 */
const setIdOf = (event: Event): string | undefined =>
  event.competitions.find((c) => c.commonFields)?.commonFields?.setId;

/** The Event's set as stored, its `updatedAt` and the caller's role; `set: null` when it has none. 404 like reading the Event. */
export function readCommonFields(
  db: Db,
  eventId: string,
  userId: string,
): { set: CommonFieldSet | null; updatedAt: number | null; role: Role } {
  const eventRow = db
    .select()
    .from(documents)
    .where(and(eq(documents.id, eventId), eq(documents.kind, "event")))
    .get();
  if (!eventRow) throw new HTTPException(404, { message: "Not found." });
  const role = requireRole(db, eventRow.organizationId, userId, "viewer");
  const setId = setIdOf(JSON.parse(eventRow.json) as Event);
  const row =
    setId === undefined
      ? undefined
      : db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.id, setId),
              eq(documents.kind, "common-field-set"),
              eq(documents.organizationId, eventRow.organizationId),
            ),
          )
          .get();
  return row
    ? {
        set: JSON.parse(row.json) as CommonFieldSet,
        updatedAt: row.updatedAt.getTime(),
        role,
      }
    : { set: null, updatedAt: null, role };
}

/**
 * Creates the Event's set from `fields` when it has none, and links every Competition to it with nothing picked
 * yet (`before` and `after` empty), so the Event names its set. One transaction with the Event's If-Match:
 * 409 if the Event already has a set, 400 if it has no Competitions, 422 if the fields are invalid.
 */
export function createCommonFields(
  db: Db,
  change: Change & { fields: unknown },
): { setId: string; updatedAt: number } {
  return db.transaction(() => {
    const { opened, event } = openEvent(db, change);
    if (setIdOf(event) !== undefined) {
      throw new HTTPException(409, {
        message: "This Event already has Common Fields. Reload to see them.",
      });
    }
    if (event.competitions.length === 0) {
      throw new HTTPException(400, {
        message: "Add a Competition before its Common Fields.",
      });
    }
    const setId = newUuid7(change.now);
    const set = {
      schemaVersion: SCHEMA_VERSION,
      id: setId,
      kind: "common-field-set",
      slug: freeSlug(
        db,
        opened.organizationId,
        `${slugify(event.slug)}-common-fields`,
      ),
      title: `${event.title} Common Fields`,
      fields: change.fields,
    };
    const setIssues = commonFieldSetIssues(
      db,
      opened.organizationId,
      setId,
      set,
    );
    if (setIssues.length > 0) {
      throw new HTTPException(422, { message: setIssues.join("\n") });
    }
    db.insert(documents)
      .values({
        id: setId,
        kind: "common-field-set",
        organizationId: opened.organizationId,
        slug: set.slug,
        title: set.title,
        json: JSON.stringify(set),
        updatedAt: change.now,
      })
      .run();
    audit(db, {
      at: change.now,
      userId: change.userId,
      organizationId: opened.organizationId,
      action: "common-field-set.create",
      documentKind: "common-field-set",
      documentId: setId,
      detail: { eventId: change.eventId },
    });
    const linked: Event = {
      ...event,
      competitions: event.competitions.map((c) => ({
        ...c,
        commonFields: { setId, before: [], after: [] },
      })),
    };
    const issues = eventIssues(db, opened.organizationId, linked);
    if (issues.length > 0) {
      throw new HTTPException(422, { message: issues.join("\n") });
    }
    const updatedAt = writeDocument(db, {
      ...opened,
      kind: "event",
      id: change.eventId,
      raw: linked,
      userId: change.userId,
      now: change.now,
      action: "event.update",
      detail: { commonFieldSetId: setId, change: "create" },
    });
    return { setId, updatedAt };
  });
}

/** `base`, or `base-2`, `base-3`…: the first no other Common Field set in the Organization has. */
function freeSlug(db: Db, organizationId: string, base: string): string {
  const taken = new Set(
    db
      .select({ slug: documents.slug })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.kind, "common-field-set"),
        ),
      )
      .all()
      .map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}
