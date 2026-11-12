---
created: 2026-10-25T12:25
updated: 2026-11-12
---

# ADR-0020 — Common Fields defined once per Competition, applied at runtime by the scoring package

Date: 2026-10-25 · Status: Accepted
Never copied into Challenges. One merge implementation shared by judge form and rankings (replaces v1 collator-side injection).

## Amendment 2026-11-12 (issue #99): the checks that keep the merge safe

`checkEventBundle` (import, every Composer save, the Collator's load) refuses:
- a Competition's `before`/`after` id that isn't in its set, or an id listed twice;
- Competitions that use different sets. A cartridge holds one set per Event, and this moves that limit from
  export time to save time. More sets per Event can come later if a real event needs them;
- an Activity field with the id of a Common Field its Competition applies. This is the test that no Activity
  contains a Common Field. An Activity in a Competition that doesn't apply that Common Field may use the id.

The Event's set is the one its Competitions name. The Composer creates it with every Competition linked and
nothing picked (`before` and `after` empty), and saves it like any document (ADR-0029).
