---
created: 2026-10-25T11:33
updated: 2026-10-30
---

# ADR-0003 — Generic domain vocabulary; Scouting is a Terminology Pack

Date: 2026-10-25 · Status: Accepted, amended 2026-10-30 (see below)
**Decision:** schema and code use generic terms (see CONTEXT.md glossary); Scouting labels are the default pack. Group is optional. Competition replaces v1 "League". Divisions within a Competition are first-class (e.g., 40 patrols: 10 older-scout patrols rank only among themselves, 30 younger patrols among themselves, all playing the same Challenges).
**Why:** opens schools, camps, corporate team building without forking; v1 already had a cosmetic `terminology` layer — v2 makes generic the real model.

## Amendment 2026-10-30 (issue #2): Challenge → Activity; what Terminology Packs relabel

**Activity replaces Challenge as the generic code term.** An Activity is anything that happens at a
Station. v1 had three kinds, confirmed from Circus 2026 data:

- **Patrol Games** (18): patrol-level, ranked, count toward Top Patrol.
- **Troop Challenges** (12): troop-level, ranked, count toward Top Dog.
- **Exhibition Events** (4): individual recognition only; never count toward team standings (v1 kept
  them in a separate `exhibition_results` table).

v2 models all three as an Activity with a **scoring type**: `ranked` or `exhibition`. The words shown on
screen ("Games", "Challenges", "Exhibitions") come from the Competition's labels, not from the code.
Earlier ADRs that say "Challenge" should be read as "Activity".

**Terminology Packs relabel only the participant hierarchy and the event name.** For example
Troop/Patrol/Den/Class/Team/Department/Cohort, and Camporee/Field Day. Activity-side terms (Games,
Challenges, Exhibitions, Division, Rules, Instructions, Scoring) stay the same across audiences.

**Why:** "Challenge" was both the generic term and one of v1's three real kinds, which made it ambiguous.
The activity-side words already work for schools and corporate events; only who competes and what the
event is called differ by audience.
