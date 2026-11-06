---
created: 2026-10-25T11:50
updated: 2026-11-06
---

# ADR-0006 — Phased delivery with v1 as fallback

Date: 2026-10-25 · Status: Accepted, fallback amended 2026-11-06 (see below)
**Decision:** Phase 1 = event design in the generic model (Challenges, Competitions/Divisions, rosters, templates), Circus 2026 import from a v1 cartridge, Program Guide generation. Phase 2 = on-site Collator box, judge PWA with offline scoring, officials' tools, results/awards/announcer. Phase 3 = cloud Collator, AI design agent, other districts.
Hard dates: design side by end of Jan 2027 (Program Guide out before Apr 1); Phase 2 by ~Apr 15 dress rehearsal. Jim's own estimate from the cc-eagle-tracker experience: done by Christmas, possibly Thanksgiving.
**Fallback:** ~~v2 can export a v1-compatible cartridge so v1 can run the May 2027 event if Phase 2 slips.~~ See the amendment.

## Amendment 2026-11-06 (issue #8): the fallback is v1 end to end

2027 is designed in v1's Composer and imported into v2 (#46), so the fallback no longer needs v2 to write a
v1 cartridge: if v2's Collator isn't ready, **v1's Collator runs v1's own cartridge**, as at Circus 2026. The
v1-compatible export is dropped from #8.

Running v1 end to end means v1's behavior, with these limits:

- **v1 scoring.** None of the v2 overlay applies (#46): no Awards (Top Dog is a v1 game, scored as v1 scores
  it), no primary metrics, no v2 Program Guide settings. ADR-0019's Official actions, Finalization and tie
  numbering are v2-only too.
- **The announcer sheet.** In 2026, v1's announcer sheet ignored manual ranks. **Officials must cross-check
  the announcer sheet against the award stickers** before the ceremony.
- v1 must stay deployable until v2 passes the dress rehearsal (~2027-04-15), as decided above.
