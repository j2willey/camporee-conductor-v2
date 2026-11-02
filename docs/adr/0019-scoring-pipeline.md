---
created: 2026-10-25T12:25
updated: 2026-11-02
---

# ADR-0019 — Scoring pipeline: raw → points (official-defined conversions) → sorted totals → Official-final rankings

Date: 2026-10-25 · Status: Accepted, amended 2026-10-30 and 2026-11-02 (see below)

1. Judges record results at a Station.
2. Results become **points**. Officials define **conversions** from metrics to points, e.g. matches used (1 → 10 pts, 2 → 7, 3 → 4) or time → points, with direction per Challenge (sometimes less time is better, sometimes more).
3. Teams are sorted by point total → **provisional ranking**.
4. An **Official sets the Final Ranking**. Usually identical to provisional, but Officials have discretion (e.g., un-Scout-like behavior) to change it.
   Supersedes v1's implicit "sum points − penalties, sort desc" scattered across 4 files; implemented once in the pure scoring package, tested against Circus 2026 data. v1 `weight` field: dropped unless a real use appears. _(Superseded 2026-10-30: `weight` is kept; see amendment below.)_

## Details (round 5)

- **Conversions:** primarily set by Officials at the event after seeing the real spread of results; the Composer may hold an optional **strawman** conversion defined at design time as a starting point. All points recompute when a conversion changes; changes are logged.
- **Judge entry:** per field — raw metrics (counts, times) that get converted, or judged points entered directly (e.g., Scout Spirit 0–10). Raw entries are stored as entered.
- **Final Ranking overrides:** no reason required; optional notes field. Logged (who/when).
- **Ties:** allowed in Final Rankings. Numbering is configurable per Event by the director; default is dense (1, 2, 2, 3) — Jim's preference: give out more awards. See the 2026-11-02 tie-numbering amendment.
- **Score change after finalization:** DEFERRED to Phase 2 session. Constraint in place now: the scoring package never silently re-sorts a finalized Challenge.
- **Overall awards:** director chooses per Event — sum of placement points via a per-Competition placement→points table (default), or sum of converted points. See the 2026-11-02 Awards amendment.

## Amendment 2026-10-30 (issue #2): `weight` is kept

"`weight` dropped" was wrong. **`weight` is a per-field multiplier.**

- The Activity carries a **design default** (1 = no change; 1 if left out). v1 never applied weight;
  transcoded Circus 2026 defaults are 1, with v1 values preserved in `legacy`.
- Officials' event-day changes to a weight are **stored separately on the Collator and logged**. They never
  overwrite the design document.
- Applying weights is scoring logic, so it lives only in `packages/scoring`.

## Amendment 2026-11-02 (issue #3): Official overrides are a log of actions

- Judges' score entries are stored as entered and never edited by Officials. Everything an Official
  decides is a **logged Official action**, passed into the scoring package with the entries. The package
  applies them; it never stores them.
- Actions so far:
  - `set-final-rank`: overrides the Final Ranking.
  - `set-placement-points`: overrides the placement points.
  - `adjust-points`: adds points to (or, if negative, subtracts them from) an entry's total.
- For each action type, the **latest logged action wins**.
- `adjust-points` replaces v1's Official-only "Official Score" field (`off_score`), which v1 added to the
  total. At Circus 2026 it was used once (+1 in `the-circus-orchestra`).
- Still to come (#3): DQ, finalization and the overall rank override, as further actions.

## Amendment 2026-11-02 (issue #3): tie numbering

- **Per-Event setting `tieNumbering`:** `dense` (1, 1, 2) or `strict` (1, 1, 3). **Default `dense`.** Per Event
  only, with no per-Competition override. It applies to Activity rankings and overall standings.
  Jim's reason for the default: a tie should never cost the next team a place. Coyote Creek camporees have
  always run this way.
- v1 used dense ranking for single games (`leaderboard.js`) and overall standings (`official.js`, `utils.js`);
  the comment at `utils.js:505` that says "standard" is wrong. Circus 2026 stays dense, so parity is unchanged.
- **Placement points follow the place number:** two tied 1sts both get 1st-place points. Points are never split.
- **Award cutoffs** (top-N, top-%) include every team tied at the cutoff. Officials can still override
  manually, as a logged Official action.

## Amendment 2026-11-02 (issue #3): Awards

- **Awards are configured per Event** (`awards` on the Event). Each Award draws from one Competition's
  standings (sum of placement points, ranked by the Event's tie numbering) and has a **rule**:
  - `places`: named places, e.g. Gold Axe / Silver Hatchet. **By place number:** each entrant placed
    1st…Nth gets that place's name, so ties share a name and, with dense numbering, the next team still
    gets the next name (1, 1, 2 → two Gold Axes and a Silver Hatchet). With strict numbering a skipped
    place has no recipient. This is a place cutoff, not a count, so it doesn't use `withinCutoff`.
  - `top-percent`: a **counted cutoff**: `ceil(percent × entrants)`, then `withinCutoff`, so everyone tied
    at the line is included. Entrants are those in the Competition's standings who aren't DQ'd. Coyote
    Creek's Top Dog is top-percent 25 over Troop Challenges.
  - `manual`: no automatic recipients.
- **DQ'd entrants never receive an automatic award**, only a manual one.
- **Manual awards and overrides** are a logged Official action, `set-award` (award, entrant, awarded
  yes/no, optional notes). It can add or remove a recipient for any Award; for each award and entrant the
  latest action wins. For a named-places Award it can also give a **place** (one of the Award's names),
  which the recipient shows and which replaces an automatic place.
- **Invalid Official actions never break scoring.** The log is append-only, so a bad action (or one made
  invalid later, e.g. by renaming a place) can't be removed. Scoring checks only the **effective** (latest)
  action; if it's invalid (a place the Award doesn't have, or a place on an Award that isn't named places),
  it's left out, the automatic result stands, and `scoreEvent` returns a **warning**. The Collator should
  reject invalid actions when they're written.
- **Scope:** `event` (the whole Competition) or `division` (each Division separately, ADR-0007). Only
  `event` is built so far; `division` follows per-Division Activity ranking.

## Amendment 2026-11-02 (issue #3): DQ (disqualification)

- **Logged Official action `disqualify`** (entrant, optional Activity, `disqualified` yes/no, optional notes).
  With an Activity it's a per-Activity DQ; without one it's an overall DQ. The latest action for an entrant
  (and Activity) wins, so `disqualified: false` reinstates.
- **Per-Activity DQ:** the entrant is **removed before the Activity is ranked**, so everyone below moves up
  under either tie numbering. It has no rank, scores 0 placement points for that Activity (whatever other
  actions say), keeps its total, and is shown as DQ.
  **Deliberate change from v1:** v1's per-game DQ (added 2026-05-21, after Circus 2026) was only a badge
  on the Officials' screen and changed no points or ranks (`official.js:965-974`).
- **Overall DQ:** the entrant keeps its total but is **removed before the standings are ranked**, as v1 did
  (`official.js:876-884`). It has no rank and gets no automatic Award; a manual `set-award` still works.
- Circus 2026 had no DQs (v1 had no DQ at the event), so parity is unchanged.

## Amendment 2026-11-02 (issue #3): placement points table, overall rank override

- **Placement points table per Competition**, set at design time (`placementPoints` on the Competition:
  `places` for 1st, 2nd…, and `participation` for any other placement). Left out, it's v1's table:
  100 / 90 / 80 / 70 / 60, 50 for taking part. No result in an Activity is always 0. Not editable on
  event day for now; that can become a logged Official action later. Circus 2026 uses the default.
- **Overall rank override:** logged Official action `set-overall-rank` (Competition, entrant, rank, optional
  notes); the latest per Competition and entrant wins. Other entrants are **not** re-sorted: the Official
  owns the result. Awards use the overridden rank. An overall DQ beats an override, as for Activities. An
  invalid effective action (a rank that isn't a whole number from 1, or an entrant not in that
  Competition) is left out with a warning, the same as `set-award`.
