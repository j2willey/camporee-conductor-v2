---
created: 2026-10-25
status: design confirmed 2026-10-25 — next: slice 1, move into `camporee-conductor-v2` repo
updated: 2026-10-25T12:38
---

# Camporee Conductor v2 — Design Index

Grilling session 2026-10-25 (Claude, Camporee Conductor Advisor project). Glossary: [CONTEXT.md](../../CONTEXT.md).

| ADR                                                  | Decision                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-product-core-scope.md)                   | Core = station-based team competitions + planning artifacts; may grow to event-mgmt-lite                                                      |
| [0002](0002-timeline-dogfood-camporee-2027.md)       | Dogfood: Coyote Creek Camporee May 14–16, 2027; design side by end of Jan; Program Guide before Apr 1                                         |
| [0003](0003-generic-vocabulary-terminology-packs.md) | Generic vocabulary; Scouting is a Terminology Pack; Divisions first-class                                                                     |
| [0004](0004-offline-first-then-cloud.md)             | Offline on-site first, cloud after (refined by 0009)                                                                                          |
| [0005](0005-full-rewrite-new-repo.md)                | Full rewrite, new repo                                                                                                                        |
| [0006](0006-phasing-and-v1-fallback.md)              | Phases 1/2/3; v1 as fallback via v1-compatible export                                                                                         |
| [0007](0007-divisions.md)                            | Divisions: Official-assigned, changeable; per-Division placements; director-configured awards/tiers                                           |
| [0008](0008-stack.md)                                | Stack (provisional): TS monorepo, pure scoring pkg, Hono/Fastify, SQLite+Drizzle, React+Vite PWA, append-only score log                       |
| [0009](0009-deployment-split.md)                     | Composer in cloud with accounts from day one; only Collator on-site                                                                           |
| [0010](0010-ai-role.md)                              | AI at design time first; design agent later                                                                                                   |
| [0011](0011-naming.md)                               | Focus on Camporee Conductor brand                                                                                                             |
| [0012](0012-document-in-database-and-asset-store.md) | JSON documents in DB; content-addressed asset store; event-day vs full-template cartridges                                                    |
| [0013](0013-sqlite-on-droplet.md)                    | SQLite on DO droplet + Litestream                                                                                                             |
| [0014](0014-auth-clerk.md)                           | Clerk behind swappable auth module                                                                                                            |
| [0015](0015-composer-collator-handoff.md)            | Cartridge down / results bundle up via USB (or download); Collator = Officials + Judges only                                                  |
| [0016](0016-repo-naming.md)                          | Build in `camporee-conductor-v2`; rename v1 → `-v1` at launch                                                                                 |
| [0017](0017-library-minimal-with-lineage.md)         | Minimal template library; lineage + external attribution modeled day one                                                                      |
| [0018](0018-program-guide-output.md)                 | Program Guide: HTML/PDF + Markdown/Word export                                                                                                |
| [0019](0019-scoring-pipeline.md)                     | Scoring pipeline: raw/judged → points (Official conversions, strawman optional) → provisional → Official Final Ranking; ties dense by default |
| [0020](0020-common-fields-runtime.md)                | Common Fields per Competition, applied at runtime                                                                                             |
| [0021](0021-organizations.md)                        | Organizations own Events, profiles, private Templates                                                                                         |
| [0022](0022-dev-workflow.md)                         | Workflow: issue → worktree → PR → CI → review; TDD for scoring + cartridges                                                                   |
| [0023](0023-judge-access-and-phase2-deferrals.md)    | Judges never need accounts; WiFi QR + app QR, judge picks Challenge; per-station QR bonus                                                     |
| [0024](0024-phase1-slice-order.md)                   | Phase 1 slice order (Program Guide at #5)                                                                                                     |
| [0025](0025-pnpm-workspaces-monorepo.md)             | Monorepo tooling: pnpm workspaces, Node 22, ESLint + Prettier + Vitest                                                                        |

## Deferred (Phase 2 session, ~December)

On-site box hardware; offline TLS for phones; judge sync protocol; QR join-code/revocation details; score changes after finalization.

## Small open items

Resolved: Claude primary for AI features, Gemini possibly later (ADR-0010). Still open: v1 public Collator exposure until v2 launch (review finding #1).
