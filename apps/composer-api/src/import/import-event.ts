import {
  checkEventBundle,
  type EventBundle,
} from "@camporee-conductor/cartridge";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/open.ts";
import { documents, organizations, type DocumentKind } from "../db/schema.ts";

export type { EventBundle };

/** The bundle can't be imported; `issues` says why, one line per problem. */
export class ImportError extends Error {
  override name = "ImportError";
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`import refused:\n${issues.join("\n")}`);
    this.issues = issues;
  }
}

export interface ImportResult {
  eventId: string;
  created: number;
  updated: number;
}

interface Parsed {
  kind: DocumentKind;
  id: string;
  slug: string;
  title: string;
  /** The document as given, not Zod's output, so no defaults are added (ADR-0012). */
  json: string;
}

/**
 * Validates an Event bundle with `packages/schema` and upserts its documents into an Organization in one
 * transaction: all or nothing. Documents are matched by id, so importing again updates them.
 */
export function importEvent(
  db: Db,
  organizationId: string,
  bundle: EventBundle,
  now = new Date(),
): ImportResult {
  const check = checkEventBundle(bundle);
  if (!check.ok) throw new ImportError(check.issues);
  // Stored exactly as given (ADR-0012); the parsed copy is only for the indexed columns.
  const stored = (
    kind: DocumentKind,
    raw: unknown,
    doc: { id: string; slug: string; title: string },
  ): Parsed => ({
    kind,
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    json: JSON.stringify(raw),
  });
  const { event } = check.bundle;
  const docs: Parsed[] = [
    stored("event", bundle.event, event),
    ...check.bundle.commonFieldSets.map((set, i) =>
      stored("common-field-set", bundle.commonFieldSets[i], set),
    ),
    ...check.bundle.activities.map((activity, i) =>
      stored("activity", bundle.activities[i], activity),
    ),
  ];
  return db.transaction((tx) => {
    const org = tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .get();
    if (!org) throw new ImportError([`no Organization ${organizationId}`]);

    const existing = new Map(
      tx
        .select({ id: documents.id, organizationId: documents.organizationId })
        .from(documents)
        .where(
          inArray(
            documents.id,
            docs.map((d) => d.id),
          ),
        )
        .all()
        .map((row) => [row.id, row.organizationId]),
    );
    const foreign = docs.filter((d) => {
      const owner = existing.get(d.id);
      return owner !== undefined && owner !== organizationId;
    });
    if (foreign.length > 0) {
      throw new ImportError(
        foreign.map(
          (d) => `${d.kind} ${d.slug}: ${d.id} belongs to another Organization`,
        ),
      );
    }

    for (const d of docs) {
      const values = {
        kind: d.kind,
        slug: d.slug,
        title: d.title,
        json: d.json,
        updatedAt: now,
      };
      tx.insert(documents)
        .values({ id: d.id, organizationId, ...values })
        .onConflictDoUpdate({ target: documents.id, set: values })
        .run();
    }
    const updated = docs.filter((d) => existing.has(d.id)).length;
    return {
      eventId: event.id,
      created: docs.length - updated,
      updated,
    };
  });
}
