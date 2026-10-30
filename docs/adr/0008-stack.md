---
created: 2026-10-25T11:50
updated: 2026-10-25T11:50
---

# ADR-0008 — Stack (provisional)

Date: 2026-10-25 · Status: Accepted, provisional pending job-description check (Oct 31)
**Decision:** TypeScript monorepo; pure, heavily tested scoring/ranking package (no I/O); Node API (Hono or Fastify); SQLite + Drizzle; React + Vite for Composer, officials' views and judge PWA; judge sync as an append-only score-event log (no sync framework). New GitHub repo (portfolio).
**Why:** v1 had ranking logic duplicated in 4 places with no tests (and an announcer-sheet placement bug at Circus 2026); TS/React match job market; hand-rolled event log is small, testable, explainable.
