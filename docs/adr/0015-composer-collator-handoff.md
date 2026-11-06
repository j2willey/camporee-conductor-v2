---
created: 2026-10-25T12:12
updated: 2026-11-06
---

# ADR-0015 — Composer ↔ Collator handoff by cartridge; results bundle returns by USB

Date: 2026-10-25 · Status: Accepted, see note 2026-11-06

- Before/at the event: load cartridge on the box by USB or by download while online (both supported).
- During: no cloud link.
- After: box exports a results bundle (scores, standings, roster as run); start with USB upload back to Composer; network upload maybe later.
- **Note 2026-11-06 ([ADR-0027](0027-onsite-collator.md) item 12):** the results bundle carries everything home, Judges included (for thank-you notes). What gets uploaded to the cloud Composer is decided later. The event-day cartridge also carries the Officials list (ADR-0027 item 5).
- Collator serves only Officials and Judges. A read-only public leaderboard during the event is far-future, explicitly out of scope.
