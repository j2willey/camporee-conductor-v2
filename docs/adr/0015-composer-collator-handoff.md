---
created: 2026-10-25T12:12
updated: 2026-10-25T12:12
---
# ADR-0015 — Composer ↔ Collator handoff by cartridge; results bundle returns by USB
Date: 2026-10-25 · Status: Accepted
- Before/at the event: load cartridge on the box by USB or by download while online (both supported).
- During: no cloud link.
- After: box exports a results bundle (scores, standings, roster as run); start with USB upload back to Composer; network upload maybe later.
- Collator serves only Officials and Judges. A read-only public leaderboard during the event is far-future, explicitly out of scope.
