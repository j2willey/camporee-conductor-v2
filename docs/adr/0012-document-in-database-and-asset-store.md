---
created: 2026-10-25T12:12
updated: 2026-10-25T12:12
---

# ADR-0012 — JSON documents stored in the database; media in a content-addressed asset store

Date: 2026-10-25 · Status: Accepted (asset-store detail proposed, pending Jim's confirmation); profiles amended 2026-11-06
**Decision:** Events, Challenges, Templates are JSON documents in the exact cartridge shape, validated by JSON Schema, stored in a DB JSON column plus a few indexed fields (id, owner, title). Cartridge export = zip of documents; import = validate + insert.
Media (images now; audio/video possible for digital Program Guides) live outside the DB in a content-addressed store (`assets/<sha256>.<ext>`), on droplet disk now, S3-compatible (e.g., DO Spaces) later. DB holds asset metadata (hash, mime, size, alt text, owner, credit/license). Documents reference assets by id, never embed bytes.
Cartridge profiles: **event-day** (documents + assets judges/officials need) vs **full template** (everything, incl. Program Guide media).
**Why:** atomic saves, cross-event queries, one store for content + permissions; keeps JSON-as-truth semantics. Blobs in SQLite bloat DB and Litestream, and can't serve video range requests. Content addressing = dedupe across forks, immutable, cacheable. Carries forward v1 ARCHITECTURE §17 (bundled assets, offline-first, zip atomicity).

## Amendment 2026-11-06 (issue #8): the profiles are `design` and `event-day`; the cartridge format

- **Profile names.** "full template" is renamed **`design`**: the Event's design, everything the Composer and
  Templates need (including Program Guide media once assets exist). "Template" stays the name of its own
  document kind (ADR-0017). **`event-day`** is what the Collator loads: the design plus the Event's
  **Officials** document (ADR-0027 item 5), and only the assets Judges and Officials need.
- **Officials** are a separate document per Event (`kind: "officials"`: email, optional name, director or
  official), never part of the Event. Only an event-day cartridge carries them; a design cartridge or a
  Template never does (ADR-0026). An event-day cartridge needs at least one Director.
- **Layout.** One zip: `manifest.json`, `event.json`, `common-fields.json`, `activities/<slug>.json`,
  `officials.json` (event-day only), `assets/<sha256>.<ext>` (once there are assets). Documents are exactly as
  stored.
- **Manifest and versions.** `manifest.json` names the format (`camporee-conductor-cartridge`), its
  `formatVersion` (the zip layout and manifest, now 1), the documents' `schemaVersion`, the profile, the Event
  (id, slug, title), `exportedAt`, and every file with its sha256. Readers refuse a format or version they
  don't know, and a cartridge whose files don't match the manifest (all or nothing).
- **One rule set.** The Composer's import and the Collator's load check an Event bundle with the same function
  (`checkEventBundle` in `packages/cartridge`); the Collator loads with `loadCartridge`.
- **Access.** Any member can download the design cartridge; the event-day cartridge (Officials' emails) is for
  editors and owners only.
