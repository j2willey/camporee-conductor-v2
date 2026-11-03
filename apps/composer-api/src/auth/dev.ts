import type { AuthAdapter } from "./types.ts";

/** The header the dev adapter trusts for the user's email. */
export const DEV_USER_HEADER = "x-dev-user";

/**
 * Trusts a header for who is signed in, so tests and local development need no Clerk keys.
 * Never in production: `loadConfig` refuses it there (issue #4, D7).
 */
export function devAuth(): AuthAdapter {
  return {
    currentUser(request) {
      const email = request.headers.get(DEV_USER_HEADER)?.trim().toLowerCase();
      return Promise.resolve(email ? { userId: `dev|${email}`, email } : null);
    },
  };
}
