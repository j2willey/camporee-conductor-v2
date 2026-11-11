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
   _2026-11-10 (#42 PR 5):_ **adding an Official on site** is a command on the box's console, with no sign-in:
   physical access to the box is the trust (Jim, 2026-11-06). It's the fix for a mistyped Director email in the
   cartridge. Officials added there are kept in their own append-only log on the box (email, name, role, when),
   tied to the loaded Event, and laid over the cartridge's list. The cartridge's `officials` document stays
   exactly as loaded (ADR-0012). For the same email, the newest addition wins, so adding an email again
   updates its name or role. There's no removal: an Official added by mistake is harmless, because the gate
   only lets listed emails in.
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

## Roster changes on the box (2026-11-10, #42 PR 6)

- **Officials add, rename and merge Groups and Teams on the laptop** (ADR-0026: rosters live only in the Collator).
  Any Official can do it (ADR-0019, 2026-11-10). Every change is a row in an append-only **roster log** on the box,
  with who, when and an optional reason. The Groups and Teams tables keep what the phones sent, so a phone resending
  a Team it added stays a repeat (item 8), even after an Official renames it.
- **Rename:** the latest rename gives the name shown everywhere: the judge page's roster, the Official view,
  Standings.
- **Merge** (Jim, 2026-11-08): Team A **merged into** Team B is a roster change. A's score entries count for B, and
  nobody edits a Judge's entry. A disappears from the judge page's roster, but a phone that still scores A offline
  is fine: the entry counts for B. Two Judges who scored A and B at the same Activity become a conflict on B, and an
  Official resolves it as usual (`choose-entry`). Groups merge the same way: A's Teams then show under B, and for a
  Group-level Competition, A's entries count for B. Merges chain (A into B, B into C means A counts for C). A merge
  that would make a loop is refused.
- **A merge is reversible.** Nothing is rewritten, so **unmerge** is just a later row in the log: the latest merge or
  unmerge for a Team or Group wins. The laptop still asks for a confirmation before merging, because standings move
  at once.
- **Applying the log:** the box applies it when it builds the scoring input. Entries and Official actions naming a
  merged-away entrant count for the surviving one, and the merged-away one isn't an entrant. `packages/scoring` sees
  the resolved roster only.
- **Reassigning one score** to another Team is a logged Official action, not a roster change (ADR-0019 amendment,
  2026-11-10, `reassign-entry`).

## Exhibition results (2026-11-10, #42 PR 7)

- **An Official records each Exhibition's results on the laptop.** An Exhibition is an Activity with scoring type
  `exhibition`, recognized individually at awards and never team-scored (CONTEXT.md). The fields match v1's
  `exhibition_results`: each row has the Participant's name, Group and Team (free text, as in v1: a Participant may
  not be on the roster), a place (free text, e.g. "1st" or "Honorable mention") and notes. The rows keep the order the
  Official gives them.
- **Each save is the whole list for that Exhibition**, as in v1. It's appended to a log on the box (who, when), and the
  latest save is the current list. Nothing is overwritten, so an earlier version can still be read. A save names the
  save it replaces, and the Collator refuses a stale one (409, reload) when another Official saved in between. This is
  the same rule as a stale `finalize`.
- **These are results, not scoring:** `packages/scoring` never sees them. They're kept on the box and in its backups,
  and the results bundle and awards printouts (#43, ADR-0015) read them from there.

## Exhibition Final and Draft (2026-11-11, #43 PR 2)

- **An Official marks an Exhibition's results final, or back to draft,** on the laptop. Each change is appended to
  its own log on the box (who, when, optional notes), and the latest change for an Exhibition wins. An Exhibition
  with no change logged is a draft. This log is the box's, not `packages/scoring`'s action log, because scoring never
  sees Exhibition results (above).
- **Finalizing freezes what the Official saw.** It names the save the Official loaded (none, when nothing was saved),
  and the Collator refuses it as stale (409, reload) when a newer save has arrived. This is the same rule as a stale
  `finalize` for a ranked Activity. Finalizing a final Exhibition, or putting a draft one back to draft, is refused.
- **While an Exhibition is final, saves to its results are refused** (409: put it back to draft first). A repeat of an
  earlier save is still a repeat.
- **The Overview shows Final or Draft** for each Exhibition, next to its result count.
- **Awards list final Exhibitions only.** The box adds each final Exhibition's rows, in the Official's order and with
  the place as the Official typed it, to its Competition's section on the Awards page, after the winners registry's
  lines. Nothing is ranked or sorted (CLAUDE.md rule 3). Awards stay **provisional** while any ranked Activity
  isn't finalized or any Exhibition is still a draft, and the page counts both.
- **A reset clears this log** with the results; a restore brings it back with the backup.

## Recovery and after the event

11. **The box backs up to a USB stick every few minutes.** A replacement box loaded with the same cartridge
    rebuilds the scores from the phones as they come back in range (item 8: phones keep acknowledged
    scores, and score ids make resending safe). (#40, #45)
12. **The results bundle (USB, ADR-0015) carries everything home**, Judges included (for thank-you notes).
    What gets uploaded to the cloud Composer is decided later. (#43, #45)

## Reset, restore and the box epoch (2026-11-10, #42 PR 8, #66)

- **Reset, for rehearsals** (v1's `/api/admin/scores` and `/full-reset`). An Official does it on the laptop: any
  Official, per ADR-0019 2026-11-10, "no Director-only actions".
  - **Reset scores** clears score entries, closures, Judges, Official actions and exhibition results.
  - **Full reset** also clears the roster (Groups, Teams and the roster log).
  - Neither touches the loaded cartridge or the Officials added on the console.
- **Every reset backs up first.** The box takes a backup just before resetting, into the usual backup folder. If that
  backup can't be written (no folder set, the stick is full or missing), the reset is **refused**. The Official
  must also **type the Event's name** to confirm, and the box checks it too.
- **The box epoch** (#66, decided 2026-11-07). The box keeps a log of epochs: a random id and a **reason**, `created`,
  `restore` or `reset`, with the time. The current epoch is the newest. The phone learns it with the event data, and
  from every answer.
  - **Restore:** restoring a backup is a box-console command, `restore-backup <file>`, run while the server is
    stopped. It puts the backup in place and appends a `restore` epoch. A file copied by hand can't be told apart
    from the live database, because a backup carries the same epoch, so the runbook uses the command.
  - **Phones on a new epoch.** A phone keeps a **sent archive**: everything it sent and the box confirmed (scores,
    Groups and Teams it added, closures), each tagged with the epoch it was sent in. When it sees a new epoch, it asks
    the box for the epochs since the one it knew:
    - **any reset among them:** the phone drops its archive and any outbox items from before the reset. Nothing is
      resent, so a reset never undoes itself when a phone reconnects;
    - **only restores:** the phone resends its whole archive, with the same ids, so anything the box already has
      counts once. This recovers what the backup missed;
    - **an epoch the box doesn't know** (a backup older than anything the phone saw) is treated as a restore.
  - **A closure's `missing` list is a second trigger:** the phone resends those ids from its archive.
  - The archive lives in the phone's storage for the Event, at about 1 KB per score.
- Item 8's promise, "phones resend what the box lost", is now true after a restore, and deliberately false after a
  reset. The runbook's §5 says which is which.

## Consequences

- The Collator needs no hardware decision to be built and rehearsed; the runbook (#45) records the box
  actually used.
- A score's identity is the phone-made id, not (Team, Activity): conflicts and versions are kept, not
  overwritten, and Officials resolve them with logged actions (ADR-0019).
- The box can be lost or replaced mid-event without losing scores, as long as the phones come back in
  range.
- The v1 importer (#46) currently drops a v1 cartridge's Officials ("until #39"). With item 5, a follow-up
  carries them into the event-day cartridge (#8, #42).
