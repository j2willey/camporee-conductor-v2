---
created: 2026-10-25T12:25
updated: 2026-10-25T12:25
---

# ADR-0022 — Development workflow: spec'd issues → agent in worktree → PR → CI gate → review → merge

Date: 2026-10-25 · Status: Accepted
Design docs move into the repo first. Each Phase 1 feature = GitHub issue written as a vertical-slice spec; agents work in git worktrees, one PR per issue; CI (typecheck, unit, e2e) must pass before merge; CLAUDE.md holds guardrails; strict TDD for scoring package and cartridge import/export.
Jim is new to this workflow: Claude explains each step as it happens.
