import { normalizeTags, type Activity } from "@camporee-conductor/schema";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { documents } from "../db/schema.ts";
import { freeSlug, newUuid7 } from "./event-activities.ts";
import { activityIssues, audit } from "./save.ts";

/**
 * Save to library (ADR-0031 rule 5, #102 PR 3): forks an Activity into its own Organization as a saved, private
 * Activity that no Event lists, with lineage to the original, normalized tags and no `legacy`. Editors and owners.
 * A curator can then publish it. Returns the copy's id.
 */
export function saveToLibrary(
  db: Db,
  {
    activityId,
    userId,
    now,
  }: { activityId: string; userId: string; now: Date },
): { activityId: string } {
  return db.transaction(() => {
    const row = db
      .select()
      .from(documents)
      .where(and(eq(documents.id, activityId), eq(documents.kind, "activity")))
      .get();
    if (!row) throw new HTTPException(404, { message: "Not found." });
    requireRole(db, row.organizationId, userId, "editor");
    // Validated on import and on every save (ADR-0012, ADR-0029); stored exactly as given.
    const source = JSON.parse(row.json) as Activity;
    const id = newUuid7(now);
    const copy: Activity = {
      ...source,
      id,
      slug: freeSlug(db, row.organizationId, source.slug),
      lineage: { ...source.lineage, parentId: source.id },
      ...(source.tags && { tags: normalizeTags(source.tags) }),
    };
    delete copy.legacy;
    const issues = activityIssues(db, row.organizationId, id, copy);
    if (issues.length > 0) {
      throw new HTTPException(422, { message: issues.join("\n") });
    }
    db.insert(documents)
      .values({
        id,
        kind: "activity",
        organizationId: row.organizationId,
        slug: copy.slug,
        title: copy.title,
        json: JSON.stringify(copy),
        updatedAt: now,
        createdAt: now,
      })
      .run();
    audit(db, {
      at: now,
      userId,
      organizationId: row.organizationId,
      action: "activity.create",
      documentKind: "activity",
      documentId: id,
      detail: { parentId: source.id, change: "save-to-library" },
    });
    return { activityId: id };
  });
}
