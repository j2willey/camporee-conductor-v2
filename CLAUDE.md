# CLAUDE.md — Camporee Conductor v2

## What this is

Camporee Conductor v2 is a full rewrite of [v1](https://github.com/j2willey/camporee-conductor). It is a
product for designing and running **station-based team competitions**: Teams rotate through Stations,
volunteer Judges score Activities on their phones, and scores roll up into Standings, Awards and an
Announcer script. There are three pillars (ADR-0026): the **Curator** (Template library), the
**Composer** (event design and Program Guide, in the cloud with accounts) and the **Collator**
(event-day runtime and judge PWA, offline on an on-site box).

- Glossary: [CONTEXT.md](CONTEXT.md). Use these terms exactly.
- Decisions: [docs/adr/](docs/adr/README.md). Read the relevant ADR before changing anything it covers.
  If a change contradicts an ADR, stop and ask. Don't work around it.
- Current phase: Phase 1, slice order in [ADR-0024](docs/adr/0024-phase1-slice-order.md).
- Hard deadline: Program Guide published before 2027-04-01; event 2027-05-14 to 05-16 (ADR-0002).

## Hard rules

1. **Generic vocabulary in code, schema, identifiers and APIs** (ADR-0003). Write Event, Organizer,
   Group, Team, Participant, Activity, Station, Competition, Division, Judge, Official. Never Camporee,
   Troop, Patrol, Scout, Game, Challenge, Exhibition or League. Packs relabel the participant hierarchy
   and the event name. Activity kinds are a scoring type (`ranked` / `exhibition`), and their on-screen
   names ("Games", "Challenges", "Exhibitions") come from Competition labels.
2. **Judges never need accounts** (ADR-0023). Don't add a sign-in, Clerk session or any other account
   requirement to any judge flow. Clerk is Composer-only (ADR-0014).
3. **Scoring and ranking logic lives only in `packages/scoring`** (ADR-0008, 0019, 0020). The package is
   pure, with no I/O, DB, network, clock or randomness. UIs, the API and exports call it and never
   re-implement sums, conversions, sorting, tie handling or Common Field merging. (v1 duplicated this in
   four places and shipped a placement bug.)
   Official overrides (rank, placement points, point adjustments) are **logged Official actions passed
   into the package**, never edits to judge score entries; the latest action of a type wins (ADR-0019).
4. **Never silently re-sort a finalized Activity** (ADR-0019). Once an Official has set a Final Ranking,
   no recompute may reorder it without an explicit, logged Official action.
5. **JSON documents keep the cartridge shape** (ADR-0012). Events, Activities and Templates are stored in
   the DB exactly as they appear in a cartridge, validated by JSON Schema. Export = zip of documents;
   import = validate + insert. Don't add a DB-only shape that needs translating.
6. **Assets are referenced by id and never embedded** (ADR-0012). Media lives in the content-addressed
   store (`assets/<sha256>.<ext>`). Documents hold the asset id only, never bytes or base64.
7. **Common Fields are defined once per Competition and applied at runtime** (ADR-0020). Never copy
   them into Activities.
8. **AI is never on the event-day critical path** (ADR-0010). The Collator must work fully offline.
9. **Rosters live only in the Collator** (ADR-0026). Groups, Teams, Participants and their contacts are not
   Composer documents and never go into a design cartridge or Template. The Event's own `contacts` (its
   director and staff, ADR-0029 item 8) are personal data too: kept in the Event's own cartridges and stripped
   from every other export by `stripPersonalData` (ADR-0031 rule 4).

## Workflow

- **One issue → one branch → one PR** (ADR-0022). Every change starts from a GitHub issue written as a
  vertical-slice spec. Branch from `main`. Agents work in a git worktree. Name branches by type, e.g.
  `feat/…`, `fix/…`, `chore/…`, `docs/…`. Keep the PR scoped to its issue and reference it (`Closes #N`).
- **CI must pass before merge.** `main` is protected: no direct pushes. Merges go through a PR with
  green CI.
- **TDD for `packages/scoring`, `packages/schema` and cartridge import/export.** Write the failing test first, then the
  code. Use real Circus 2026 data as fixtures where possible.
- Record new architectural decisions as the next-numbered ADR in `docs/adr/` and add it to the index.
- Jim is new to this workflow. Explain each git/GitHub step in plain language, and ask before
  pushing, opening PRs, or creating anything on GitHub.

## How to run things

Toolchain: Node 22 and pnpm, pinned in `mise.toml` / `.nvmrc` / `packageManager`. Run `mise install`
once (or use corepack).

```sh
pnpm install      # install all workspace deps
pnpm typecheck    # tsc --noEmit in every package
pnpm lint         # ESLint + Prettier check
pnpm format       # Prettier --write (fix formatting)
pnpm test         # Vitest in every package
pnpm --filter @camporee-conductor/scoring test -- --watch   # TDD loop for scoring
pnpm --filter @camporee-conductor/schema generate           # regenerate json-schema/ after changing a Zod schema

# Composer API (apps/composer-api), :3010, composer.db. `start` loads .env.local at the repo root if present
# (gitignored): CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, and optionally ANTHROPIC_API_KEY and AI_MODEL (AI assistance,
# ADR-0030: off without a key). Variables set on the command line win over the file.
pnpm --filter @camporee-conductor/composer-api start                                         # Clerk sign-in
NODE_ENV=development AUTH_ADAPTER=dev pnpm --filter @camporee-conductor/composer-api start   # dev sign-in: header `x-dev-user: <email>`; refused in production
# add AI_ADAPTER=fake for canned AI answers without a key (development and test only; the e2e test uses it)
pnpm --filter @camporee-conductor/composer-web dev                                           # web app on :5173, proxies to the API
pnpm --filter @camporee-conductor/composer-api import-event <org-slug> packages/schema/fixtures/circus-2026
pnpm --filter @camporee-conductor/composer-api import-v1 <org-slug> <cartridge.zip|dir> [--overlay events/<event>/overlay.json] [--strict]  # v1 cartridge → v2 (#46)
node packages/cartridge/scripts/transcode-circus-2026.ts   # regenerate both Circus fixtures (must be a no-op)
pnpm --filter @camporee-conductor/composer-api export-cartridge <org-slug> <event-slug> [--profile design|event-day] [--out file.zip]  # #8
pnpm --filter @camporee-conductor/composer-api db:generate  # new migration after changing src/db/schema.ts
pnpm --filter @camporee-conductor/composer-api seed-demo <email> <org-slug> packages/schema/fixtures/circus-2026  # owner + Org + Event
pnpm --filter @camporee-conductor/composer-api set-curator <email> [--off]   # library curator (ADR-0031); user must have signed in
pnpm --filter @camporee-conductor/composer-api set-sysadmin <email> [--off]  # the first sysadmin (ADR-0032); then the /admin page
pnpm --filter @camporee-conductor/composer-api test-ai-key   # one live request with ANTHROPIC_API_KEY (ADR-0030); CI never calls the provider
pnpm --filter @camporee-conductor/composer-web e2e   # Playwright smoke test: builds the app, serves it from the API on :3020

# Collator (apps/collator), :3030, collator.db (#40). One Event per box; no accounts for Judges. Officials
# sign in at /official with an email on the cartridge's officials.json (an email-only gate, ADR-0027 item 5).
pnpm --filter @camporee-conductor/collator load-cartridge <event-day-cartridge.zip>
pnpm --filter @camporee-conductor/collator start            # WEB_ROOT=apps/collator-web/dist serves the built web app
pnpm --filter @camporee-conductor/collator-web dev          # judge page on :5174 (Official view at /official), proxies to the Collator
pnpm --filter @camporee-conductor/collator-web e2e          # Playwright: judge page and Official view on a phone-sized browser, :3040
pnpm --filter @camporee-conductor/collator db:generate     # new migration after changing src/db/schema.ts
pnpm --filter @camporee-conductor/collator backup-now [folder]  # one backup (VACUUM INTO); the server backs up every
                                                           # BACKUP_EVERY_MINUTES (5) to BACKUP_DIR (off when unset)

# The on-site box (docs/runbook/collator.md): Collator + Caddy, amd64 only. TLS_MODE=internal (dev/CI) or files.
cd deploy/collator && docker compose up -d --build --wait     # internal TLS; event day adds -f compose.tls-files.yaml
docker compose exec collator node apps/collator/src/cli/load-cartridge.ts /cartridges/<file>.zip
docs/runbook/rehearse-collator.sh   # build, start on :8443, score over HTTPS, Official view, backups; runs in CI
docs/runbook/drones-collator.sh     # judge drones (#63): Chromium + WebKit phones on the box over HTTPS; runs in CI
deploy/collator/issue-cert.sh --print|--check   # Jim only issues the certificate (certbot DNS-01, Cloudflare token)

# One image: the API serving the built app (Clerk keys at run time; dev sign-in refused)
docker build -t composer . && docker run --rm --init -p 3010:3010 --env-file .env.local -v composer-data:/data composer
```

CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → test, the Playwright smoke test, a Docker
image build-and-start check and the Collator box rehearsal on every PR and push to `main`.

## Layout

```
packages/scoring/   pure scoring & ranking (ADR-0019, 0020)
packages/program-guide/  pure Program Guide and Activity guide generation: models + print-ready HTML (ADR-0018, #5; ADR-0028, #44)
packages/judge-form/ the judge's score form (field inputs, stopwatch, reading an entry), shared by the judge page and
                    the Composer's scoring preview (ADR-0029 item 6)
packages/cartridge/ cartridges: v1 cartridge → v2 documents + per-event overlay (#46); the v2 zip format, export, and the
                    Collator's load checks (#8, ADR-0012 amendment)
events/             per-event overlay.json for v1 imports; never the v1 cartridge itself (unpublished designs)
packages/schema/    Zod document schemas (Event, Activity, Common Field set, Template) + generated JSON Schema;
                    fixtures/circus-2026/ is the transcoded Circus 2026 design; fixtures/circus-2026-as-run/ is
                    what the event ran, for scoring parity only (see TRANSCODE-NOTES.md)
apps/composer-api/  Composer API: Hono, SQLite/Drizzle, auth module (Clerk + dev adapter), Event import; serves the built
                    web app when WEB_ROOT is set
apps/composer-web/  Composer web app: React + Vite SPA (React Router library mode), TanStack Query, Tailwind;
                    e2e/ is the Playwright smoke test
apps/collator/      Collator: the on-site event-day server (ADR-0027). Hono, SQLite/Drizzle; loads an event-day
                    cartridge; roster and score entries keyed by phone-made ids; read-only Official view API;
                    backups to a folder; Dockerfile (built from the repo root) (#40)
apps/collator-web/  Collator web app (React + Vite, Tailwind), served by the Collator: the judge page at / (no
                    accounts; works offline: outbox + service worker, #41) and the Official view at /official
deploy/collator/    the on-site box: compose.yaml (collator + caddy), caddy/ (Caddyfile + TLS_MODE snippets),
                    compose.tls-files.yaml, env.example, issue-cert.sh (#40)
docs/runbook/       runbooks (README.md): event-day.md (the day, in order), collator.md (on-site box), deploy.md
                    (Composer droplet), and their rehearsal scripts
docs/adr/           architecture decision records (index: docs/adr/README.md)
CONTEXT.md          domain glossary
```
