// Loads an Event directory (event.json, common-fields.json, activities/) into an Organization.
// Usage: pnpm --filter @camporee-conductor/composer-api import-event <org-slug> <dir>
// The database is DATABASE_PATH (default composer.db), the same file the server uses (databasePathFrom).
// Relative paths are from where pnpm was run.
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { organizations } from "../db/schema.ts";
import { ImportError, importEvent } from "../import/import-event.ts";
import { readEventBundle } from "../import/read-event-bundle.ts";

const [orgSlug, dir] = process.argv.slice(2);
if (!orgSlug || !dir) {
  console.error("usage: import <org-slug> <event-directory>");
  process.exit(2);
}
// pnpm runs scripts in the package directory; INIT_CWD is where the command was typed.
const from = (path: string) => resolve(process.env["INIT_CWD"] ?? ".", path);

const db = openDb(databasePathFrom(process.env));
const org = db
  .select({ id: organizations.id })
  .from(organizations)
  .where(eq(organizations.slug, orgSlug))
  .get();
if (!org) {
  console.error(`no Organization with slug "${orgSlug}"`);
  process.exit(1);
}
try {
  const { eventId, created, updated } = importEvent(
    db,
    org.id,
    readEventBundle(from(dir)),
  );
  console.log(
    `imported Event ${eventId}: ${created} created, ${updated} updated`,
  );
} catch (error) {
  if (error instanceof ImportError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
