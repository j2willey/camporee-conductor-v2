---
created: 2026-10-25T12:38
updated: 2026-11-11
---

# ADR-0024 — Phase 1 slice order (Program Guide moved up)

Date: 2026-10-25 · Status: Accepted

1. Repo, CI, docs moved in
2. Domain schemas (v4) + v1 cartridge importer (Circus 2026 as fixture)
3. Scoring package (conversions, rankings, common fields), test-first against real Circus scores
4. Composer shell: Clerk sign-in, Organizations, event list
5. **Program Guide** (needs only read access to an imported event; April 1 is the external deadline)
6. Challenge + Competition/Division editing
7. Assets + template library
8. Cartridge export (incl. v1-compatible fallback)

## Note 2026-11-11: Composer + Curator parity comes first

Jim set full v1 parity (Composer and Curator) before 2026-11-26, and 2027 is designed in v2's Composer. Items 6
and 7 become the parity plan: #98 (ADR-0029/0030/0031) → #6 editor → #99 Common Fields → #100 Event lifecycle and
Officials → #101 members → #102 Curator → #103 AI → #104 admin. The asset store (#7) is `later`. The rest of the
Program Guide (#5) follows parity.
