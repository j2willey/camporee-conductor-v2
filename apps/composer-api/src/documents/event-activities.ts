import { randomBytes } from "node:crypto";
import {
  SCHEMA_VERSION,
  type Activity,
  type Event,
} from "@camporee-conductor/schema";
import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "../db/open.ts";
import { documents } from "../db/schema.ts";
import {
  activityIssues,
  audit,
  eventIssues,
  openForEdit,
  writeDocument,
  type Opened,
} from "./save.ts";

/**
 * Adding, duplicating and removing an Event's Activities (ADR-0029, #6 PR 2b). Each is one transaction that
 * changes the Activity document and the Event's list together, with the Event's If-Match. Reordering, moving
 * and the enable switch need no route of their own: they're an Event save.
 */

export type Change = {
  eventId: string;
  userId: string;
  ifMatch: string | undefined;
  now: Date;
};

/** Text a new Activity starts with, so it passes the schema until someone writes the real thing (#6). */
export const PLACEHOLDER = "To be written.";

/** A new, valid Activity for `competitionId`, last in its list. Returns its id and the Event's new `updatedAt`. */
export function addActivity(
  db: Db,
  change: Change & { competitionId: string; title: string },
): { activityId: string; updatedAt: number } {
  return db.transaction(() => {
    const { opened, event } = openEvent(db, change);
    if (!event.competitions.some((c) => c.id === change.competitionId)) {
      throw new HTTPException(400, {
        message: "The Event has no Competition with that id.",
      });
    }
    const activityId = newUuid7(change.now);
    const activity: Activity = {
      schemaVersion: SCHEMA_VERSION,
      id: activityId,
      kind: "activity",
      slug: freeSlug(db, opened.organizationId, slugify(change.title)),
      title: change.title,
      scoringType: scoringTypeFor(db, event, change.competitionId),
      content: {
        story: PLACEHOLDER,
        objective: PLACEHOLDER,
        description: PLACEHOLDER,
        rules: [],
        timeAndScoring: PLACEHOLDER,
        setup: "",
        reset: "",
        staffing: "",
        supplies: [],
        notes: "",
      },
      scoring: {
        fields: [
          {
            id: "points",
            label: "Points",
            type: "number",
            kind: "points",
            audience: "judge",
            sortOrder: 0,
            weight: 1,
          },
        ],
      },
    };
    insertActivity(db, opened, activity, change, null);
    const updatedAt = saveEvent(
      db,
      opened,
      change,
      {
        ...event,
        activities: [
          ...event.activities,
          {
            activityId,
            competitionId: change.competitionId,
            sortOrder: nextSortOrder(event),
          },
        ],
      },
      { activityId, change: "add" },
    );
    return { activityId, updatedAt };
  });
}

/**
 * A copy of one of the Event's Activities, listed right after it in the same Competition. The copy names its
 * source in `lineage.parentId` (ADR-0017) and drops `legacy`, whose v1 ids belong to the original only.
 */
export function duplicateActivity(
  db: Db,
  change: Change & { activityId: string },
): { activityId: string; updatedAt: number } {
  return db.transaction(() => {
    const { opened, event } = openEvent(db, change);
    const entry = listedEntry(event, change.activityId);
    const source = readActivity(db, opened.organizationId, change.activityId);
    const activityId = newUuid7(change.now);
    const copy: Activity = {
      ...source,
      id: activityId,
      slug: freeSlug(db, opened.organizationId, `${source.slug}-copy`),
      title: `${source.title} (copy)`,
      lineage: { ...source.lineage, parentId: source.id },
    };
    delete copy.legacy;
    insertActivity(db, opened, copy, change, { parentId: source.id });
    // Make room right after the source: later entries move down one, so everyone else keeps their place.
    const after = entry.sortOrder + 1;
    const activities = event.activities.map((a) =>
      a.sortOrder >= after ? { ...a, sortOrder: a.sortOrder + 1 } : a,
    );
    activities.push({
      ...entry,
      activityId,
      sortOrder: after,
    });
    const updatedAt = saveEvent(
      db,
      opened,
      change,
      { ...event, activities },
      {
        activityId,
        change: "duplicate",
        parentId: source.id,
      },
    );
    return { activityId, updatedAt };
  });
}

/**
 * Takes an Activity off the Event. Its document is deleted too, unless another Event or Template in the
 * Organization still lists it. `deleted` says which.
 */
export function removeActivity(
  db: Db,
  change: Change & { activityId: string },
): { updatedAt: number; deleted: boolean } {
  return db.transaction(() => {
    const { opened, event } = openEvent(db, change);
    listedEntry(event, change.activityId);
    const updated: Event = {
      ...event,
      activities: event.activities.filter(
        (a) => a.activityId !== change.activityId,
      ),
    };
    const listedElsewhere = db
      .select({ id: documents.id, json: documents.json })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, opened.organizationId),
          inArray(documents.kind, ["event", "template"]),
        ),
      )
      .all()
      .some(
        (row) =>
          row.id !== change.eventId &&
          (JSON.parse(row.json) as Event).activities.some(
            (a) => a.activityId === change.activityId,
          ),
      );
    if (!listedElsewhere) {
      db.delete(documents).where(eq(documents.id, change.activityId)).run();
      audit(db, {
        at: change.now,
        userId: change.userId,
        organizationId: opened.organizationId,
        action: "activity.delete",
        documentKind: "activity",
        documentId: change.activityId,
        detail: { eventId: change.eventId },
      });
    }
    const updatedAt = saveEvent(db, opened, change, updated, {
      activityId: change.activityId,
      change: "remove",
    });
    return { updatedAt, deleted: !listedElsewhere };
  });
}

export function openEvent(
  db: Db,
  change: Change,
): { opened: Opened; event: Event } {
  const opened = openForEdit(db, {
    kind: "event",
    id: change.eventId,
    userId: change.userId,
    ifMatch: change.ifMatch,
  });
  const row = db
    .select({ json: documents.json })
    .from(documents)
    .where(eq(documents.id, change.eventId))
    .get();
  // Validated on import and on every save (ADR-0012, ADR-0029); stored exactly as given.
  return { opened, event: JSON.parse(row?.json ?? "null") as Event };
}

function listedEntry(event: Event, activityId: string) {
  const entry = event.activities.find((a) => a.activityId === activityId);
  if (!entry) throw new HTTPException(404, { message: "Not found." });
  return entry;
}

function readActivity(
  db: Db,
  organizationId: string,
  activityId: string,
): Activity {
  const row = db
    .select({ json: documents.json })
    .from(documents)
    .where(
      and(
        eq(documents.id, activityId),
        eq(documents.kind, "activity"),
        eq(documents.organizationId, organizationId),
      ),
    )
    .get();
  if (!row) throw new HTTPException(404, { message: "Not found." });
  return JSON.parse(row.json) as Activity;
}

function insertActivity(
  db: Db,
  opened: Opened,
  activity: Activity,
  change: Change,
  detail: Record<string, unknown> | null,
): void {
  const issues = activityIssues(
    db,
    opened.organizationId,
    activity.id,
    activity,
  );
  if (issues.length > 0) {
    throw new HTTPException(422, { message: issues.join("\n") });
  }
  db.insert(documents)
    .values({
      id: activity.id,
      kind: "activity",
      organizationId: opened.organizationId,
      slug: activity.slug,
      title: activity.title,
      json: JSON.stringify(activity),
      updatedAt: change.now,
    })
    .run();
  audit(db, {
    at: change.now,
    userId: change.userId,
    organizationId: opened.organizationId,
    action: "activity.create",
    documentKind: "activity",
    documentId: activity.id,
    detail: { eventId: change.eventId, ...detail },
  });
}

/** Checks the changed Event like any save (the new Activity is already stored), then writes it. */
function saveEvent(
  db: Db,
  opened: Opened,
  change: Change,
  event: Event,
  detail: Record<string, unknown>,
): number {
  const issues = eventIssues(db, opened.organizationId, event);
  if (issues.length > 0) {
    throw new HTTPException(422, { message: issues.join("\n") });
  }
  return writeDocument(db, {
    ...opened,
    kind: "event",
    id: change.eventId,
    raw: event,
    userId: change.userId,
    now: change.now,
    action: "event.update",
    detail,
  });
}

const nextSortOrder = (event: Event) =>
  Math.max(0, ...event.activities.map((a) => a.sortOrder)) + 1;

/** The scoring type most of the Competition's Activities have; `ranked` for an empty Competition. */
function scoringTypeFor(
  db: Db,
  event: Event,
  competitionId: string,
): Activity["scoringType"] {
  const ids = event.activities
    .filter((a) => a.competitionId === competitionId)
    .map((a) => a.activityId);
  if (ids.length === 0) return "ranked";
  const types = db
    .select({ json: documents.json })
    .from(documents)
    .where(inArray(documents.id, ids))
    .all()
    .map((r) => (JSON.parse(r.json) as Activity).scoringType);
  const exhibitions = types.filter((t) => t === "exhibition").length;
  return exhibitions > types.length / 2 ? "exhibition" : "ranked";
}

/** "Clown Car!" → "clown-car"; nothing usable → "activity". */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "activity";
}

/** `base`, or `base-2`, `base-3`… : the first no other Activity in the Organization has. */
function freeSlug(db: Db, organizationId: string, base: string): string {
  const taken = new Set(
    db
      .select({ slug: documents.slug })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, organizationId),
          eq(documents.kind, "activity"),
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

/** A random UUID v7 (RFC 9562): 48 bits of ms time, then random bits. */
export function newUuid7(now: Date): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now.getTime(), 0, 6);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6); // version 7
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // RFC 9562 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
