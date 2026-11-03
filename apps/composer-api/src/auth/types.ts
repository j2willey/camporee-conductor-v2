/** Who is making a request, as the auth provider says. */
export interface AuthUser {
  userId: string;
  email: string;
  /** The provider has verified the email. The API refuses unverified users (issue #4). */
  emailVerified: boolean;
}

/**
 * The swappable auth module (ADR-0014). Everything outside `src/auth/` sees only this interface;
 * swapping providers means one new adapter file.
 */
export interface AuthAdapter {
  /** The signed-in user, or null when the request isn't signed in. */
  currentUser(request: Request): Promise<AuthUser | null>;
}
