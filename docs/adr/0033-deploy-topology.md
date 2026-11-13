---
created: 2026-11-13
updated: 2026-11-13
---

# ADR-0033 — Deploy topology: v2 production and v2 demo on the droplet

Date: 2026-11-13 · Status: **Proposed** (waiting on Jim). Extends ADR-0013 (SQLite on the droplet) and ADR-0014
(Clerk). Pulls #36 (Litestream) forward. Leads to #93 (v2 replaces v1 as the public demo).

## Context

The 11/26 parity list is done. Jim's next goals (11/13): a **production** Composer + Curator, where he designs Camporee
2027 with real data, then a **public demo** that replaces v1's. Production comes first.

### The droplet today (measured 2026-11-13)

| What     | Value                                                                                                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host     | DigitalOcean, 1 vCPU, 2 GiB RAM (1967 MiB), 2 GiB swap (unused), 24 GB disk (6.6 GB used)                                                                                                                                                                                                    |
| Memory   | 773 MiB used, **about 1.19 GiB available**                                                                                                                                                                                                                                                   |
| v1       | Compose project `camporee-conductor`, 6 containers: `caddy` 13 MiB, `landing` 33, `composer` 63, `collator` 51, `demo-composer` 58, `demo-collator` 63 (about 280 MiB in total). Nightly cron at 03:00 resets the demo Collator                                                              |
| v2 today | One container, `composer-v2`, image `composer-v2:1de5e5f` (11/7), `mem_limit 256m`, **50 MiB** at idle. Database at **migration 0001** of 0007, holding 1 user, 1 Organization, 35 documents. Clerk **development** instance. No AI key. One manual backup in `~/composer-v2/backups` (11/7) |
| Proxy    | v1's Caddy (in v1's Compose project) on 80/443; every site is `tls internal`, with Cloudflare in front (proxied, SSL mode Full)                                                                                                                                                              |
| DNS      | Cloudflare, proxied: apex (v1 landing), `composer`, `collator`, `demo`, `collator-demo`, `composer-demo` (v1), `v2` (v2 today). No `www`, no `app`                                                                                                                                           |

## Decision (proposed)

### 1. Two v2 Composer instances from one image

`prod` and `demo` run the same image tag (`composer-v2:<commit>`). Each has its own Compose service, SQLite volume,
env file (`chmod 600`), secrets and hostname. Both join v1's network, publish no ports and keep `mem_limit 256m`.

- **The current `v2.` instance becomes the demo.** It already runs the Clerk development instance and holds only
  test data.
- **Production starts from an empty database.** Real 2027 data never shares a file with test data.

**Hostnames (Jim decides):**

| Instance | Proposal                                                           | Alternative                    |
| -------- | ------------------------------------------------------------------ | ------------------------------ |
| prod     | `app.camporeeconductor.com`                                        | `composer.` (after v1 retires) |
| demo     | `demo.camporeeconductor.com` once v1 retires; `v2.` until then     | the apex                       |
| apex     | stays the landing page, edited to point to the v2 demo and sign-in | becomes the v2 demo itself     |

### 2. Production

- **Invite-only (a code change, before the first real user).** A new setting, `SIGNUP=invite` (prod) or
  `SIGNUP=open` (demo, and the default in development). With `invite`, a newly signed-in user is stored only if one of
  these is true:
  - a pending Organization invite exists for their verified email (#35);
  - a sysadmin has invited that email site-wide (a new list on `/admin`);
  - the user is already a sysadmin.

  Anyone else gets 403 with "Conductor is invite-only for now. Ask the person who told you about it for an
  invite." Nothing is stored for them. This matters because a sysadmin acts as owner of every Organization during
  the rollout (ADR-0032 item 2). Turning on Clerk's own "restricted" sign-up mode as an outer layer is optional.

- **Sign-in:** a Clerk **production** instance of the "Camporee Conductor v2" application. It needs about five DNS
  records in Cloudflare (Clerk lists them) and removes the "development mode" badge. User ids change from the
  development instance, which is harmless: users are matched by verified email (#32).
- **Backups, before any real data: Litestream (#36, pulled forward).**
  - A Litestream sidecar container shares the prod volume. The database is already in WAL mode (ADR-0013).
  - It replicates continuously to object storage, with snapshots kept 30 days.
  - **Storage, proposed: Backblaze B2.** One private bucket, and an application key limited to that bucket. The first
    10 GB are free, and the database is under 1 MB, so the cost is **about $0 a month**. The alternative is
    DigitalOcean Spaces at $5 a month flat (250 GB), which keeps everything in one bill.
  - **A tested restore:** `docs/runbook/restore-drill.sh` restores the latest replica into a throwaway container and
    checks it opens, has passed the latest migration, and its user, Organization and document counts match the
    live database. It runs before the first real data, after every deploy, and monthly (a REMINDERS entry).
  - The manual "backup first" step (deploy runbook 11.1) stays for every deploy, because a migration can't be undone
    by replication.
- **First deploy steps** (the 11/12 report): build and ship the image from Omarchy; start prod with an empty
  database (migrations 0000–0007 run on start); start Litestream and run the restore drill; `set-sysadmin` for Jim;
  publish Circus 2026 as a library Template; put `ANTHROPIC_API_KEY` (prod key) in place and run `test-ai-key`.
- **AI in prod:** on for invited users. The entitlement switch from step 3 exists in prod too and defaults to **on**,
  so a sysadmin can turn one user off.

### 3. Demo

- **Seed:** a shared demo Organization holding the Circus 2026 Event, plus the Circus 2026 library Template.
- **Reset, proposed:** nightly at 03:00 (like v1's), from a seed database file in the image:
  - The shared demo Organization goes back to the seed.
  - Organizations that visitors created are deleted after 7 days.
  - Accounts and AI-access decisions survive.
- **A visible banner** on every page: "Demo: changes are reset nightly. Don't enter real names or contacts." It is set
  by `INSTANCE=demo`.
- **AI is off by default** for every user, and users can request access (step 3 of the plan; its own ADR amendment
  and PRs). It blocks the demo cutover, not production.
- **A separate Anthropic API key**, in its own Console workspace with its own spend limit. Prod's key lives in
  another workspace.
- **Sign-in, open question:** keep the Clerk development instance (it works now, but shows a badge and Clerk limits
  development instances), or create a second Clerk application for the demo. I'll check Clerk's current limits before
  Jim decides.
- **Open question: a v2 Collator demo.** v1's demo includes a Collator (`demo.`, `collator-demo.`). Matching it means a
  third v2 container that runs the judge page and Official view on a cartridge reset nightly. I'd add it for the
  cutover, since the demo should show event day. It is about 50 MiB.

### 4. v1 retirement

- v1 stays live until the v2 demo is verified.
- Then stop v1's `landing`, `composer`, `collator`, `demo-composer` and `demo-collator` with `docker compose stop`.
  Don't remove them: images and `/opt/camporee-conductor-data` are kept 30 days. **Rollback** = `docker compose start`
  plus the old Caddy blocks.
- **Caddy is part of v1's Compose project**, so it keeps running. Moving it to its own `edge` Compose project is a
  later chore, not part of this cutover. Until then, nobody runs `revive` without thinking.
- Remove the v1 nightly cron at the same time.

### 5. Capacity

Measured now: about 1.19 GiB available, with v1 (280 MiB) and v2 (50 MiB) running.

| Container        | Idle RAM | Source             |
| ---------------- | -------- | ------------------ |
| v2 prod          | ~50 MiB  | same as today's v2 |
| Litestream       | ~30 MiB  | **to measure**     |
| v2 demo Collator | ~50 MiB  | v2 Collator, local |

**Gate:** after each new container starts, `free -m` must still show **at least 900 MiB available**. If it doesn't,
stop v1's two demo containers first, since they retire anyway. Each v2 container keeps its 256 MiB cap, so a runaway
instance gets killed instead of starving the others. The numbers above are estimates until the deploy measures them.

## Consequences

- Jim can start 2027 design on prod right after the invite-only PR, the Litestream PR and the deploy. The demo work
  doesn't hold prod up.
- New code before prod: `SIGNUP=invite` with a site-wide invite list, and the Litestream sidecar with the restore
  drill. New code before the demo: `INSTANCE=demo` (banner and reset), demo AI access, and the demo seed.
- Two Clerk instances, two Anthropic keys, two env files: more secrets to look after, all on the droplet only.
- `docs/runbook/deploy.md` gets rewritten for two instances, as Linux commands Jim runs from Omarchy over ssh.

## Open for Jim

1. Hostnames: `app.` for prod and `demo.` for the demo after the cutover? What happens to the apex?
2. Backup storage: Backblaze B2 (about $0) or DO Spaces ($5 a month)?
3. Demo reset: nightly, visitor Organizations deleted after 7 days?
4. A v2 Collator demo in the cutover, yes or no?
5. Prod starts empty, and today's `v2.` instance becomes the demo: OK?
