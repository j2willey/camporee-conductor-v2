import { openDb, type Db } from "./db/open.ts";
import { isNotNull } from "drizzle-orm";
import { auditLog, organizations } from "./db/schema.ts";

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

/**
 * The audit rows about documents (ADR-0029 item 5): saves, creates, deletes, imports. Leaves out membership rows
 * (#101), which every test's setup writes when it adds members.
 */
export const documentAudit = (db: Db) =>
  db.select().from(auditLog).where(isNotNull(auditLog.documentKind)).all();
