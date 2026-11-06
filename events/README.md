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
