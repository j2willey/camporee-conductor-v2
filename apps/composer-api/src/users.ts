import { and, eq, ne, sql } from "drizzle-orm";
import type { AuthUser } from "./auth/index.ts";
import { atLeast } from "./authz.ts";
import type { Db } from "./db/open.ts";
import { memberships, users } from "./db/schema.ts";
import { redeemInvites } from "./members.ts";

/**
 * Stores a signed-in user with a verified email (ADR-0014 amendment). Memberships follow the verified
 * email: if it's stored under another auth id (an account recreated, an email moved between accounts, a
 * provider switch), that user is relinked to the new id, and if the new id is already stored too, the two
 * are merged, keeping the higher role in each Organization (issue #32).
 */
export function recordUser(db: Db, user: AuthUser, now: Date): void {
  db.transaction((tx) => {
    const previous = tx
      .select()
      .from(users)
      .where(and(eq(users.email, user.email), ne(users.id, user.userId)))
      .get();
    if (previous) {
      // The new id's row is written after the old one is deleted (email is unique), so the memberships
      // briefly point at it; SQLite checks the foreign keys at commit instead.
      tx.run(sql`PRAGMA defer_foreign_keys = ON`);
      const theirs = tx
        .select()
        .from(memberships)
        .where(eq(memberships.userId, previous.id))
        .all();
      tx.delete(memberships).where(eq(memberships.userId, previous.id)).run();
      for (const { organizationId, role } of theirs) {
        const mine = tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, organizationId),
              eq(memberships.userId, user.userId),
            ),
          )
          .get();
        if (!mine) {
          tx.insert(memberships)
            .values({ organizationId, userId: user.userId, role })
            .run();
        } else if (!atLeast(mine.role, role)) {
          tx.update(memberships)
            .set({ role })
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.userId, user.userId),
              ),
            )
            .run();
        }
      }
      tx.delete(users).where(eq(users.id, previous.id)).run();
    }
    tx.insert(users)
      .values({
        id: user.userId,
        email: user.email,
        createdAt: previous?.createdAt ?? now,
      })
      .onConflictDoUpdate({ target: users.id, set: { email: user.email } })
      .run();
    // Only a verified email gets here (the API refuses unverified ones first), so invites follow it (#35).
    redeemInvites(tx, {
      userId: user.userId,
      email: user.email,
      now,
    });
  });
}
