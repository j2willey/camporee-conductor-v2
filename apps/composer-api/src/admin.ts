import { and, asc, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "./db/open.ts";
import {
  auditLog,
  documents,
  memberships,
  organizations,
  users,
} from "./db/schema.ts";

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
  displayName: string | null;
  organizerName: string | null;
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
  // The email, display name or organizer name contains q; LIKE ignores ASCII case, and % _ \ are escaped.
  const pattern = `%${q.trim().replace(/[%_\\]/g, "\\$&")}%`;
  const where = q.trim()
    ? or(
        ...[users.email, users.displayName, users.organizerName].map(
          (column) => sql`${column} LIKE ${pattern} ESCAPE '\\'`,
        ),
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
    displayName: row.displayName,
    organizerName: row.organizerName,
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

/** A user's own profile (ADR-0032 notes, #104 PR 2): null for a name left empty. */
export interface Profile {
  displayName: string | null;
  organizerName: string | null;
}

export function readProfile(db: Db, userId: string): Profile {
  const row = db
    .select({
      displayName: users.displayName,
      organizerName: users.organizerName,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return {
    displayName: row?.displayName ?? null,
    organizerName: row?.organizerName ?? null,
  };
}

/** Saves the user's own profile; each name is already trimmed, and empty is null. */
export function saveProfile(db: Db, userId: string, profile: Profile): Profile {
  db.update(users).set(profile).where(eq(users.id, userId)).run();
  return readProfile(db, userId);
}

/** The admin stats (ADR-0032 notes, #104 PR 3). */
export interface AdminStats {
  users: number;
  events: number;
  /** Events created since the start of `now`'s calendar month, in UTC. */
  eventsThisMonth: number;
}

export function adminStats(db: Db, now: Date): AdminStats {
  const count = (query: { get(): { n: number } | undefined }) =>
    query.get()?.n ?? 0;
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const isEvent = eq(documents.kind, "event");
  return {
    users: count(db.select({ n: sql<number>`count(*)` }).from(users)),
    events: count(
      db
        .select({ n: sql<number>`count(*)` })
        .from(documents)
        .where(isEvent),
    ),
    eventsThisMonth: count(
      db
        .select({ n: sql<number>`count(*)` })
        .from(documents)
        .where(and(isEvent, gte(documents.createdAt, monthStart))),
    ),
  };
}

/** One audit row as the audit view shows it (ADR-0032 notes). */
export interface AuditEntry {
  id: number;
  at: number;
  /** Null for a CLI action. */
  userEmail: string | null;
  organization: { id: string; slug: string; name: string } | null;
  action: string;
  documentKind: string | null;
  documentId: string | null;
  /** Null when there's no document, or it no longer exists. */
  documentTitle: string | null;
  detail: unknown;
}

export interface AuditFilter {
  /** A user's email, exact, any case. */
  user?: string | undefined;
  action?: string | undefined;
  /** Rows older than this id: the previous page's `next`. */
  before?: number | undefined;
}

/**
 * The audit log newest first, 50 at a time (ADR-0032 notes), with every action in the log for the filter's list.
 * `next` is the `before` for the following page, or null on the last.
 */
export function listAudit(
  db: Db,
  { user, action, before }: AuditFilter,
): { entries: AuditEntry[]; actions: string[]; next: number | null } {
  const where = and(
    user ? eq(users.email, user.trim().toLowerCase()) : undefined,
    action ? eq(auditLog.action, action) : undefined,
    before === undefined ? undefined : lt(auditLog.id, before),
  );
  const rows = db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      userEmail: users.email,
      organizationId: organizations.id,
      organizationSlug: organizations.slug,
      organizationName: organizations.name,
      action: auditLog.action,
      documentKind: auditLog.documentKind,
      documentId: auditLog.documentId,
      documentTitle: documents.title,
      detail: auditLog.detail,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .leftJoin(organizations, eq(organizations.id, auditLog.organizationId))
    .leftJoin(documents, eq(documents.id, auditLog.documentId))
    .where(where)
    .orderBy(desc(auditLog.id))
    .limit(PAGE + 1)
    .all();
  const page = rows.slice(0, PAGE);
  const actions = db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .orderBy(asc(auditLog.action))
    .all()
    .map((r) => r.action);
  return {
    entries: page.map((row) => ({
      id: row.id,
      at: row.at.getTime(),
      userEmail: row.userEmail,
      organization:
        row.organizationId === null
          ? null
          : {
              id: row.organizationId,
              slug: row.organizationSlug ?? "",
              name: row.organizationName ?? "",
            },
      action: row.action,
      documentKind: row.documentKind,
      documentId: row.documentId,
      documentTitle: row.documentTitle,
      detail: row.detail ?? null,
    })),
    actions,
    next: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null,
  };
}
