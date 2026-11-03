import type { AuthAdapter } from "./types.ts";

/** The header the dev adapter trusts for the user's email. */
export const DEV_USER_HEADER = "x-dev-user";
/** `false` makes the dev user's email unverified, to test the API's check. Verified otherwise. */
export const DEV_EMAIL_VERIFIED_HEADER = "x-dev-email-verified";

/**
 * Trusts a header for who is signed in, so tests and local development need no Clerk keys.
 * Never in production: `loadConfig` refuses it there (issue #4, D7).
 */
export function devAuth(): AuthAdapter {
  return {
    currentUser(request) {
      const email = request.headers.get(DEV_USER_HEADER)?.trim().toLowerCase();
      const emailVerified =
        request.headers.get(DEV_EMAIL_VERIFIED_HEADER) !== "false";
      return Promise.resolve(
        email ? { userId: `dev|${email}`, email, emailVerified } : null,
      );
    },
  };
}
