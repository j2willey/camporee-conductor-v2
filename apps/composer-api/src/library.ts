import { stripPersonalData } from "@camporee-conductor/cartridge";
import type { Event } from "@camporee-conductor/schema";
import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "./authz.ts";
import type { Db } from "./db/open.ts";
import { auditLog, documents, users, type DocumentKind } from "./db/schema.ts";

/**
 * The library (ADR-0031, #102 PR 1): Templates and Activities everyone signed in can see and use. Whether a
 * document is in it is the `visibility` column, never document content. Only curators publish and unpublish.
 */

/** Sets or clears a user's curator flag (the sysadmin's tool until #104). False if no user has that email. */
export function setCurator(db: Db, email: string, curator: boolean): boolean {
  const updated = db
    .update(users)
    .set({ curator })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning({ id: users.id })
    .all();
  return updated.length > 0;
}

export function isCurator(db: Db, userId: string): boolean {
  return (
    db
      .select({ curator: users.curator })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.curator ?? false
  );
}

type Change = { id: string; userId: string; now: Date };

/**
 * Puts a Template (with its Activities and Common Field set) or an Activity in the library. Curators only, and
 * only for an Organization they edit, so publishing never exposes another Organization's work. Every document is
 * checked for personal data first (ADR-0031 rule 4). Returns the ids published.
 */
export function publish(db: Db, change: Change): { published: string[] } {
  return db.transaction(() => {
    const doc = requireLibraryKind(db, change.id);
    requireCurator(db, change.userId);
    requireRole(db, doc.organizationId, change.userId, "editor");
    const ids = withParts(db, doc);
    for (const row of rowsOf(db, doc.organizationId, ids)) {
      const problem = personalDataIn(row.kind, row.slug, row.json);
      if (problem) throw new HTTPException(422, { message: problem });
    }
    setVisibility(db, doc.organizationId, ids, "library");
    record(db, change, doc, "library.publish", ids);
    return { published: ids };
  });
}

/** Takes a document (and a Template's parts) out of the library. Any curator: they look after the whole library. */
export function unpublish(db: Db, change: Change): { unpublished: string[] } {
  return db.transaction(() => {
    const doc = requireLibraryKind(db, change.id);
    requireCurator(db, change.userId);
    const ids = withParts(db, doc);
    setVisibility(db, doc.organizationId, ids, "private");
    record(db, change, doc, "library.unpublish", ids);
    return { unpublished: ids };
  });
}

type Row = typeof documents.$inferSelect;

function requireLibraryKind(db: Db, id: string): Row {
  const doc = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!doc) throw new HTTPException(404, { message: "Not found." });
  if (doc.kind !== "template" && doc.kind !== "activity") {
    throw new HTTPException(400, {
      message: "Only Templates and Activities go in the library.",
    });
  }
  return doc;
}

function requireCurator(db: Db, userId: string): void {
  if (!isCurator(db, userId)) {
    throw new HTTPException(403, {
      message: "Only a curator can publish to the library.",
    });
  }
}

/** The document's id, and for a Template the Activities and Common Field sets it lists (in its Organization). */
function withParts(db: Db, doc: Row): string[] {
  if (doc.kind !== "template") return [doc.id];
  const template = JSON.parse(doc.json) as Pick<
    Event,
    "activities" | "competitions"
  >;
  const parts = [
    ...template.activities.map((a) => a.activityId),
    ...template.competitions.flatMap((c) =>
      c.commonFields ? [c.commonFields.setId] : [],
    ),
  ];
  const found = new Set(rowsOf(db, doc.organizationId, parts).map((r) => r.id));
  return [doc.id, ...new Set(parts.filter((id) => found.has(id)))];
}

function rowsOf(db: Db, organizationId: string, ids: string[]): Row[] {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        inArray(documents.id, ids),
      ),
    )
    .all();
}

/**
 * Why a document can't go in the library, or null: an Officials document never can, and anything
 * `stripPersonalData` would change holds personal data (ADR-0031 rule 4, the one stripping function).
 */
function personalDataIn(
  kind: DocumentKind,
  slug: string,
  json: string,
): string | null {
  if (kind === "officials") {
    return `officials ${slug}: Officials never go in the library.`;
  }
  if (kind !== "template") return null;
  const doc = JSON.parse(json) as Record<string, unknown>;
  const stripped = stripPersonalData({
    event: doc,
    activities: [],
    commonFieldSets: [],
  }).event as Record<string, unknown>;
  const removed = Object.keys(doc).filter((key) => !(key in stripped));
  return removed.length > 0
    ? `template ${slug} holds personal data (${removed.join(", ")}): it can't go in the library.`
    : null;
}

function setVisibility(
  db: Db,
  organizationId: string,
  ids: string[],
  visibility: "private" | "library",
): void {
  db.update(documents)
    .set({ visibility })
    .where(
      and(
        eq(documents.organizationId, organizationId),
        inArray(documents.id, ids),
      ),
    )
    .run();
}

function record(
  db: Db,
  change: Change,
  doc: Row,
  action: string,
  ids: string[],
): void {
  db.insert(auditLog)
    .values({
      at: change.now,
      userId: change.userId,
      organizationId: doc.organizationId,
      action,
      documentKind: doc.kind,
      documentId: doc.id,
      detail: { ids },
    })
    .run();
}
