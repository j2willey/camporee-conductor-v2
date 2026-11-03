---
created: 2026-10-25T12:12
updated: 2026-11-03
---

# ADR-0014 — Auth: Clerk, behind a small swappable auth module

Date: 2026-10-25 · Status: Accepted
Composer only. Collator event-day roles (Officials, Judges) do not use Clerk on the offline box.

## Amendment 2026-11-03 (issue #4): verified emails only

- **The Clerk instance must require email verification at sign-up** (Clerk dashboard → User & authentication
  → Email: verify at sign-up). Check it for every Clerk instance the Composer uses, development and
  production.
- **Second layer in the API:** the auth module reports whether the provider verified the email
  (`AuthUser.emailVerified`), and the API refuses an unverified user with 403. Such a user is never
  stored, so an owner can't match them when adding a member by email, and an unverified address can't
  replace a stored user's email. Tested with the dev adapter (`x-dev-email-verified: false`).
- The dev sign-in adapter does no verification; the server refuses to start with it in production (issue #4, D7).
