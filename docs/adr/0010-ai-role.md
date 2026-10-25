---
created: 2026-10-25T11:50
updated: 2026-10-25T12:50
---
# ADR-0010 — AI at design time first; design agent later
Date: 2026-10-25 · Status: Accepted
**Decision:** Phase 1 AI = authoring assistance only (Program Guide drafting, Challenge theming, Templatize/PII stripping). Never on the event-day critical path (offline box). An in-product design agent ("describe your event → draft design") follows in Phase 2 or soon after, using domain operations as tools.

**Provider (2026-10-25):** Claude is the primary provider for design-time AI features; Gemini may be used later for specific tasks. Keep providers behind a small adapter (v1 had `src/lib/ai-provider.js`).
