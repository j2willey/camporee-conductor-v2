# Events

One folder per event designed in v1's Composer and imported into v2 (issue #46), e.g.
`events/coyote-creek-2027/`. Each holds only that event's **`overlay.json`**: the v2-only design choices
v1 can't express (Awards, primary metrics, Program Guide settings), applied after every import.

**The v1 cartridge itself never goes in this repo** until after the event: game designs are unpublished
until then. Keep the zip outside the repo and pass its path to the importer:

```sh
pnpm --filter @camporee-conductor/composer-api import-v1 <org-slug> ~/path/to/cartridge.zip \
  --overlay events/coyote-creek-2027/overlay.json
```

Re-run it after every design change in v1; ids are stable, so documents are updated, not duplicated.
Skipped games (unfinished, or disabled in the v1 playlist) are printed with `!! SKIPPED`. For the final
import before the event, add `--strict` so any skip refuses the import.

The format is `V1OverlaySchema` in `packages/cartridge/src/v1/overlay.ts`. The Circus 2026 overlay
(`packages/schema/fixtures/circus-2026/overlay.json`) is a full example; its Common Field corrections are
for Circus 2026 only, so a new event fixes its v1 presets instead.

## Awards to carry into a new event's overlay

v1 has no Awards, so **an event's Awards exist only in its overlay**. Leave them out, and the Awards page, the
stickers, the announcer script and the awards CSV lose them. For **`events/coyote-creek-2027/overlay.json`**, copy
the two from the Circus 2026 overlay's `awards`, and change the Competition slugs if 2027's differ:

- **Overall** (`places`, 1st–3rd) on the Patrol Competition: the overall Patrol 1st, 2nd and 3rd from the
  Standings.
- **Top Dog** (`top-percent`, 25) on the Troop Competition, with `replacesGame` naming v1's Top Dog game, so that
  game isn't also imported as an Activity. Top Dog is the top 25% of Troops by overall rank. A Troop with 0 points
  never gets it, and no-shows still count toward the 25% (ADR-0019).
