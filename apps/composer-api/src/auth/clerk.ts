import { createClerkClient } from "@clerk/backend";
import type { AuthAdapter } from "./types.ts";

/** The parts of a Clerk user this adapter reads. */
interface ClerkUserEmail {
  primaryEmailAddress: {
    emailAddress: string;
    verification: { status: string } | null;
  } | null;
}

/** The user's primary email and whether Clerk has verified it; null if there's none. */
export function primaryEmailOf(
  user: ClerkUserEmail,
): { email: string; emailVerified: boolean } | null {
  const primary = user.primaryEmailAddress;
  if (!primary) return null;
  return {
    email: primary.emailAddress.toLowerCase(),
    emailVerified: primary.verification?.status === "verified",
  };
}

/**
 * Clerk session tokens (ADR-0014). The email is looked up from Clerk and cached once verified; an
 * unverified email is looked up again on the next request, so verifying takes effect without a restart.
 */
export function clerkAuth(keys: {
  secretKey: string;
  publishableKey: string;
}): AuthAdapter {
  const clerk = createClerkClient(keys);
  const verified = new Map<string, string>();
  return {
    async currentUser(request) {
      const state = await clerk.authenticateRequest(request, {
        acceptsToken: "session_token",
      });
      if (!state.isAuthenticated) return null;
      const { userId } = state.toAuth();
      const cached = verified.get(userId);
      if (cached) return { userId, email: cached, emailVerified: true };
      const primary = primaryEmailOf(await clerk.users.getUser(userId));
      if (!primary) return null;
      if (primary.emailVerified) verified.set(userId, primary.email);
      return { userId, ...primary };
    },
  };
}
