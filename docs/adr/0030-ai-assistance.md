---
created: 2026-11-11
updated: 2026-11-11
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
4. **What it may change:** only the design text of the Event or Activity being edited (theme, title, `content`).
   It never changes scoring fields, Competitions, Awards, Officials or contacts. The API checks this: a proposal
   that changes anything else is refused.
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
