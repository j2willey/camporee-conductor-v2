---
created: 2026-10-25T12:25
updated: 2026-10-25T12:38
---
# ADR-0019 — Scoring pipeline: raw → points (official-defined conversions) → sorted totals → Official-final rankings
Date: 2026-10-25 · Status: Accepted
1. Judges record results at a Station.
2. Results become **points**. Officials define **conversions** from metrics to points, e.g. matches used (1 → 10 pts, 2 → 7, 3 → 4) or time → points, with direction per Challenge (sometimes less time is better, sometimes more).
3. Teams are sorted by point total → **provisional ranking**.
4. An **Official sets the Final Ranking**. Usually identical to provisional, but Officials have discretion (e.g., un-Scout-like behavior) to change it.
Supersedes v1's implicit "sum points − penalties, sort desc" scattered across 4 files; implemented once in the pure scoring package, tested against Circus 2026 data. v1 `weight` field: dropped unless a real use appears.

## Details (round 5)
- **Conversions:** primarily set by Officials at the event after seeing the real spread of results; the Composer may hold an optional **strawman** conversion defined at design time as a starting point. All points recompute when a conversion changes; changes are logged.
- **Judge entry:** per field — raw metrics (counts, times) that get converted, or judged points entered directly (e.g., Scout Spirit 0–10). Raw entries are stored as entered.
- **Final Ranking overrides:** no reason required; optional notes field. Logged (who/when).
- **Ties:** allowed in Final Rankings. Numbering is configurable per Event by the director; default is dense (1, 2, 2, 3) — Jim's preference: give out more awards.
- **Score change after finalization:** DEFERRED to Phase 2 session. Constraint in place now: the scoring package never silently re-sorts a finalized Challenge.
- **Overall awards:** director chooses per Event — sum of placement points via a per-Competition placement→points table (default), or sum of converted points.
