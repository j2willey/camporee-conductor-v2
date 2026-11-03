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
- **Memberships follow the verified email** (issue #32). When a verified email is already stored under a
  different auth id (a Clerk account deleted and recreated, an email moved between accounts, or a future
  switch of provider), the stored user is relinked to the new id and keeps their memberships. If the new id
  is stored too, the two are merged: the old id is removed, and each Organization keeps the higher of the
  two roles. This trusts the provider's verification, which is why unverified emails are refused first.
  Tested with the dev adapter (`app.test.ts`); the code is `recordUser` in `apps/composer-api/src/users.ts`.
