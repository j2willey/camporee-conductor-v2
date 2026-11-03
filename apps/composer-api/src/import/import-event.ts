import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
} from "@camporee-conductor/schema";
import { eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "../db/open.ts";
import { documents, organizations, type DocumentKind } from "../db/schema.ts";

/** One Event and every document it references, as read from a cartridge (ADR-0012). */
export interface EventBundle {
  event: unknown;
  activities: unknown[];
  commonFieldSets: unknown[];
}

/** The bundle can't be imported; `issues` says why, one line per problem. */
export class ImportError extends Error {
  override name = "ImportError";
  constructor(readonly issues: string[]) {
    super(`import refused:\n${issues.join("\n")}`);
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
  const issues: string[] = [];
  const parse = <S extends z.ZodType>(
    schema: S,
    kind: DocumentKind,
    raw: unknown,
    fallbackName: string,
  ): (Parsed & { data: z.infer<S> }) | undefined => {
    const result = schema.safeParse(raw);
    const name = slugOf(raw) ?? fallbackName;
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push(
          `${kind} ${name}: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
        );
      }
      return undefined;
    }
    const doc = result.data as { id: string; slug: string; title: string };
    return {
      kind,
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      json: JSON.stringify(raw),
      data: result.data,
    };
  };

  const event = parse(EventSchema, "event", bundle.event, "event");
  const activities = bundle.activities.map((raw, i) =>
    parse(ActivitySchema, "activity", raw, `activities[${i}]`),
  );
  const sets = bundle.commonFieldSets.map((raw, i) =>
    parse(
      CommonFieldSetSchema,
      "common-field-set",
      raw,
      `common-field-sets[${i}]`,
    ),
  );

  if (event) {
    // Ids as given, so an invalid Activity isn't also reported as missing.
    const activityIds = new Set(bundle.activities.map(idOf));
    const listed = new Set(event.data.activities.map((a) => a.activityId));
    for (const id of listed) {
      if (!activityIds.has(id)) {
        issues.push(
          `event ${event.slug}: activities: no Activity ${id} in the bundle`,
        );
      }
    }
    for (const activity of activities) {
      if (activity && !listed.has(activity.id)) {
        issues.push(`activity ${activity.slug}: not listed in the Event`);
      }
    }
    const setIds = new Set(bundle.commonFieldSets.map(idOf));
    event.data.competitions.forEach((competition, i) => {
      const setId = competition.commonFields?.setId;
      if (setId && !setIds.has(setId)) {
        issues.push(
          `event ${event.slug}: competitions.${i}.commonFields.setId: no Common Field set ${setId} in the bundle`,
        );
      }
    });
  }
  if (issues.length > 0) throw new ImportError(issues);

  const docs = [event, ...sets, ...activities].filter(
    (d): d is NonNullable<typeof d> => d !== undefined,
  );
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
      eventId: event?.id ?? "",
      created: docs.length - updated,
      updated,
    };
  });
}

const stringProp = (raw: unknown, key: string): string | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
const slugOf = (raw: unknown) => stringProp(raw, "slug");
const idOf = (raw: unknown) => stringProp(raw, "id");
