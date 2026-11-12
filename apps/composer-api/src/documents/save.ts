import { checkEventBundle } from "@camporee-conductor/cartridge";
import { ActivitySchema, EventSchema } from "@camporee-conductor/schema";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { auditLog, documents } from "../db/schema.ts";
import { eventBundleFor } from "../export/read-event-documents.ts";

/** The document kinds the Composer saves so far (ADR-0029; more come with #99 and #100). */
export type SavableKind = "event" | "activity";

/**
 * Saves a whole document (ADR-0029): checks the caller's role, `If-Match` against the stored `updatedAt`, the
 * id and kind against the path, and the same rules as import (`checkEventBundle`). Stores the document
 * exactly as sent (ADR-0012), keeps `slug` and `title` in step, and writes one audit row. All in one
 * transaction, so a refused save changes nothing. Returns the new `updatedAt` in ms.
 */
export function saveDocument(
  db: Db,
  {
    kind,
    id,
    raw,
    userId,
    ifMatch,
    now,
  }: {
    kind: SavableKind;
    id: string;
    raw: unknown;
    userId: string;
    ifMatch: string | undefined;
    now: Date;
  },
): number {
  return db.transaction(() => {
    const row = db
      .select({
        organizationId: documents.organizationId,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(eq(documents.id, id), eq(documents.kind, kind)))
      .get();
    if (!row) throw new HTTPException(404, { message: "Not found." });
    requireRole(db, row.organizationId, userId, "editor");

    const expected = parseIfMatch(ifMatch);
    if (expected === undefined) {
      throw new HTTPException(428, {
        message: "Send If-Match with the updatedAt you last read.",
      });
    }
    const stored = row.updatedAt.getTime();
    if (expected !== stored) {
      throw new HTTPException(409, {
        message:
          "Someone else saved this since you opened it. Reload to see their changes.",
      });
    }

    const doc = asRecord(raw);
    if (doc?.["id"] !== id || doc["kind"] !== kind) {
      throw new HTTPException(400, {
        message: `The body must be the ${kind} ${id}: its id and kind must match.`,
      });
    }
    const issues =
      kind === "event"
        ? eventIssues(db, row.organizationId, raw)
        : activityIssues(db, row.organizationId, id, raw);
    if (issues.length > 0) {
      throw new HTTPException(422, { message: issues.join("\n") });
    }

    // Always forward, even for two saves in the same millisecond, so If-Match never matches a stale read.
    const updatedAt = Math.max(now.getTime(), stored + 1);
    db.update(documents)
      .set({
        json: JSON.stringify(raw),
        slug: String(doc["slug"]),
        title: String(doc["title"]),
        updatedAt: new Date(updatedAt),
      })
      .where(eq(documents.id, id))
      .run();
    db.insert(auditLog)
      .values({
        at: new Date(updatedAt),
        userId,
        organizationId: row.organizationId,
        action: `${kind}.update`,
        documentKind: kind,
        documentId: id,
        detail: null,
      })
      .run();
    return updatedAt;
  });
}

/** `123`, `"123"` or `W/"123"` → 123; anything else → undefined. */
function parseIfMatch(header: string | undefined): number | undefined {
  const match = header?.trim().match(/^(?:W\/)?"?(\d+)"?$/);
  return match ? Number(match[1]) : undefined;
}

function asRecord(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

/** "kind slug: path: message", the same lines as `checkEventBundle`. */
function schemaIssues(
  kind: string,
  raw: unknown,
  result: {
    success: boolean;
    error?: { issues: { path: PropertyKey[]; message: string }[] };
  },
): string[] {
  if (result.success || !result.error) return [];
  const slug = asRecord(raw)?.["slug"];
  const name = typeof slug === "string" && slug ? slug : kind;
  return result.error.issues.map(
    (issue) =>
      `${kind} ${name}: ${issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ` : ""}${issue.message}`,
  );
}

/** The Event against the Organization's documents it references. */
function eventIssues(db: Db, organizationId: string, raw: unknown): string[] {
  const parsed = EventSchema.safeParse(raw);
  // The bundle needs the Event's lists, so a malformed Event is reported on its own first.
  if (!parsed.success) return schemaIssues("event", raw, parsed);
  const check = checkEventBundle(eventBundleFor(db, organizationId, raw));
  return check.ok ? [] : check.issues;
}

/** The Activity on its own, then against every Event in the Organization that lists it. */
function activityIssues(
  db: Db,
  organizationId: string,
  id: string,
  raw: unknown,
): string[] {
  const parsed = ActivitySchema.safeParse(raw);
  if (!parsed.success) return schemaIssues("activity", raw, parsed);
  const issues: string[] = [];
  const events = db
    .select({ json: documents.json })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.kind, "event"),
      ),
    )
    .all()
    .map((r) => JSON.parse(r.json) as { activities: { activityId: string }[] })
    .filter((event) => event.activities.some((a) => a.activityId === id));
  for (const event of events) {
    const bundle = eventBundleFor(db, organizationId, event);
    bundle.activities = bundle.activities.map((a) =>
      asRecord(a)?.["id"] === id ? raw : a,
    );
    const check = checkEventBundle(bundle);
    if (!check.ok) issues.push(...check.issues);
  }
  return [...new Set(issues)];
}
