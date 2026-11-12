import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "./authz.ts";
import type { Db } from "./db/open.ts";
import {
  auditLog,
  invites,
  memberships,
  ROLES,
  users,
  type Role,
} from "./db/schema.ts";

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

export interface Invite {
  email: string;
  role: Role;
  invitedBy: string;
  createdAt: number;
}

/**
 * Adds a member by email, or changes their role if they're one already. An email no one has signed in with yet
 * gets a pending invite instead (#35), or its invite's role is updated. `created` says whether something new was
 * made.
 */
export function addMember(
  db: Db,
  change: Change & { email: string; role: Role },
):
  | { member: Member; created: boolean }
  | { invite: { invited: true; email: string; role: Role }; created: boolean } {
  requireRole(db, change.organizationId, change.actorId, "owner");
  const email = change.email.toLowerCase();
  const user = db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (!user) return { ...inviteEmail(db, { ...change, email }) };
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

/** Creates or updates the pending invite for `email` (lowercase), with an audit row. */
function inviteEmail(
  db: Db,
  change: Change & { email: string; role: Role },
): { invite: { invited: true; email: string; role: Role }; created: boolean } {
  return db.transaction(() => {
    const existing = db
      .select({ role: invites.role })
      .from(invites)
      .where(
        and(
          eq(invites.organizationId, change.organizationId),
          eq(invites.email, change.email),
        ),
      )
      .get();
    db.insert(invites)
      .values({
        organizationId: change.organizationId,
        email: change.email,
        role: change.role,
        invitedBy: change.actorId,
        createdAt: change.now,
      })
      .onConflictDoUpdate({
        target: [invites.organizationId, invites.email],
        set: { role: change.role, invitedBy: change.actorId },
      })
      .run();
    auditMember(db, change, "member.invite", {
      role: change.role,
      ...(existing && { was: existing.role }),
    });
    return {
      invite: { invited: true, email: change.email, role: change.role },
      created: !existing,
    };
  });
}

/** The Organization's pending invites, oldest first: owners only. */
export function listInvites(
  db: Db,
  organizationId: string,
  userId: string,
): Invite[] {
  requireRole(db, organizationId, userId, "owner");
  return db
    .select({
      email: invites.email,
      role: invites.role,
      invitedBy: invites.invitedBy,
      createdAt: invites.createdAt,
    })
    .from(invites)
    .where(eq(invites.organizationId, organizationId))
    .orderBy(invites.createdAt, invites.email)
    .all()
    .map((i) => ({ ...i, createdAt: i.createdAt.getTime() }));
}

/** Revokes a pending invite: owners only; 404 if there's none for that email. */
export function revokeInvite(
  db: Db,
  change: Change & { email: string },
): { revoked: true } {
  requireRole(db, change.organizationId, change.actorId, "owner");
  const email = change.email.toLowerCase();
  return db.transaction(() => {
    const found = db
      .delete(invites)
      .where(
        and(
          eq(invites.organizationId, change.organizationId),
          eq(invites.email, email),
        ),
      )
      .returning()
      .all();
    if (found.length === 0) {
      throw new HTTPException(404, { message: "No invite for that email." });
    }
    auditMember(db, change, "member.uninvite", { role: found[0]?.role });
    return { revoked: true };
  });
}

/**
 * At a sign-in with a verified email (`recordUser`): each pending invite for it becomes a membership, keeping the
 * higher role if they're a member already, and goes. One `member.add` audit row each. Call inside a transaction.
 */
export function redeemInvites(
  db: Db,
  { userId, email, now }: { userId: string; email: string; now: Date },
): void {
  const pending = db
    .select()
    .from(invites)
    .where(eq(invites.email, email.toLowerCase()))
    .all();
  for (const invite of pending) {
    const current = roleOf(db, invite.organizationId, userId);
    const role =
      current && ROLES.indexOf(current) <= ROLES.indexOf(invite.role)
        ? current
        : invite.role;
    db.insert(memberships)
      .values({ organizationId: invite.organizationId, userId, role })
      .onConflictDoUpdate({
        target: [memberships.organizationId, memberships.userId],
        set: { role },
      })
      .run();
    db.delete(invites)
      .where(
        and(
          eq(invites.organizationId, invite.organizationId),
          eq(invites.email, invite.email),
        ),
      )
      .run();
    auditMember(
      db,
      { organizationId: invite.organizationId, actorId: userId, now },
      "member.add",
      { userId, role, invitedBy: invite.invitedBy },
    );
  }
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
