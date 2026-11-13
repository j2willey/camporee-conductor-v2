---
created: 2026-11-11
updated: 2026-11-12
---

# ADR-0030 — AI assistance in the Composer

Date: 2026-11-11 · Status: Accepted (issue #98; decisions by Jim, 2026-11-11)

## Context

v1's Composer had four AI features (`src/lib/ai-provider.js`): test the API key, brainstorm an Event theme, theme
one game with a before/after comparison, and an "AI update" with a free-text prompt and undo. v1 defaulted to
Gemini, with Claude optional. ADR-0010 makes Claude primary and keeps AI off the event-day path. #103 (G in the
parity plan) brings the four features to v2.

## Decision

1. **Claude Sonnet, behind a small provider adapter** in the Composer API. The model comes from an environment
   variable (`AI_MODEL`, Sonnet by default). Another provider (Gemini) can be added behind the same adapter later.
2. **The key is server-side only:** `ANTHROPIC_API_KEY` on the droplet, beside the Clerk keys. It's never sent to
   the browser and never put in a document or a cartridge. With no key set, the AI buttons are hidden and nothing
   else changes.
3. **AI output is a proposed document, never a save.**
   - The API returns a proposed Event or Activity, validated by the same schema as a save (ADR-0029).
   - The UI shows the change as a diff. The editor accepts it or throws it away.
   - Accepting is an ordinary save: the `If-Match` check applies and it writes an audit row (action marked as AI).
     Undo restores the version from before the accept.
4. **What it may change** (amended 2026-11-12, #103, for v1 parity: v1's `theme-game` prompt let the model reword
   scoring inputs):
   - the design text of the Event or Activity being edited: the Event's theme, title and `introduction` (added
     2026-11-12 for v1's Introduction brainstorm, Jim), and the Activity's title and `content`;
   - **plus the wording of the Activity's own scoring fields:** each field's `label` and `config.placeholder`.
     (v1 also reworded a field's description; v2's fields have none. If one is added, it joins this list.)

   Everything else is refused: field ids, `type`, `kind`, `audience`, `sortOrder`, `weight`, `required`, `min`/`max`,
   `defaultValue`, `options`, the primary metric and its direction, adding, removing or reordering fields, Common
   Fields, Competitions, Awards, Officials and contacts. The API enforces it as a **structural diff against the
   current document**: only the allowed paths may differ. One pure function does it, with a test for each allowed
   and each refused path.

5. **No personal data is sent to the provider.** Prompts carry the Activity or Event design only, never contacts,
   Officials or anything from a roster (ADR-0026, ADR-0031 rule 4).
6. **Composer only.** The Collator never imports the adapter, and a dependency check in CI keeps it that way
   (ADR-0010, CLAUDE.md rule 8).
7. **Tests use a fake provider.** CI makes no network calls. A sysadmin's "test the key" action is the only live
   check.

## Consequences

- Nothing AI-written reaches an Event without a person accepting it, and the audit log shows which saves came
  from AI.
- Undo is free: it's the version history the editor already has.
- The model can change without a code change. The cost is an extra environment variable to keep in the deploy
  runbook.
- Second on the `later` list if #6 slips past about 2026-11-19: "AI update with a prompt" (#103 PR 4).

## Notes

**Provider and key test (#103 PR 1, 2026-11-12).**

- **The adapter** (`apps/composer-api/src/ai/`) has one method: a system prompt and a user prompt in, text out. The
  Anthropic one uses the official SDK (`@anthropic-ai/sdk`). `AI_MODEL` defaults to `claude-sonnet-5-5`. A
  declined request (`stop_reason: "refusal"`) is an error the editor sees, never a proposal.
- **No key, no AI:** without `ANTHROPIC_API_KEY`, the API has no provider, `/api/me` says `ai: false`, the AI routes
  answer 404, and the buttons are hidden.
- **"Test the key" is a CLI for now:** `pnpm --filter @camporee-conductor/composer-api test-ai-key`, run on the
  droplet by whoever has the shell, which is the sysadmin today. H (#104) builds the sysadmin pages; its admin page
  can call the same function. It sends one tiny request and prints the model's answer or the error, never the key.
- **The dependency check** is a test in each Collator app: no `@anthropic-ai/*` package and no import of the Composer
  API, in `package.json` or in `src/`.

**Brainstorm (#103 PR 2, 2026-11-12).** Jim chose both: the issue's theme ideas, and v1's Introduction brainstorm.

- **Theme ideas:** a few themes for the Event, each with a line on why it fits; pick one to set `theme`.
- **Introduction options** (v1's `brainstorm-theme`): from the theme, three welcome texts for the Program Guide:
  action-oriented, lore-heavy and skill-focused. Pick one to set `introduction`. It needs a theme first, as in v1.
- Both take an optional "refine" instruction, as v1 did, and answer as JSON in a schema (structured outputs), checked
  with Zod. An answer that doesn't fit is an error, never a guess.
- **The prompt** carries the Event's title, year, theme, the pack's words for its people, and its Competitions' and
  Activities' names. Never contacts, Officials, the organizer's name or the venue (item 5).
- **Accepting** goes through `PUT /api/events/:id/ai`: the proposed Event, the feature, and `If-Match`. The structural
  diff (item 4, `ai/allowed-changes.ts`) runs against the stored Event first, then the same checks as any save. The
  audit row's detail names the feature (`{ ai: "theme" }`). Editors and owners only, for asking as for accepting: a
  request costs money.
- The pick is accepted on its own, not mixed into unsaved edits: the AI buttons wait until the page has no unsaved
  changes.
