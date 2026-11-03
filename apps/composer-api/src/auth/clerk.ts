import { createClerkClient } from "@clerk/backend";
import type { AuthAdapter } from "./types.ts";

/** Clerk session tokens (ADR-0014). The email is looked up once per user and cached. */
export function clerkAuth(keys: {
  secretKey: string;
  publishableKey: string;
}): AuthAdapter {
  const clerk = createClerkClient(keys);
  const emails = new Map<string, string>();
  return {
    async currentUser(request) {
      const state = await clerk.authenticateRequest(request, {
        acceptsToken: "session_token",
      });
      if (!state.isAuthenticated) return null;
      const { userId } = state.toAuth();
      let email = emails.get(userId);
      if (!email) {
        const user = await clerk.users.getUser(userId);
        email = user.primaryEmailAddress?.emailAddress.toLowerCase();
        if (!email) return null;
        emails.set(userId, email);
      }
      return { userId, email };
    },
  };
}
