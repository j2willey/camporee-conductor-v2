# Camporee Conductor v2

Camporee Conductor runs **station-based team competitions**: Teams rotate through Stations to
take part in Activities (games, challenges, exhibitions), volunteer Judges score them on their phones
(no accounts), and scores roll up into Standings, Awards and an Announcer script. It also covers
designing those events, sharing Templates, and planning artifacts such as the Program Guide
([ADR-0001](docs/adr/0001-product-core-scope.md)).

Code and data use a **generic vocabulary** (Event, Team, Activity, Competition, Division, …).
Scouting words (Camporee, Troop, Patrol, Scout) come from the default **Terminology Pack**, so the
same product works for schools, camps and corporate team-building
([ADR-0003](docs/adr/0003-generic-vocabulary-terminology-packs.md)).

## Status

**Design done. Phase 1 in progress.** The first target is the Coyote Creek Camporee, May 14–16, 2027.

- Glossary: [CONTEXT.md](CONTEXT.md)
- Design decisions: [docs/adr/](docs/adr/README.md)
- Phase 1 slice order: [ADR-0024](docs/adr/0024-phase1-slice-order.md)

## Predecessor

v2 is a full rewrite of [Camporee Conductor v1](https://github.com/j2willey/camporee-conductor),
which ran the Coyote Creek Camporee 2026 (the Circus 2026 event). v1's data model and lessons carry
over to v2. Its code does not ([ADR-0005](docs/adr/0005-full-rewrite-new-repo.md)).

## License

[MIT](LICENSE)
