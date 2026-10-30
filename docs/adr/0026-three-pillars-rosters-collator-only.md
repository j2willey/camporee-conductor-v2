---
created: 2026-10-30
updated: 2026-10-30
---

# ADR-0026 — The three pillars carry over; rosters live only in the Collator

Date: 2026-10-30 · Status: Accepted (from issue #2 spec)

**Decision:**

- v1's three pillars carry over to v2:
  - **Curator**: the Template library (browse, preview, share).
  - **Composer**: event design (Activities, Competitions, Divisions, Program Guide). Cloud, with accounts (ADR-0009).
  - **Collator**: event-day runtime and judge PWA. On-site, offline (ADR-0009, ADR-0015).
- **Rosters (Groups, Teams, Participants and their contacts) live only in the Collator.** They are not
  Composer documents and are not part of the design cartridge.
- The roster schema is Phase 2 Collator work. After the event, the results bundle (ADR-0015) carries the
  roster as run back to the Composer, for archive only.

**Supersedes:** the roster parts of ADR-0001 ("rosters with contacts" as a planning feature) and ADR-0006
("rosters" in Phase 1 event design). It also drops v1's Composer `rosters{}` pre-population editor
(v1 ARCHITECTURE §14). In v1 that editor was secondary to Collator entry, and v1 cartridges carried a
`rosters` block. v2 design cartridges don't.

**Why:** roster and contact data is entered live at the event through the Collator, as at Circus 2026.
Keeping it out of design documents keeps personal contact data out of Templates and cartridges. Design
documents stay reusable across years and Organizations.
