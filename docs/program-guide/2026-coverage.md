# Program Guide: coverage checklist from the 2026 guide

Issue #5. The 2026 Program Guide ("The Circus", 22 pages, for unit leaders and senior youth leaders) is a
**reference, not a parity target**: v2 should be able to hold everything it held, in a sensible order, and
do better where it can. Tests are behavioral; nothing is compared against the 2026 text. The originals stay
private; this outline has no names, contacts, addresses, links or other site details.

Not covered here: the 4-page day-of Short Guide for participants, a separate deliverable.

**Sources** (ARCHITECTURE §18's four tiers, generic names as in `packages/program-guide`): `event` Event
details · `venue` Venue Profile · `organization` Organization Profile (the district/council tier) · `theme`
· **design** = generated from the Event design (Competitions, Activities, Awards).

The 2026 order follows the weekend, so sources interleave rather than group.

| 2026 section                                  | Holds                                                                                                                                                                                                                           | Source                      | v2 section id (slice 1)                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------- |
| Cover                                         | Theme, title, year, venue, dates, audience, draft/final note, last updated                                                                                                                                                      | event, venue, theme         | `cover` (title, theme, year, Organizer; dates and venue stubbed) |
| Introduction: Welcome; Theme                  | Welcome; what to theme (campsite, costumes, campfire acts, challenges)                                                                                                                                                          | organization, theme, event  | `introduction`, `theme`                                          |
| Planning for {Theme} Adventure                | RSVP/interest survey; staffing asks                                                                                                                                                                                             | event, organization         | `planning`                                                       |
| Booking your Itinerary                        | Registration, what the fee covers, adult roster deadline, fee table                                                                                                                                                             | event                       | `registration`                                                   |
| Preparing for {Theme} Adventure               | Health forms, release forms, youth protection, equipment                                                                                                                                                                        | organization                | `preparing`                                                      |
| Friday Agenda                                 | Arrival, drop-off, parking, check-in window and checklist, campsite setup                                                                                                                                                       | venue, event                | `day-1`                                                          |
| Saturday Agenda                               | Leaders' meeting, flags; **Patrol Games** (how they run, skills tested); game support and proposals; **Troop Challenges**; **Exhibition Events**; campfire; honor-society call-out                                              | design, organization, event | `day-2`, `skills`, `competition-*`, `evening-program`            |
| Sunday Agenda                                 | Clean-up, closing ceremony, **awards**, other prizes, check-out, participant patch                                                                                                                                              | design, organization, event | `day-3`, `awards`                                                |
| Honor-society staff and candidate recognition | Volunteer staffing, elections                                                                                                                                                                                                   | organization                | `staff-and-recognition`                                          |
| Communications                                | Registration website, key contacts, roundtables, on-site bulletin board                                                                                                                                                         | event, organization         | `communications`                                                 |
| {Theme} Support                               | Volunteer ask                                                                                                                                                                                                                   | organization                | `support`                                                        |
| General Information and Requirements          | Weather, spirit, team size, uniform, courtesy, fires, water and food, sanitation, lost and found, phones, trash, wildlife and hazards, preservation, restricted and prohibited items, restricted areas, trading post, first aid | organization, venue         | `general-information`                                            |
| Emergency Evacuation                          | Muster point and procedure                                                                                                                                                                                                      | venue, organization         | `emergencies`                                                    |
| Appendix: Theme Ticklers                      | Theme in popular culture; notable personalities                                                                                                                                                                                 | theme                       | `theme-ticklers`                                                 |
| Tentative Schedule                            | Schedule grid, pasted as an image                                                                                                                                                                                               | event                       | `schedule` (stub; images need #7)                                |
| Directions                                    | Coordinates, distance, turn-by-turn routes                                                                                                                                                                                      | venue                       | `directions`                                                     |
| Index                                         | Contents with page numbers                                                                                                                                                                                                      | generated                   | table of contents (no page numbers yet)                          |

## Per Activity, what the 2026 guide gave units

- **Patrol Games:** no game names, only how the games run and a list of 12 skills tested. The guide
  publishes before games are final → `listActivities: false` and the Event's authored `skills` list.
- **Troop Challenges:** a short write-up per challenge group (campsite ×3, cooking ×3, pioneering,
  sporting). Slice 1 lists them one per line; grouping comes later.
- **Exhibition Events:** a table of theme name and type.

The 2024 guide instead listed each game with a type, a "Skills" line and a "Legend" paragraph (the
Activity's `story`), which is why listing is a per-Competition setting.

## What generating the guide fixes

The 2026 guide mis-described Top Dog (as a patrol point average; it is the top 25% of Troops by ranking).
It also had two different registration links, a cover date a year off from the page footers, a broken
cross-reference, a stale schedule date, and index page numbers off by one. Generated text comes from one
source, so these can't drift.
