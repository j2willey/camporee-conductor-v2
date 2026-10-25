---
created: 2026-10-25
updated: 2026-10-25T12:25
status: design — grilling in progress
---
# Conductor v2 — Domain Context

> Living glossary for the v2 rewrite. Code and schema use the **generic** terms;
> audience-specific words come from a **Terminology Pack** (UI labels only).
> Decisions behind these terms live in [`docs/adr/`](docs/adr/README.md) (moved from the Obsidian vault per ADR-0005).

## Product core
Teams rotate through Stations to attempt Challenges; volunteer Judges score them on phones;
scores roll up into Standings, Awards and an Announcer script. Plus: designing events, sharing
Templates, and planning artifacts (Program Guide, Rosters w/ contacts). Scope may grow toward
"event-management-lite" over time (ADR-0001).

## Glossary
| Term | Meaning | Scouting pack | School / corporate |
|---|---|---|---|
| **Event** | One occurrence, with dates and venue | Camporee | Field Day / Offsite |
| **Organizer** | Person/org running the Event | Camporee Director / District | Teacher / HR |
| **Group** | Optional parent of Teams | Troop | Class / Department |
| **Team** | The unit that competes at Challenges | Patrol | Team |
| **Participant** | Individual member | Scout | Student / Employee |
| **Challenge** | A scored activity (definition) | Game | Challenge |
| **Station** | Physical place a Challenge runs | Station / Area | Station |
| **Competition** | A ranking pool of Challenges + entrants (was v1 "League") | Patrol Games, Troop Competitions | — |
| **Division** | A subset of a Competition's entrants ranked only against each other; same Challenges | Older/Younger patrols | Grade bands |
| **Judge** | Scores at a Station on a phone; no account | Judge | Judge |
| **Official** | Manages scores/results during the Event | Staff | Staff |
| **Template** | Shareable, localizable Event or Challenge | — | — |
| **Cartridge** | Portable zip-of-JSON export of an Event design | — | — |
| **Terminology Pack** | Label set mapping generic terms to an audience | Scouting (default) | School, Corporate |
| **Asset** | A media file (image, audio, video) stored once by content hash, referenced from documents by id | | |
| **Results Bundle** | Post-event export from the Collator back to the Composer | | |
| **Organization** | Owns Events, Venue/Council Profiles, private Templates; users are members | District / Council | School / Company |
| **Conversion** | Official-defined rule turning a metric (count, time) into points; direction configurable | | |
| **Provisional Ranking** | Teams sorted by point total within a Division | | |
| **Final Ranking** | Official-confirmed placements; may differ from provisional at Official discretion | | |
| **Common Field** | Scored item defined once per Competition, applied to every Challenge at runtime | Patrol Yell, Flag, Scout Spirit | |

## Rules captured
- Division: set by an Official at registration, changeable later; placements per Division; overall-award scope and which tiers divide are director choices (ADR-0007).
- Composer = cloud with accounts; Collator = on-site/offline (ADR-0009).

- Cartridge = interchange format; JSON documents (same shape) stored in the DB are the truth (ADR-0012). Profiles: event-day vs full template.
