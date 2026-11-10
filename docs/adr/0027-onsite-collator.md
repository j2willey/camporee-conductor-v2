---
created: 2026-11-06
updated: 2026-11-06
---

# ADR-0027 — On-site Collator: box, network, HTTPS, judge sync, recovery

Date: 2026-11-06 · Status: Accepted (issue #39; decided by Jim in the Advisor chat, 2026-11-06)

Resolves the Phase 2 items ADR-0023 deferred: on-site box hardware, TLS for phones on the offline LAN, and
judge sync. Also settles score changes after finalization for Judges (ADR-0019) and what the results bundle
carries (ADR-0015). Where each item is built: #40 Collator tracer, #41 Judge app, #42 Officials' tools,
#43 awards and printouts, #45 event-day runbook.

## Box and network

1. **Hardware is undecided; decide by 2027-05-01 at the latest.** No software depends on it: the Collator
   runs on any Linux box with Docker. Mains power (PG&E) is available at the lodge. (#40, #45)
2. **Docker images are amd64 only.** arm64 is a build setting, off by default. (#40)
3. **WiFi only near the lodge** (GL.iNet Opal or equivalent). Covering the whole property is not a goal:
   phones work offline at their Stations and sync when they're back in range. (#41, #45)

## HTTPS

4. **Default, as in 2026:** a Let's Encrypt certificate for `judge.camporeeconductor.com`, issued by DNS-01
   through Cloudflare, plus a local DNS override on the router so phones reach the box by that name with no
   warnings. The hostname and the certificate source are configuration: automatic DNS-01, certificate
   files supplied, or a local CA for development. **Runbook check:** certificate expiry is later than the
   event's end + 7 days. (#40, #45)

## Officials and Judges

5. **Officials are listed in the cartridge, as in v1, and sign in with their email only.** The Director can
   add an Official on site. The list travels in the **event-day** cartridge profile (ADR-0012) only: it is
   not part of the Event document and never goes into a design cartridge or a Template (ADR-0026 keeps
   contacts out of those). (#42; the export side is #8)
6. **Judges have no accounts and no pre-list** (ADR-0023). They identify themselves on the phone, can score
   any Activity, and can switch Activities. ADR-0023's "selects the Challenge they're assigned to" means
   the Judge chooses; nothing enforces an assignment. (#41)

## Phones and syncing

7. **The first load at the lodge caches the whole event:** the app, every Activity's form (with its Common
   Fields, ADR-0020) and the known Teams. The event data refreshes on every sync. (#41)
8. **Offline-first queue, v1's model.** Each score carries an id the phone creates, so resending never
   duplicates it. Phones keep scores the box has acknowledged. (#41)

## Correcting scores

9. **Two Judges score the same Team in the same Activity:** keep both, flag the conflict for Officials, and
   use the newest meanwhile. "Newest" is the order the box received them; the phone's timestamp is kept
   for information only. (#41, #42) _2026-11-10:_ `packages/scoring` now picks the counting entry, and an
   Official resolves a conflict with a logged `choose-entry` (ADR-0019 amendment of that date).
10. **Judge corrections:**
    - **Open Activity:** resubmit freely; every version is kept.
    - **Closed Activity:** a resubmit reopens it and flags it for Officials.
    - **Finalized Activity:** the phone refuses. Changes are logged Official actions only (ADR-0019,
      Finalization amendment). (#41, #42)

## Recovery and after the event

11. **The box backs up to a USB stick every few minutes.** A replacement box loaded with the same cartridge
    rebuilds the scores from the phones as they come back in range (item 8: phones keep acknowledged
    scores, and score ids make resending safe). (#40, #45)
12. **The results bundle (USB, ADR-0015) carries everything home**, Judges included (for thank-you notes).
    What gets uploaded to the cloud Composer is decided later. (#43, #45)

## Consequences

- The Collator needs no hardware decision to be built and rehearsed; the runbook (#45) records the box
  actually used.
- A score's identity is the phone-made id, not (Team, Activity): conflicts and versions are kept, not
  overwritten, and Officials resolve them with logged actions (ADR-0019).
- The box can be lost or replaced mid-event without losing scores, as long as the phones come back in
  range.
- The v1 importer (#46) currently drops a v1 cartridge's Officials ("until #39"). With item 5, a follow-up
  carries them into the event-day cartridge (#8, #42).
