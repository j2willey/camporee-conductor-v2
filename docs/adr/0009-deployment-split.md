---
created: 2026-10-25T11:50
updated: 2026-10-25T11:50
---
# ADR-0009 — Composer in the cloud with real accounts from day one; only the Collator runs on-site
Date: 2026-10-25 · Status: Accepted (refines ADR-0004)
**Decision:** Composer (event design, templates, Program Guide) is cloud-hosted with real user accounts in Phase 1. Only the Collator (event-day runtime + judge PWA) must run locally/offline. Cloud Collator comes later.
**Why:** v1 already proved cloud Composer + Clerk works; design work happens weeks before the event with internet; only event day is off-grid.
