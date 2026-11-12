---
created: 2026-11-11
updated: 2026-11-11
---

# ADR-0031 — The Curator: a library of Templates and Activities

Date: 2026-11-11 · Status: Accepted (issue #98; decisions by Jim, 2026-11-11). Extends ADR-0017.

## Context

v1 had two libraries:

- a **game library** (a folder of game JSON plus `library-catalog.json`), with "add to Event" and "save to
  library" in the Composer;
- the **Curator's Templates** (Event zips, which only a sysadmin could upload), with a catalog, a preview, "new
  Event from Template", a zip download, and a Template editor that copied the game editor.

ADR-0017 kept the Phase 1 library minimal, but modeled lineage from day one. Jim's parity target (2026-11-26)
needs the whole of v1's Curator. #102 (F in the parity plan) builds it.

## Decision

1. **The library is documents.** Templates (`kind: "template"`, Event-shaped, ADR-0017) and Activities, stored in
   the `documents` table like everything else (ADR-0012), with generic vocabulary (CLAUDE.md rule 1).
2. **Visibility is a storage column, not document content:** `private` (the owning Organization only) or `library`
   (everyone signed in can see it and use it). A cartridge never says whether its documents are published, so
   rule 5 holds.
3. **The curation gate:** only a **curator** (a user flag, set by a sysadmin, #104) publishes to or unpublishes from
   the library. Anyone can keep private Templates and Activities in their Organization. Community submission and
   a review queue stay Phase 3 (ADR-0017).
4. **Personal data never leaves an Event's own cartridges.** Contacts are personal data, like Judges' and
   Officials' emails. They are stripped from **every export except the Event's own design and event-day
   cartridges**: Templates, library documents, single-Activity exports, and any future demo data. Officials and
   roster data never appear there either (ADR-0026). One function in `packages/cartridge` does the stripping, and
   every such path calls it, with a test for each path.
5. **Use means fork, with lineage.**
   - "New Event from Template" and "add a library Activity" copy the documents into the user's Organization
     with new ids.
   - The copies carry `lineage` (Event → parent Template, Activity → parent Activity, plus external attribution,
     ADR-0017).
   - Later changes to the source don't flow into copies.
6. **One editor.** Library documents are edited in the Composer's own editor (ADR-0029). Curators can edit
   library documents; an Organization's editors can edit its private ones. There's no second Template editor
   (v1's `curator.js` copied the game editor).
7. **Template zip download** is a design cartridge of the Template (ADR-0012 format), after the rule 4 strip.
8. **Assets by id once they exist** (CLAUDE.md rule 6). The asset store is #7, `later`: v1's image upload never
   worked (its client posts to a route v1's server doesn't have), so parity doesn't need it.
9. **Not parity:** v1's offline maintenance scripts (`curate_library.js`, `auto_tag_library.py`, `templatize.js`).
   AI Templatize stays Phase 3 (ADR-0017).

## Consequences

- One storage model, one validator and one editor for Events, Templates and the library.
- Forking means a fix to a library Activity doesn't reach Events already made from it. That's deliberate, and
  lineage shows where a copy came from.
- If #6 slips past about 2026-11-19, the curation gate (#102) is third on the `later` list. A library without a
  gate is still usable while Jim is its only curator.

## Notes

**The catalog (#102 PR 2, 2026-11-12).**

- The catalog lists the library, plus the caller's Organizations' own private Templates and **saved** Activities.
  A saved Activity is one that no Event or Template in its Organization lists: it's kept for reuse. An Activity a
  private Template lists belongs to that Template, so it isn't listed on its own.
- A tag filter ignores case, surrounding spaces and a leading `#` (Circus 2026's tags are `#knots`…). Storing tags
  normalized is PR 3.
- **Previews.** A Template previews as its Program Guide. An Activity previews as its guide (ADR-0028), numbered
  and labelled by a Template in its Organization that lists it; otherwise it's shown on its own, with no number,
  v1's default colors and no other Event's name, so a preview never shows a private Event.

**Activities to and from the library (#102 PR 3, 2026-11-12).**

- **Save to library** forks an Activity into its own Organization as a saved, private Activity, with
  `lineage.parentId`. The original stays in its Event. A curator then publishes the copy from the Library page.
- **Add from library** forks any Activity the caller's catalog shows (a library one, or their Organization's own
  saved one) into a Competition of the Event, last in it, with `lineage.parentId` and no `legacy`. It's an Event
  change, with the Event's If-Match, like adding or importing an Activity.
- **Tags** are normalized by one function, `normalizeTags` in `packages/schema`: trimmed, lowercased, without
  duplicates or blanks, in their first order. A leading `#` stays (the catalog's tag filter ignores it). Every fork
  (save to library, add from library, import) normalizes, and so does the Activity editor when it saves. A save
  through the API is still stored exactly as sent (CLAUDE.md rule 5).
