import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Db } from "./db/open.ts";
import { memberships, ROLES, users, type Role } from "./db/schema.ts";

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

/**
 * The caller's role for reading a document: their role in its Organization, or `viewer` for a library document
 * (ADR-0031 item 2: everyone signed in can see it). Anything else is 404, as `requireRole`.
 */
export function readRole(
  db: Db,
  organizationId: string,
  userId: string,
  visibility: "private" | "library",
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
  if (membership) return membership.role;
  if (visibility === "library") return "viewer";
  throw new HTTPException(404, { message: "Not found." });
}

/** True when the user is a library curator (ADR-0031 item 3). */
export function isCurator(db: Db, userId: string): boolean {
  return (
    db
      .select({ curator: users.curator })
      .from(users)
      .where(eq(users.id, userId))
      .get()?.curator ?? false
  );
}

/**
 * The caller's role for one document, to read it and to change it (ADR-0031 item 6, #102 PR 5).
 * - A private document: their role in its Organization; 404 for anyone else, as `requireRole`.
 * - A library document: everyone signed in reads it, so at least `viewer`. Only curators change it: a curator is at
 *   least `editor`, whether or not they're in its Organization, and anyone else is `viewer`, even its Organization's
 *   own editors.
 */
export function documentRole(
  db: Db,
  doc: { organizationId: string; visibility: "private" | "library" },
  userId: string,
): Role {
  const membership = db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, doc.organizationId),
        eq(memberships.userId, userId),
      ),
    )
    .get();
  if (doc.visibility === "private") {
    if (!membership) throw new HTTPException(404, { message: "Not found." });
    return membership.role;
  }
  if (!isCurator(db, userId)) return "viewer";
  return membership && atLeast(membership.role, "editor")
    ? membership.role
    : "editor";
}

/** `documentRole`, refused below `editor`: 403, with why for a library document. */
export function requireDocumentEditor(
  db: Db,
  doc: { organizationId: string; visibility: "private" | "library" },
  userId: string,
): Role {
  const role = documentRole(db, doc, userId);
  if (!atLeast(role, "editor")) {
    throw new HTTPException(403, {
      message:
        doc.visibility === "library"
          ? "Only a curator can change a library document."
          : "Your role can't do that.",
    });
  }
  return role;
}
