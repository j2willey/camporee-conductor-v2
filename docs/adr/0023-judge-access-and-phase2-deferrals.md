---
created: 2026-10-25T12:31
updated: 2026-11-06
---

# ADR-0023 — Judges never need accounts; access via QR codes encoding a URL; other Phase 2 details deferred

Date: 2026-10-25 · Status: Accepted, deferred items resolved 2026-11-06 by [ADR-0027](0027-onsite-collator.md)

- Judges never need an account.
- **Primary flow (as at Circus 2026):** QR #1 joins the on-site WiFi; QR #2 opens the Collator judge URL; the judge enters contact info and selects the Challenge they're assigned to.
- **Bonus:** a QR per Station that pre-selects event + Station.
- Details (join codes, revocation) finalized in the Phase 2 session.
- ~~Deferred to a Phase 2 grilling session (~December): on-site box hardware (laptop vs Raspberry Pi), TLS certificates for phones on the offline LAN, judge sync protocol details.~~ **Resolved 2026-11-06 by [ADR-0027](0027-onsite-collator.md)** (issue #39): hardware decided by 2027-05-01 at the latest, with no software depending on it; HTTPS as in 2026 (Let's Encrypt via DNS-01 + local DNS override), configurable; offline-first queue with phone-made score ids.
- **Clarified by ADR-0027 item 6:** Judges have no pre-list and can score any Activity. "The Challenge they're assigned to" means the Judge chooses; nothing enforces an assignment.
- Still open: QR join codes and revocation.
