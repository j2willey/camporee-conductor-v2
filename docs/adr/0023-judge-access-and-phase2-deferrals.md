---
created: 2026-10-25T12:31
updated: 2026-10-25T12:38
---

# ADR-0023 — Judges never need accounts; access via QR codes encoding a URL; other Phase 2 details deferred

Date: 2026-10-25 · Status: Accepted

- Judges never need an account.
- **Primary flow (as at Circus 2026):** QR #1 joins the on-site WiFi; QR #2 opens the Collator judge URL; the judge enters contact info and selects the Challenge they're assigned to.
- **Bonus:** a QR per Station that pre-selects event + Station.
- Details (join codes, revocation) finalized in the Phase 2 session.
- Deferred to a Phase 2 grilling session (~December): on-site box hardware (laptop vs Raspberry Pi), TLS certificates for phones on the offline LAN, judge sync protocol details.
