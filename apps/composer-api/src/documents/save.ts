import {
  checkEventBundle,
  checkTemplateBundle,
} from "@camporee-conductor/cartridge";
import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
  OfficialsSchema,
  TemplateSchema,
} from "@camporee-conductor/schema";
import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { proposalIssues } from "../ai/allowed-changes.ts";
import { requireDocumentEditor } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { auditLog, documents } from "../db/schema.ts";
import { eventBundleFor } from "../export/read-event-documents.ts";

/** The document kinds the Composer saves (ADR-0029). */
export type SavableKind =
  "event" | "template" | "activity" | "common-field-set" | "officials";

/** An Event-shaped document (ADR-0017): the Event editor opens both (ADR-0031 item 6, #102 PR 5). */
export type DesignKind = "event" | "template";

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
    ai,
  }: {
    kind: SavableKind;
    id: string;
    raw: unknown;
    userId: string;
    ifMatch: string | undefined;
    now: Date;
    /** An AI proposal being accepted (ADR-0030 item 3): checked by the structural diff first, and audited as AI. */
    ai?: { feature: string };
  },
): number {
  return db.transaction(() => {
    const opened = openForEdit(db, { kind, id, userId, ifMatch });
    if (ai) {
      const current = db
        .select({ json: documents.json })
        .from(documents)
        .where(eq(documents.id, id))
        .get();
      const refused = proposalIssues(
        kind === "activity" ? "activity" : "event",
        JSON.parse(current?.json ?? "null"),
        raw,
      );
      if (refused.length > 0) {
        throw new HTTPException(422, { message: refused.join("\n") });
      }
    }
    // The Event routes save a Template too; a save never changes a document's kind.
    const stored = opened.kind;
    const doc = asRecord(raw);
    if (doc?.["id"] !== id || doc["kind"] !== stored) {
      throw new HTTPException(400, {
        message: `The body must be the ${stored} ${id}: its id and kind must match.`,
      });
    }
    const issues =
      stored === "event" || stored === "template"
        ? eventIssues(db, opened.organizationId, raw, stored)
        : kind === "activity"
          ? activityIssues(db, opened.organizationId, id, raw)
          : kind === "common-field-set"
            ? commonFieldSetIssues(db, opened.organizationId, id, raw)
            : officialsIssues(db, id, raw);
    if (issues.length > 0) {
      throw new HTTPException(422, { message: issues.join("\n") });
    }
    return writeDocument(db, {
      ...opened,
      kind: stored,
      id,
      raw,
      userId,
      now,
      action: `${stored}.update`,
      ...(ai && { detail: { ai: ai.feature } }),
    });
  });
}

/** A stored document, opened for a change: its Organization and the `updatedAt` the change replaces. */
export interface Opened {
  organizationId: string;
  stored: number;
  /** The stored kind: `template` when the Event routes opened a Template. */
  kind: SavableKind;
  /** New parts of a library Template go in the library with it (ADR-0031 notes, #102 PR 5). */
  visibility: "private" | "library";
}

/**
 * The first steps of every change (ADR-0029): 404 if there's no such document, 403/404 below editor (`documentRole`:
 * curators for a library document), 428 without If-Match, 409 if it's stale. `event` opens a Template too.
 * Call inside the change's transaction.
 */
export function openForEdit(
  db: Db,
  {
    kind,
    id,
    userId,
    ifMatch,
  }: {
    kind: SavableKind;
    id: string;
    userId: string;
    ifMatch: string | undefined;
  },
): Opened {
  const row = db
    .select({
      kind: documents.kind,
      organizationId: documents.organizationId,
      visibility: documents.visibility,
      updatedAt: documents.updatedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.id, id),
        inArray(documents.kind, kind === "event" ? DESIGN_KINDS : [kind]),
      ),
    )
    .get();
  if (!row) throw new HTTPException(404, { message: "Not found." });
  requireDocumentEditor(db, row, userId);

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
  return {
    organizationId: row.organizationId,
    stored,
    kind: row.kind as SavableKind,
    visibility: row.visibility,
  };
}

export const DESIGN_KINDS: DesignKind[] = ["event", "template"];

/**
 * Stores a checked document exactly as given (ADR-0012), keeps `slug` and `title` in step, and writes one audit
 * row. Returns the new `updatedAt` in ms.
 */
export function writeDocument(
  db: Db,
  {
    kind,
    id,
    raw,
    organizationId,
    stored,
    userId,
    now,
    action,
    detail = null,
  }: Omit<Opened, "kind" | "visibility"> & {
    kind: SavableKind;
    id: string;
    raw: unknown;
    userId: string;
    now: Date;
    action: string;
    detail?: Record<string, unknown> | null;
  },
): number {
  const doc = asRecord(raw) ?? {};
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
  audit(db, {
    at: new Date(updatedAt),
    userId,
    organizationId,
    action,
    documentKind: kind,
    documentId: id,
    detail,
  });
  return updatedAt;
}

/** One audit row (ADR-0029 item 5): never a document body. */
export function audit(db: Db, row: typeof auditLog.$inferInsert): void {
  db.insert(auditLog).values(row).run();
}

/** `123`, `"123"` or `W/"123"` → 123; anything else → undefined. */
function parseIfMatch(header: string | undefined): number | undefined {
  const match = header?.trim().match(/^(?:W\/)?"?(\d+)"?$/);
  return match ? Number(match[1]) : undefined;
}

export function asRecord(raw: unknown): Record<string, unknown> | undefined {
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

/** The Event or Template against the Organization's documents it references. */
export function eventIssues(
  db: Db,
  organizationId: string,
  raw: unknown,
  kind: DesignKind = "event",
): string[] {
  const parsed = (kind === "event" ? EventSchema : TemplateSchema).safeParse(
    raw,
  );
  // The bundle needs the Event's lists, so a malformed Event is reported on its own first.
  if (!parsed.success) return schemaIssues(kind, raw, parsed);
  return bundleIssues(kind, eventBundleFor(db, organizationId, raw));
}

/** The bundle checked by its main document's rules; a Template never has Officials. */
function bundleIssues(
  kind: DesignKind,
  bundle: ReturnType<typeof eventBundleFor>,
): string[] {
  if (kind === "template") delete bundle.officials;
  const check =
    kind === "event" ? checkEventBundle(bundle) : checkTemplateBundle(bundle);
  return check.ok ? [] : check.issues;
}

/** The Events and Templates in the Organization (ADR-0031 notes, #102 PR 5), parsed, with their kind. */
function designsIn(db: Db, organizationId: string) {
  return db
    .select({ kind: documents.kind, json: documents.json })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        inArray(documents.kind, DESIGN_KINDS),
      ),
    )
    .all()
    .map((r) => ({
      kind: r.kind as DesignKind,
      // Validated on import and on every save (ADR-0012, ADR-0029).
      doc: JSON.parse(r.json) as {
        activities: { activityId: string }[];
        competitions: { commonFields?: { setId: string } }[];
      },
    }));
}

/** The Activity on its own, then against every Event and Template in the Organization that lists it. */
export function activityIssues(
  db: Db,
  organizationId: string,
  id: string,
  raw: unknown,
): string[] {
  const parsed = ActivitySchema.safeParse(raw);
  if (!parsed.success) return schemaIssues("activity", raw, parsed);
  const issues: string[] = [];
  const listing = designsIn(db, organizationId).filter(({ doc }) =>
    doc.activities.some((a) => a.activityId === id),
  );
  for (const { kind, doc } of listing) {
    const bundle = eventBundleFor(db, organizationId, doc);
    bundle.activities = bundle.activities.map((a) =>
      asRecord(a)?.["id"] === id ? raw : a,
    );
    issues.push(...bundleIssues(kind, bundle));
  }
  return [...new Set(issues)];
}

/** The Common Field set on its own, then against every Event and Template in the Organization whose Competitions use it (#99). */
export function commonFieldSetIssues(
  db: Db,
  organizationId: string,
  id: string,
  raw: unknown,
): string[] {
  const parsed = CommonFieldSetSchema.safeParse(raw);
  if (!parsed.success) return schemaIssues("common-field-set", raw, parsed);
  const issues: string[] = [];
  const using = designsIn(db, organizationId).filter(({ doc }) =>
    doc.competitions.some((c) => c.commonFields?.setId === id),
  );
  for (const { kind, doc } of using) {
    const bundle = eventBundleFor(db, organizationId, doc);
    bundle.commonFieldSets = bundle.commonFieldSets.map((s) =>
      asRecord(s)?.["id"] === id ? raw : s,
    );
    issues.push(...bundleIssues(kind, bundle));
  }
  return [...new Set(issues)];
}

/** The Officials document on its own, and still for the Event it was made for (#100). */
export function officialsIssues(db: Db, id: string, raw: unknown): string[] {
  const parsed = OfficialsSchema.safeParse(raw);
  if (!parsed.success) return schemaIssues("officials", raw, parsed);
  const row = db
    .select({ json: documents.json })
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  const storedEventId = row
    ? (JSON.parse(row.json) as { eventId?: string }).eventId
    : undefined;
  return storedEventId !== undefined && storedEventId !== parsed.data.eventId
    ? [
        `officials ${parsed.data.slug}: eventId: Officials stay with their Event`,
      ]
    : [];
}
