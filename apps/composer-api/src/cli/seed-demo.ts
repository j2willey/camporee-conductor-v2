// Sets up a demo: an owner (by email), an Organization they own, and an Event loaded into it. For local
// runs, the built image and the smoke test. Safe to re-run.
// Usage: pnpm --filter @camporee-conductor/composer-api seed-demo <owner-email> <org-slug> <dir>
// The owner is stored under a placeholder id; their first sign-in, dev or Clerk, relinks it (#32).
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { memberships, organizations, users } from "../db/schema.ts";
import { ImportError, importEvent } from "../import/import-event.ts";
import { readEventBundle } from "../import/read-event-bundle.ts";

const [rawEmail, orgSlug, dir] = process.argv.slice(2);
if (!rawEmail || !orgSlug || !dir) {
  console.error("usage: seed-demo <owner-email> <org-slug> <event-directory>");
  process.exit(2);
}
const email = rawEmail.trim().toLowerCase();
const from = (path: string) => resolve(process.env["INIT_CWD"] ?? ".", path);
const bundle = readEventBundle(from(dir));

const db = openDb(databasePathFrom(process.env));
const now = new Date();
const orgId = db.transaction((tx) => {
  tx.insert(users)
    .values({ id: `seeded|${email}`, email, createdAt: now })
    .onConflictDoNothing({ target: users.email })
    .run();
  const user = tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  tx.insert(organizations)
    .values({
      id: randomUUID(),
      slug: orgSlug,
      name: orgSlug.replace(
        /(^|-)([a-z0-9])/g,
        (_, dash: string, c: string) => (dash && " ") + c.toUpperCase(),
      ),
      createdAt: now,
    })
    .onConflictDoNothing({ target: organizations.slug })
    .run();
  const org = tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, orgSlug))
    .get();
  if (!user || !org) throw new Error("seed rows missing after insert");
  tx.insert(memberships)
    .values({ organizationId: org.id, userId: user.id, role: "owner" })
    .onConflictDoUpdate({
      target: [memberships.organizationId, memberships.userId],
      set: { role: "owner" },
    })
    .run();
  return org.id;
});
let result;
try {
  result = importEvent(db, orgId, bundle, now);
} catch (error) {
  if (error instanceof ImportError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
console.log(
  `${email} owns ${orgSlug}; imported Event ${result.eventId}: ${result.created} created, ${result.updated} updated`,
);
