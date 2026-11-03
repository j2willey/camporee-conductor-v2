import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "./db/open.ts";
import { memberships, ROLES, type Role } from "./db/schema.ts";

/** True when `role` is `min` or above (owner > editor > viewer). */
export function atLeast(role: Role, min: Role): boolean {
  return ROLES.indexOf(role) <= ROLES.indexOf(min);
}

/**
 * The caller's role in an Organization, if it's at least `min`. A non-member gets 404, so an
 * Organization's existence isn't revealed; a member below `min` gets 403. The one place routes check
 * access (issue #4).
 */
export function requireRole(
  db: Db,
  organizationId: string,
  userId: string,
  min: Role,
): Role {
  const membership = db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, userId),
      ),
    )
    .get();
  if (!membership) throw new HTTPException(404, { message: "Not found." });
  if (!atLeast(membership.role, min)) {
    throw new HTTPException(403, { message: "Your role can't do that." });
  }
  return membership.role;
}
