import {
  stableUuid7,
  type V1Cartridge,
  type V1ImportOptions,
} from "@camporee-conductor/cartridge";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/open.ts";
import { documents } from "../db/schema.ts";

/**
 * Activities an earlier import of this v1 event left in the database whose game is no longer in the
 * cartridge (issue #46). They stay, unlisted by the Event, until cleanup exists. An Activity belongs to
 * this event when its id is the one this event's import gives its slug (ids are derived, not random), so
 * another event's Activities in the same Organization are never listed. Games still in the cartridge but
 * disabled or unfinished aren't listed: the import reports those already.
 */
export function leftoverActivities(
  db: Db,
  organizationId: string,
  cartridge: V1Cartridge,
  options: V1ImportOptions,
): { slug: string; title: string }[] {
  const inCartridge = new Set(cartridge.games.map((g) => g.id));
  return db
    .select({ id: documents.id, slug: documents.slug, title: documents.title })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, organizationId),
        eq(documents.kind, "activity"),
      ),
    )
    .all()
    .filter(
      (a) =>
        !inCartridge.has(a.slug) &&
        a.id ===
          stableUuid7(
            options.idNamespace,
            `activity:${a.slug}`,
            options.idTimestamp,
          ),
    )
    .map(({ slug, title }) => ({ slug, title: title.trim() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
