---
created: 2026-10-25T12:12
updated: 2026-10-25T12:12
---

# ADR-0012 — JSON documents stored in the database; media in a content-addressed asset store

Date: 2026-10-25 · Status: Accepted (asset-store detail proposed, pending Jim's confirmation)
**Decision:** Events, Challenges, Templates are JSON documents in the exact cartridge shape, validated by JSON Schema, stored in a DB JSON column plus a few indexed fields (id, owner, title). Cartridge export = zip of documents; import = validate + insert.
Media (images now; audio/video possible for digital Program Guides) live outside the DB in a content-addressed store (`assets/<sha256>.<ext>`), on droplet disk now, S3-compatible (e.g., DO Spaces) later. DB holds asset metadata (hash, mime, size, alt text, owner, credit/license). Documents reference assets by id, never embed bytes.
Cartridge profiles: **event-day** (documents + assets judges/officials need) vs **full template** (everything, incl. Program Guide media).
**Why:** atomic saves, cross-event queries, one store for content + permissions; keeps JSON-as-truth semantics. Blobs in SQLite bloat DB and Litestream, and can't serve video range requests. Content addressing = dedupe across forks, immutable, cacheable. Carries forward v1 ARCHITECTURE §17 (bundled assets, offline-first, zip atomicity).
