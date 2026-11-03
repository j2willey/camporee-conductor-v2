import { openDb, type Db } from "./db/open.ts";
import { organizations } from "./db/schema.ts";

export const CIRCUS_2026 = new URL(
  "../../../packages/schema/fixtures/circus-2026/",
  import.meta.url,
).pathname;

/** A fresh in-memory database with one Organization per slug given. */
export function testDb(...orgSlugs: string[]): Db {
  const db = openDb(":memory:");
  for (const slug of orgSlugs) {
    db.insert(organizations)
      .values({ id: `org-${slug}`, slug, name: slug, createdAt: new Date(0) })
      .run();
  }
  return db;
}
