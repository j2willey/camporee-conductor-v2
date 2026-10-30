---
created: 2026-10-25
updated: 2026-10-30
status: design confirmed; amended 2026-10-30 (issue #2)
---

# Conductor v2 — Domain Context

> Living glossary for the v2 rewrite. Code and schema use the **generic** terms;
> audience-specific words come from a **Terminology Pack** (UI labels only). Packs relabel only the
> participant hierarchy and the event name; Activity-side words are the same for every audience (ADR-0003).
> Decisions behind these terms live in [`docs/adr/`](docs/adr/README.md) (moved from the Obsidian vault per ADR-0005).

## Product core

Teams rotate through Stations to take part in Activities; volunteer Judges score them on phones;
scores roll up into Standings, Awards and an Announcer script. Plus: designing events, sharing
Templates, and planning artifacts (Program Guide). Rosters with contacts are kept by the Collator,
not the design side (ADR-0026). Scope may grow toward "event-management-lite" over time (ADR-0001).

Three pillars (ADR-0026): **Curator** (Template library), **Composer** (event design, cloud),
**Collator** (event-day runtime + judge PWA, on-site/offline).

## Glossary

| Term                    | Meaning                                                                                                                    | Scouting pack                                                      | School / corporate  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| **Event**               | One occurrence, with dates and venue                                                                                       | Camporee                                                           | Field Day / Offsite |
| **Organizer**           | Person/org running the Event                                                                                               | Camporee Director / District                                       | Teacher / HR        |
| **Group**               | Optional parent of Teams                                                                                                   | Troop                                                              | Class / Department  |
| **Team**                | The unit that competes at Activities                                                                                       | Patrol                                                             | Team                |
| **Participant**         | Individual member                                                                                                          | Scout                                                              | Student / Employee  |
| **Activity**            | Anything that happens at a Station (was "Challenge"); has a scoring type                                                   | — (named by its Competition's labels: Game, Challenge, Exhibition) | same                |
| **Scoring type**        | `ranked` (counts toward team standings) or `exhibition` (individual recognition only)                                      | —                                                                  | —                   |
| **Station**             | Physical place an Activity runs                                                                                            | Station / Area                                                     | Station             |
| **Competition**         | A ranking pool of Activities + entrants (was v1 "League"); its labels name its Activities on screen                        | Patrol Games, Troop Challenges, Exhibition Events                  | —                   |
| **Division**            | A subset of a Competition's entrants ranked only against each other; same Activities                                       | Older/Younger patrols                                              | Grade bands         |
| **Judge**               | Scores at a Station on a phone; no account                                                                                 | Judge                                                              | Judge               |
| **Official**            | Manages scores/results during the Event                                                                                    | Staff                                                              | Staff               |
| **Template**            | Shareable, localizable Event or Activity                                                                                   | —                                                                  | —                   |
| **Cartridge**           | Portable zip-of-JSON export of an Event design                                                                             | —                                                                  | —                   |
| **Terminology Pack**    | Label set for the participant hierarchy and event name                                                                     | Scouting (default)                                                 | School, Corporate   |
| **Asset**               | A media file (image, audio, video) stored once by content hash, referenced from documents by id                            |                                                                    |                     |
| **Results Bundle**      | Post-event export from the Collator back to the Composer                                                                   |                                                                    |                     |
| **Organization**        | Owns Events, Venue/Council Profiles, private Templates; users are members                                                  | District / Council                                                 | School / Company    |
| **Conversion**          | Official-defined rule turning a metric (count, time) into points; direction configurable                                   |                                                                    |                     |
| **Provisional Ranking** | Teams sorted by point total within a Division                                                                              |                                                                    |                     |
| **Final Ranking**       | Official-confirmed placements; may differ from provisional at Official discretion                                          |                                                                    |                     |
| **Common Field**        | Scored item defined once per Competition, applied to every Activity at runtime                                             | Patrol Yell, Flag, Scout Spirit                                    |                     |
| **Common Field set**    | Document holding a set of Common Fields (replaces v1 `presets.json`)                                                       |                                                                    |                     |
| **Weight**              | Per-field score multiplier; design default on the Activity (1 = none), event-day changes logged on the Collator (ADR-0019) |                                                                    |                     |
| **Roster**              | Groups, Teams, Participants and contacts for one Event; Collator-only, never in a design cartridge (ADR-0026)              |                                                                    |                     |
| **Curator**             | Pillar: the Template library (browse, preview, share)                                                                      |                                                                    |                     |
| **Composer**            | Pillar: event design and Program Guide; cloud, with accounts                                                               |                                                                    |                     |
| **Collator**            | Pillar: event-day runtime + judge PWA; on-site, offline                                                                    |                                                                    |                     |

## Rules captured

- Division: set by an Official at registration, changeable later; placements per Division; overall-award scope and which tiers divide are director choices (ADR-0007).
- Composer = cloud with accounts; Collator = on-site/offline (ADR-0009).
- Rosters live only in the Collator (ADR-0026).
- Activity kinds are a scoring type, not separate document types; on-screen names come from Competition labels (ADR-0003).
- Cartridge = interchange format; JSON documents (same shape) stored in the DB are the truth (ADR-0012). Profiles: event-day vs full template.
