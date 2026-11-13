import { asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "./db/open.ts";
import { auditLog, memberships, organizations, users } from "./db/schema.ts";

/** The admin pages' users list and flags (ADR-0032, #104 PR 1). Sysadmins only: the routes check. */

/** Sets or clears a user's sysadmin flag (the first sysadmin's CLI). False if no user has that email. */
export function setSysadmin(db: Db, email: string, sysadmin: boolean): boolean {
  const updated = db
    .update(users)
    .set({ sysadmin })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning({ id: users.id })
    .all();
  return updated.length > 0;
}

export interface AdminUser {
  id: string;
  email: string;
  createdAt: number;
  lastSeenAt: number | null;
  curator: boolean;
  sysadmin: boolean;
  suspended: boolean;
  organizations: { id: string; slug: string; name: string; role: string }[];
}

const PAGE = 50;

/**
 * Users whose email contains `q` (any case), most recently seen first (then by email), up to 50, with their
 * Organizations and roles; and how many match in all.
 */
export function listUsers(
  db: Db,
  q: string,
): { users: AdminUser[]; total: number } {
  const where = q.trim()
    ? like(
        users.email,
        `%${q
          .trim()
          .toLowerCase()
          .replace(/[%_\\]/g, "\\$&")}%`,
      )
    : undefined;
  const rows = db
    .select()
    .from(users)
    .where(where)
    .orderBy(
      sql`${users.lastSeenAt} IS NULL`,
      desc(users.lastSeenAt),
      asc(users.email),
    )
    .limit(PAGE)
    .all();
  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(users)
      .where(where)
      .get()?.n ?? 0;
  const orgs =
    rows.length === 0
      ? []
      : db
          .select({
            userId: memberships.userId,
            id: organizations.id,
            slug: organizations.slug,
            name: organizations.name,
            role: memberships.role,
          })
          .from(memberships)
          .innerJoin(
            organizations,
            eq(organizations.id, memberships.organizationId),
          )
          .where(
            inArray(
              memberships.userId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(organizations.name))
          .all();
  return {
    users: rows.map((row) => ({
      ...toAdminUser(row),
      organizations: orgs
        .filter((o) => o.userId === row.id)
        .map(({ id, slug, name, role }) => ({ id, slug, name, role })),
    })),
    total,
  };
}

function toAdminUser(
  row: typeof users.$inferSelect,
): Omit<AdminUser, "organizations"> {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.createdAt.getTime(),
    lastSeenAt: row.lastSeenAt?.getTime() ?? null,
    curator: row.curator,
    sysadmin: row.sysadmin,
    suspended: row.suspended,
  };
}

export interface UserFlags {
  curator?: boolean | undefined;
  sysadmin?: boolean | undefined;
  suspended?: boolean | undefined;
}

/**
 * Changes a user's flags (ADR-0032), audited site-wide as `user.update`. A sysadmin can't remove their own sysadmin
 * flag or suspend themself, so one active sysadmin always remains.
 */
export function updateUserFlags(
  db: Db,
  {
    userId,
    flags,
    by,
    now,
  }: { userId: string; flags: UserFlags; by: string; now: Date },
): Omit<AdminUser, "organizations"> {
  if (userId === by && flags.sysadmin === false) {
    throw new HTTPException(400, {
      message: "You can't remove your own sysadmin flag.",
    });
  }
  if (userId === by && flags.suspended === true) {
    throw new HTTPException(400, { message: "You can't suspend yourself." });
  }
  return db.transaction((tx) => {
    const row = tx
      .update(users)
      .set(flags)
      .where(eq(users.id, userId))
      .returning()
      .get();
    if (!row) throw new HTTPException(404, { message: "Not found." });
    tx.insert(auditLog)
      .values({
        at: now,
        userId: by,
        organizationId: null,
        action: "user.update",
        detail: { userId, ...flags },
      })
      .run();
    return toAdminUser(row);
  });
}

/** True when the user is suspended (ADR-0032 item 3). */
export function isSuspended(db: Db, userId: string): boolean {
  return (
    db
      .select({ suspended: users.suspended })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.suspended ?? false
  );
}
