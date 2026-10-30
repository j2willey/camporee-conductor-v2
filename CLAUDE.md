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
9. **Rosters live only in the Collator** (ADR-0026). Groups, Teams, Participants and contacts are not
   Composer documents and never go into a design cartridge or Template.

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
```

CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → test on every PR and push to `main`.

## Layout

```
packages/scoring/   pure scoring & ranking (ADR-0019, 0020)
packages/schema/    Zod document schemas (Event, Activity, Common Field set, Template) + generated JSON Schema;
                    fixtures/circus-2026/ is the transcoded Circus 2026 cartridge (see TRANSCODE-NOTES.md)
docs/adr/           architecture decision records (index: docs/adr/README.md)
CONTEXT.md          domain glossary
```
