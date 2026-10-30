---
created: 2026-10-25T11:33
updated: 2026-10-25T11:33
---

# ADR-0005 — Full rewrite in a new repository; design docs in vault until direction settles

Date: 2026-10-25 · Status: Accepted
**Decision:** v2 is a new git/GitHub repo, not a strangler-fig of v1. v1's data model and lessons carry over; v1 code does not. Design docs (CONTEXT.md, ADRs) live in the vault at `10-Projects/Camporee-Conductor/v2/` and move into the repo once direction is decided.
**Why:** no external users depend on v1; stack is open; generic vocabulary renames fields anyway; AI-assisted generation makes code the cheap part.
