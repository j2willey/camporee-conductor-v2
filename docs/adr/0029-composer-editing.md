---
created: 2026-11-11
updated: 2026-11-11
---

# ADR-0029 — How the Composer edits documents

Date: 2026-11-11 · Status: Accepted (issue #98; decisions by Jim, 2026-11-11)

## Context

Jim set full v1 parity for the Composer and the Curator before Thanksgiving (2026-11-26). Camporee 2027 will be
designed in v2's Composer, not v1's. Today the v2 Composer is read-only: Events come in only through the CLI
(`import-event`, `import-v1`). v1 saved a whole workspace at once, and asked "overwrite?" when the server's copy
had changed. Issue #6 (B in the parity plan) builds the editor; #99, #100, #101 and #102 build on its write API.

## Decision

1. **One write route per document kind.** A `PUT` sends the whole document (Event, Activity, Common Field set,
   Officials, Template). The API validates it with the same Zod schemas and the same `checkEventBundle` as import
   and the Collator's load. There's no DB-only shape and no partial-patch format (ADR-0012, CLAUDE.md rule 5).
2. **Stale saves are refused, never merged.** The client sends `If-Match: <updatedAt>` from its last read. If
   the stored document is newer, the API answers 409, and the UI says someone else saved and offers a reload.
   This replaces v1's "overwrite?" dialog.
3. **Who writes:** an Organization's owners and editors. Viewers read everything and save nothing. Per-Event
   outside co-directors (ADR-0021) are later. Organization roles plus pending invites (#35, in #101) are parity.
4. **The web app** uses TanStack Query mutations and plain controlled React forms, with no form library. Saving
   is explicit, per pane, not on every keystroke. A pane with unsaved changes says so, and warns before you
   leave it.
5. **An audit log starts with the first write route:** an `audit_log` table holding when, who (user id), the
   Organization, the action, the document's kind and id, and a small JSON detail (no document bodies). Every
   save, create, delete, import, publish and accepted AI change writes a row. The view is #104 (H). It's the
   first item to move to `later`, but the table isn't.
6. **The scoring preview uses the judge's real form.** The judge page's form (`apps/collator-web/src/screens/ScoreForm.tsx`
   and `form.ts`) moves into a shared workspace package in **its own PR with no behavior change**. The judge e2e
   tests and the drones must stay green, and the PR body says "no behavior change". Only after that does the
   Composer's preview use it. The judge page is the Collator's core feature; a Composer preview must not change
   it as a side effect.
7. **Schema additions go end to end,** in one PR each:
   1. failing tests first in `packages/schema`, then regenerate `json-schema/`;
   2. `import-v1` carries the field, with a test on the Circus 2026 v1 source (nothing is dropped silently);
   3. regenerate the Circus fixtures (`transcode-circus-2026.ts`), and say what changed in TRANSCODE-NOTES;
   4. the exports, the Collator's load and the generated pages handle the field.
8. **New Event fields for parity (v1's Event metadata):** `venue {name, address}`, `introduction` (Markdown,
   rendered with the ADR-0028 subset) and `contacts [{role, name, email, phone}]`. They're plain Event fields.
   Venue and Organization Profiles (ADR-0021) come later. **Contacts are personal data** (ADR-0031 rule 4).
9. **`enabled` on the Event's Activity list** (`activities[].enabled`, default true), v1's per-game switch:
   - **Disabled Activities are left out of the event-day cartridge,** so the Collator never sees them.
   - **They're also left out of the Program Guide.**
   - They stay in the design cartridge and on the Composer's Activity list, and the Activity guides picker shows
     them marked "disabled".
10. **Build order:** #6's PRs land in order. #99, #100 and #101 start only after #6's first PR (the write API) is
    merged, and may then run in parallel worktrees. Jim's UI review is the bottleneck, so every UI PR's body has
    short "try it" steps, rebuild and restart included.
11. **Dropped from v1:** the no-server "local mode" (v2 is cloud only, ADR-0009). Bracket mode is out of parity
    (#105, `later`).

## Consequences

- Concurrent editors can't lose each other's work. The cost is the occasional reload.
- Saving the whole document keeps one validation path for import, edit and load, at the cost of sending a few
  kilobytes more per save.
- The shared judge form makes the preview exact, and it puts the judge page's form under the Composer's tests
  too.
- ADR-0024's slice order: Composer + Curator parity (#98 → #6 → #99 → #100 → #101 → #102 → #103 → #104) now comes
  before the rest of the Program Guide (#5).
