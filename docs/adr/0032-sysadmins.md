---
created: 2026-11-12
updated: 2026-11-12
---

# ADR-0032 — Sysadmins: users, suspension and site-wide access

Date: 2026-11-12 · Status: Accepted (issue #104; decisions by Jim, 2026-11-12). Extends ADR-0014 and ADR-0021.

## Context

v1 had a sysadmin page: a users list with search, flags for sysadmin, suspended and curator, stats, and the audit
log. A v1 sysadmin also passed every Event permission check. v1 stored `is_suspended` but never enforced it. #104 (H in
the parity plan) brings the page to v2. Until now, v2's only site-wide role was the curator (ADR-0031), set from the
command line.

## Decision

1. **Two user flags beside `curator`:** `sysadmin` and `suspended`, stored on `users`. The first sysadmin is made from
   the command line (`set-sysadmin <email>`, like `set-curator`). After that, sysadmins set all three flags from the
   admin page.
2. **A sysadmin acts as an owner of every Organization, for the rollout** (Jim, 2026-11-12: parity with v1). Every
   access check (`requireRole`, `documentRole`, `readRole`) gives a sysadmin `owner` in an Organization they aren't a
   member of. Library documents still need a curator to change them (ADR-0031 item 6); a sysadmin can make themself
   one. **If v2 is widely adopted, this is scaled back** (Jim): a new ADR will narrow it, for example to read-only or
   to the admin pages only.
3. **A suspended user gets 403 on everything:** every API call answers "Your account is suspended." The web app shows
   that message instead of the app. Memberships, documents and flags stay, so unsuspending restores everything. Judges
   never have accounts (ADR-0023), so suspension never touches event day.
4. **The admin pages and their API are for sysadmins only:** `/admin` in the web app, `/api/admin/*` in the API.
   Anyone else gets a whole-page "Not found" and 404, so the pages' existence isn't revealed.
5. **A sysadmin can't remove their own sysadmin flag or suspend themself.** So there's always at least one sysadmin who
   isn't suspended: the one making the change.
6. **The audit log becomes site-wide too:** `organization_id` may be empty, for changes to users. A flag change is
   `user.update`, with the user and the flags changed in its detail. #104 PR 3 adds the audit view.
7. **`last_seen_at`** on `users`, updated on each request (the API already records the user on every request), so the
   users list can show who is active, as v1's `last_active` did.

## Consequences

- Support during the rollout is simple: a sysadmin opens any Organization as its owner would.
- A stolen sysadmin login can change any Event. That's accepted for the rollout, and the reason for item 2's planned
  scale-back.
- One more table rebuild (the audit log's `organization_id` loses NOT NULL): the runbook backup before the deploy, as
  for 0004.
