import {
  checkEventBundle,
  checkTemplateBundle,
  stripPersonalData,
  type EventBundle,
} from "@camporee-conductor/cartridge";
import {
  SCHEMA_VERSION,
  type Activity,
  type CommonFieldSet,
  type Event,
  type Template,
} from "@camporee-conductor/schema";
import { and, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { readRole, requireRole } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { documents, type DocumentKind } from "../db/schema.ts";
import {
  readEventDocuments,
  readTemplateDocuments,
} from "../export/read-event-documents.ts";
import { newUuid7, slugify } from "./event-activities.ts";
import { audit } from "./save.ts";

/**
 * New Event and Duplicate Event (ADR-0029, #100 PR 1), and Save Event as Template and New Event from Template
 * (ADR-0031, #102 PR 4). Each makes new documents in one transaction, checked as one bundle like an import, with an
 * audit row for each.
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
    requireFreeSlug(db, organizationId, "event", event.slug);
    insertChecked(
      db,
      organizationId,
      { kind: "event", main: event, activities: [], sets: [] },
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
    requireRole(db, found.organizationId, userId, "editor");
    const source = found.bundle.event as Event;
    return {
      eventId: fork(db, found.bundle, {
        kind: "event",
        organizationId: found.organizationId,
        title: title ?? `${source.title} (copy)`,
        slug,
        slugBase: `${source.slug}-copy`,
        userId,
        now,
      }),
    };
  });
}

/**
 * Save Event as Template (ADR-0031, #102 PR 4): a private Template in the Event's Organization, forked like
 * Duplicate Event after `stripPersonalData` (no contacts, no Officials). Editors and owners. Title and slug are the
 * Event's unless given; a slug another Template has is numbered, or refused if it was given.
 */
export function saveEventAsTemplate(
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
): { templateId: string } {
  return db.transaction(() => {
    const found = readEventDocuments(db, eventId);
    if (!found) throw new HTTPException(404, { message: "Not found." });
    requireRole(db, found.organizationId, userId, "editor");
    const source = found.bundle.event as Event;
    return {
      templateId: fork(db, stripPersonalData(found.bundle), {
        kind: "template",
        organizationId: found.organizationId,
        title: title ?? source.title,
        slug,
        slugBase: source.slug,
        userId,
        now,
      }),
    };
  });
}

/**
 * New Event from Template (ADR-0031 rule 5, #102 PR 4): forks a Template the caller can read (a library one, or
 * their Organization's) into an Organization they edit. Title and slug are the Template's unless given. 404 if the
 * Template can't be read or the Organization isn't theirs; 403 below editor.
 */
export function newEventFromTemplate(
  db: Db,
  {
    templateId,
    organizationId,
    title,
    slug,
    userId,
    now,
  }: Who & {
    templateId: string;
    organizationId: string;
    title?: string | undefined;
    slug?: string | undefined;
  },
): { eventId: string } {
  return db.transaction(() => {
    const found = readTemplateDocuments(db, templateId);
    if (!found) throw new HTTPException(404, { message: "Not found." });
    readRole(db, found.organizationId, userId, found.visibility);
    requireRole(db, organizationId, userId, "editor");
    const source = found.bundle.event as Template;
    return {
      eventId: fork(db, found.bundle, {
        kind: "event",
        organizationId,
        title: title ?? source.title,
        slug,
        slugBase: source.slug,
        userId,
        now,
      }),
    };
  });
}

/**
 * The one fork (ADR-0031 notes, #102 PR 4): copies an Event or Template bundle into `organizationId` as a new Event
 * or Template. New ids for it, every Activity and the Common Field set, each copy naming its source in
 * `lineage.parentId`, without `legacy`; never the Officials. A given slug must be free; otherwise `slugBase`,
 * numbered if taken. Activities keep their slugs. Returns the new document's id.
 */
function fork(
  db: Db,
  bundle: EventBundle,
  target: Who & {
    kind: "event" | "template";
    organizationId: string;
    title: string;
    slug: string | undefined;
    slugBase: string;
  },
): string {
  const { kind, organizationId, title, now } = target;
  // Stored documents passed the same checks on import or save (ADR-0012, ADR-0029).
  const source = bundle.event as Event;
  const activities = bundle.activities as Activity[];
  const sets = bundle.commonFieldSets as CommonFieldSet[];

  if (target.slug !== undefined) {
    requireFreeSlug(db, organizationId, kind, target.slug);
  }
  const slug =
    target.slug ?? freeSlug(db, organizationId, kind, target.slugBase);

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
        `${slug}-common-fields`,
        takenSetSlugs,
      ),
      title: `${title} Common Fields`,
    };
    takenSetSlugs.add(copy.slug);
    delete copy.legacy;
    return copy;
  });
  const id = newUuid7(now);
  const doc = {
    ...source,
    kind,
    id,
    slug,
    title,
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
  delete doc.legacy;
  insertChecked(
    db,
    organizationId,
    { kind, main: doc, activities: activityCopies, sets: setCopies },
    { userId: target.userId, now, detail: { parentId: source.id } },
  );
  return id;
}

/**
 * Checks the new documents as one bundle (422 on a problem: `checkEventBundle`, or `checkTemplateBundle` for a
 * Template), inserts them, and audits each.
 */
function insertChecked(
  db: Db,
  organizationId: string,
  docs: {
    kind: "event" | "template";
    main: unknown;
    activities: Activity[];
    sets: CommonFieldSet[];
  },
  { userId, now, detail }: Who & { detail: Record<string, unknown> },
): void {
  const given = {
    event: docs.main,
    activities: docs.activities,
    commonFieldSets: docs.sets,
  };
  const check =
    docs.kind === "event"
      ? checkEventBundle(given)
      : checkTemplateBundle(given);
  if (!check.ok) {
    throw new HTTPException(422, { message: check.issues.join("\n") });
  }
  const mainId = check.bundle.event.id;
  const partOf = docs.kind === "event" ? "eventId" : "templateId";
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
    { kind: docs.kind, doc: docs.main },
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
        createdAt: now,
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
        kind === docs.kind
          ? Object.keys(detail).length > 0
            ? detail
            : null
          : { [partOf]: mainId, ...(parentId && { parentId }) },
    });
  }
}

/** 409 when another document of `kind` (an Event or a Template) in the Organization has `slug`, naming it. */
function requireFreeSlug(
  db: Db,
  organizationId: string,
  kind: "event" | "template",
  slug: string,
): void {
  const other = db
    .select({ title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.kind, kind),
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
