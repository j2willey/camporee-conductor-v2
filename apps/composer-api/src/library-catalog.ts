import {
  buildActivityGuide,
  buildGuide,
  renderActivityGuidesHtml,
  renderGuideHtml,
} from "@camporee-conductor/program-guide";
import {
  SCHEMA_VERSION,
  type Activity,
  type Event,
} from "@camporee-conductor/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { readRole } from "./authz.ts";
import type { Db } from "./db/open.ts";
import { documents, memberships, organizations } from "./db/schema.ts";
import { DEFAULT_THEME_COLORS } from "./documents/events.ts";

/**
 * The library catalog (ADR-0031, #102 PR 2): what a signed-in user can browse, and previews. The catalog is the
 * library plus the caller's Organizations' own private Templates and saved Activities (ADR-0031 notes).
 */

export const LIBRARY_KINDS = ["template", "activity"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export type CatalogFilter = {
  kind?: LibraryKind | undefined;
  /** Matches the title, slug or a tag, ignoring case. */
  q?: string | undefined;
  /** Matches a tag, ignoring case, surrounding spaces and a leading `#`. */
  tag?: string | undefined;
};

export type CatalogItem = {
  id: string;
  kind: LibraryKind;
  slug: string;
  title: string;
  tags: string[];
  visibility: "private" | "library";
  organization: { id: string; name: string };
  /** The caller is a member of its Organization. */
  mine: boolean;
  /** An Activity's scoring type. */
  scoringType?: "ranked" | "exhibition";
  /** How many Activities a Template lists. */
  activityCount?: number;
  updatedAt: number;
};

/** A tag as the filter compares it: trimmed, lowercased, without a leading `#`. */
export const tagKey = (tag: string): string =>
  tag.trim().toLowerCase().replace(/^#+/, "").trim();

type Row = typeof documents.$inferSelect;

/** The catalog for `userId`, by title. */
export function listCatalog(
  db: Db,
  userId: string,
  filter: CatalogFilter = {},
): CatalogItem[] {
  const mine = db
    .select({ id: memberships.organizationId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .all()
    .map((m) => m.id);
  const kinds = filter.kind ? [filter.kind] : [...LIBRARY_KINDS];
  const rows = db
    .select()
    .from(documents)
    .where(
      and(
        inArray(documents.kind, kinds),
        mine.length > 0
          ? or(
              eq(documents.visibility, "library"),
              inArray(documents.organizationId, mine),
            )
          : eq(documents.visibility, "library"),
      ),
    )
    .all();

  // Activities an Event or Template in one of my Organizations lists: they aren't saved for reuse.
  const listed = listedActivityIds(db, mine);
  const names = organizationNames(db, rows);
  const myOrgs = new Set(mine);
  const q = filter.q?.trim().toLowerCase() ?? "";
  const tag = filter.tag === undefined ? "" : tagKey(filter.tag);

  return rows
    .filter(
      (row) =>
        row.visibility === "library" ||
        row.kind === "template" ||
        !listed.has(row.id),
    )
    .map((row) => toItem(row, names, myOrgs))
    .filter(
      (item) =>
        (tag === "" || item.tags.some((t) => tagKey(t) === tag)) &&
        (q === "" ||
          [item.title, item.slug, ...item.tags].some((text) =>
            text.toLowerCase().includes(q),
          )),
    )
    .sort(
      (a, b) =>
        a.title.localeCompare(b.title, "en", { sensitivity: "base" }) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * A print-ready preview: a Template's Program Guide, or an Activity's guide. 404 if it's not a Template or an
 * Activity the caller can read (a library one, or one in their Organization).
 */
export function previewHtml(db: Db, id: string, userId: string): string {
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row || (row.kind !== "template" && row.kind !== "activity")) {
    throw new HTTPException(404, { message: "Not found." });
  }
  readRole(db, row.organizationId, userId, row.visibility);
  if (row.kind === "template") {
    // Event-shaped (ADR-0017): the Program Guide reads it as an Event.
    const template = JSON.parse(row.json) as Event;
    const ids = template.activities.map((a) => a.activityId);
    const titles = activityRows(db, row.organizationId, ids).map((a) => ({
      id: a.id,
      title: a.title,
    }));
    return renderGuideHtml(buildGuide(template, titles));
  }
  const activity = JSON.parse(row.json) as Activity;
  const context = templateListing(db, row, activity.id) ?? standalone(activity);
  return renderActivityGuidesHtml(context, [
    buildActivityGuide(context, activity),
  ]);
}

function toItem(
  row: Row,
  names: Map<string, string>,
  myOrgs: Set<string>,
): CatalogItem {
  const doc = JSON.parse(row.json) as Record<string, unknown>;
  const item: CatalogItem = {
    id: row.id,
    kind: row.kind as LibraryKind,
    slug: row.slug,
    title: row.title,
    tags: Array.isArray(doc["tags"]) ? (doc["tags"] as string[]) : [],
    visibility: row.visibility,
    organization: {
      id: row.organizationId,
      name: names.get(row.organizationId) ?? "",
    },
    mine: myOrgs.has(row.organizationId),
    updatedAt: row.updatedAt.getTime(),
  };
  if (row.kind === "activity") {
    item.scoringType = (doc as Pick<Activity, "scoringType">).scoringType;
  } else {
    item.activityCount = (doc as Pick<Event, "activities">).activities.length;
  }
  return item;
}

function listedActivityIds(db: Db, orgIds: string[]): Set<string> {
  if (orgIds.length === 0) return new Set();
  const lists = db
    .select({ json: documents.json })
    .from(documents)
    .where(
      and(
        inArray(documents.kind, ["event", "template"]),
        inArray(documents.organizationId, orgIds),
      ),
    )
    .all();
  return new Set(
    lists.flatMap((l) =>
      (JSON.parse(l.json) as Pick<Event, "activities">).activities.map(
        (a) => a.activityId,
      ),
    ),
  );
}

function organizationNames(db: Db, rows: Row[]): Map<string, string> {
  const ids = [...new Set(rows.map((r) => r.organizationId))];
  if (ids.length === 0) return new Map();
  return new Map(
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(inArray(organizations.id, ids))
      .all()
      .map((o) => [o.id, o.name]),
  );
}

function activityRows(db: Db, organizationId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select({ id: documents.id, title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.kind, "activity"),
        inArray(documents.id, ids),
      ),
    )
    .all();
}

/**
 * A Template in the Activity's Organization that lists it, read as an Event (for its number and labels). For a
 * library Activity, only a library Template, so a preview never shows anything private.
 */
function templateListing(
  db: Db,
  row: Row,
  activityId: string,
): Event | undefined {
  const templates = db
    .select({ json: documents.json })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, row.organizationId),
        eq(documents.kind, "template"),
        row.visibility === "library"
          ? eq(documents.visibility, "library")
          : undefined,
      ),
    )
    .orderBy(documents.id)
    .all()
    .map((t) => JSON.parse(t.json) as Event);
  return templates.find((t) =>
    t.activities.some((a) => a.activityId === activityId),
  );
}

/** An Activity on its own: no number, v1's default colors, and no Event's name (ADR-0031 notes). */
function standalone(activity: Activity): Event {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: activity.id,
    kind: "event",
    slug: activity.slug,
    title: activity.title,
    terminology: { pack: "generic" },
    presentation: { themeColors: { ...DEFAULT_THEME_COLORS } },
    competitions: [],
    activities: [],
    tieNumbering: "dense",
  };
}
