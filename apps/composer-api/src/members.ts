import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "./authz.ts";
import type { Db } from "./db/open.ts";
import { auditLog, memberships, ROLES, users, type Role } from "./db/schema.ts";

/**
 * An Organization's members (ADR-0021, #4, #101): any member sees the list; owners add, change roles and remove.
 * An Organization always keeps at least one owner. Each change writes an audit row with user ids, never emails.
 */

export interface Member {
  userId: string;
  email: string;
  role: Role;
}

type Change = { organizationId: string; actorId: string; now: Date };

const LAST_OWNER = "An Organization needs at least one owner.";

/** Owners first, then editors, then viewers; by email within each. */
export function listMembers(
  db: Db,
  organizationId: string,
  userId: string,
): Member[] {
  requireRole(db, organizationId, userId, "viewer");
  return db
    .select({
      userId: memberships.userId,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.organizationId, organizationId))
    .all()
    .sort(
      (a, b) =>
        ROLES.indexOf(a.role) - ROLES.indexOf(b.role) ||
        a.email.localeCompare(b.email),
    );
}

/**
 * Adds a member by email, or changes their role if they're one already (`created` says which). 404 if no one with
 * that email has signed in yet.
 */
export function addMember(
  db: Db,
  change: Change & { email: string; role: Role },
): { member: Member; created: boolean } {
  requireRole(db, change.organizationId, change.actorId, "owner");
  const user = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, change.email))
    .get();
  if (!user) {
    throw new HTTPException(404, {
      message: "No one with that email has signed in yet.",
    });
  }
  return db.transaction(() => {
    const current = roleOf(db, change.organizationId, user.id);
    if (current === "owner" && change.role !== "owner") {
      requireAnotherOwner(db, change.organizationId);
    }
    db.insert(memberships)
      .values({
        organizationId: change.organizationId,
        userId: user.id,
        role: change.role,
      })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: { role: change.role },
      })
      .run();
    auditMember(db, change, current ? "member.role" : "member.add", {
      userId: user.id,
      role: change.role,
      ...(current && { was: current }),
    });
    return {
      member: { userId: user.id, email: user.email, role: change.role },
      created: !current,
    };
  });
}

/** Changes a member's role; 404 if they aren't one, 409 to demote the last owner. */
export function setMemberRole(
  db: Db,
  change: Change & { userId: string; role: Role },
): Member {
  requireRole(db, change.organizationId, change.actorId, "owner");
  return db.transaction(() => {
    const current = requireMember(db, change.organizationId, change.userId);
    if (current.role === "owner" && change.role !== "owner") {
      requireAnotherOwner(db, change.organizationId);
    }
    db.update(memberships)
      .set({ role: change.role })
      .where(
        and(
          eq(memberships.organizationId, change.organizationId),
          eq(memberships.userId, change.userId),
        ),
      )
      .run();
    auditMember(db, change, "member.role", {
      userId: change.userId,
      role: change.role,
      was: current.role,
    });
    return { ...current, role: change.role };
  });
}

/** Removes a member; 404 if they aren't one, 409 for the last owner (themselves included). */
export function removeMember(
  db: Db,
  change: Change & { userId: string },
): { removed: true } {
  requireRole(db, change.organizationId, change.actorId, "owner");
  return db.transaction(() => {
    const current = requireMember(db, change.organizationId, change.userId);
    if (current.role === "owner")
      requireAnotherOwner(db, change.organizationId);
    db.delete(memberships)
      .where(
        and(
          eq(memberships.organizationId, change.organizationId),
          eq(memberships.userId, change.userId),
        ),
      )
      .run();
    auditMember(db, change, "member.remove", {
      userId: change.userId,
      was: current.role,
    });
    return { removed: true };
  });
}

function roleOf(
  db: Db,
  organizationId: string,
  userId: string,
): Role | undefined {
  return db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
      ),
    )
    .get()?.role;
}

function requireMember(db: Db, organizationId: string, userId: string): Member {
  const row = db
    .select({
      userId: memberships.userId,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
      ),
    )
    .get();
  if (!row) throw new HTTPException(404, { message: "Not a member." });
  return row;
}

function requireAnotherOwner(db: Db, organizationId: string): void {
  const owners = db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.role, "owner"),
      ),
    )
    .all();
  if (owners.length <= 1) throw new HTTPException(409, { message: LAST_OWNER });
}

function auditMember(
  db: Db,
  { organizationId, actorId, now }: Change,
  action: string,
  detail: Record<string, unknown>,
): void {
  db.insert(auditLog)
    .values({
      at: now,
      userId: actorId,
      organizationId,
      action,
      documentKind: null,
      documentId: null,
      detail,
    })
    .run();
}
