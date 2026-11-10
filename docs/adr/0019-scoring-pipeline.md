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
- **Score change after finalization:** DEFERRED to Phase 2 session. Constraint in place now: the scoring package never silently re-sorts a finalized Challenge. _(Decided 2026-11-02: see the Finalization amendment.)_
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
- For each action type, the **latest logged action wins**. That includes `adjust-points`: a later adjustment
  replaces an earlier one; they don't add up. _(Made explicit 2026-11-03, Jim: the code had summed them.)_
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

## Amendment 2026-11-02 (issue #3): Measured Activities

- An Activity may mark **at most one** `metric` field (type `number` or `stopwatch`) as its **primary metric**,
  with **its own direction**: `primary: { direction: "lower-wins" | "higher-wins" }`. Points always rank
  highest first; a metric can run the other way (Circus 2026 `trapeze-swing-assembly`: build time
  lower-wins). (Amended 2026-11-03, #28: the Activity no longer has a `direction` of its own.) Common Fields can't be primary.
- `scoreEvent` **lists** an Activity's entries by the primary metric's raw value in that direction, to help
  the Official enter points. **Ranking still comes from points**; no conversion formulas. Time adjustments
  ("+15 sec each") don't change the order. Activities without a primary metric are listed as entered.
- Stopwatch values are text (`m:ss`, `h:mm:ss`, optional decimal seconds). **`"00:00"` or blank means no
  time** (the stopwatch wasn't used, as in Circus 2026 `the-high-wire-fire-act`); entries with no value are
  listed last, in entry order.
- A primary stopwatch value that's entered but **can't be read** (e.g. `"7.47"`, `"7;47"`, `"1:75"`) is also
  listed last, and `scoreEvent` returns a **warning** naming the Activity, entrant, field and raw value, so
  the Official sees the typo. Scoring doesn't fail on it.

## Amendment 2026-11-02 (issue #3): Finalization

- **`finalize { activityId, ranking }`** freezes an Activity's Final Ranking. The action **stores the ranking
  it froze**: each entrant's rank and placement points, or DQ. **`unfinalize { activityId }`** reopens it.
  For each Activity, the latest of the two wins.
- While an Activity is finalized, `scoreEvent` returns the **stored ranking**, and standings and Awards use
  it. If recomputing from the current scores and the actions logged before the `finalize` would come out
  differently (a rank, points, a DQ, or an entrant added or missing), it returns a **warning** naming the
  Activity. It never re-sorts silently. The entries' totals and Provisional Ranking stay live, as
  information.
- **Actions logged after `finalize`** that would change that Activity (`adjust-points`, `set-final-rank`,
  `set-placement-points`, a per-Activity `disqualify`) **don't apply until `unfinalize`**. Each one gets a
  warning. Actions that don't change the Activity's results (an overall DQ, `set-overall-rank`,
  `set-award`) still apply.
- **Per Activity only.** Standings aren't finalized; they're derived from Activity results.
- Only the effective (latest) `finalize` or `unfinalize` is checked. An invalid one (an Activity not in the
  Event; an entrant with no entry at that Activity, or listed twice; a rank that isn't a whole number from 1;
  negative points) is **left out with a warning**. The Activity **stays frozen with the latest valid
  `finalize`** since the last `unfinalize`, if there is one: finalized results are what's printed on
  ribbons, so staying frozen is the safe default, and **only an explicit `unfinalize` reopens**. With no
  valid `finalize` to fall back to, the Activity is scored as not finalized. _(Changed 2026-11-02 before
  merge, Jim: it used to unfreeze.)_
- v1 had only a Draft/Final switch per game (`game_status`). It stored no ranking and didn't stop later
  changes: v1 recomputed every time. Freezing the ranking is a deliberate change. v1's Close Game is
  different: it's a Judge's "I'm done" handshake, not an Official's finalization.

## Amendment 2026-11-03 (issue #28): no Activity-level direction

- `Activity.scoring.direction` is **dropped**. Nothing read it: ranking is always by points total, highest
  first (as in v1 9ebffa5, which also never read `timed_asc` in scoring), and listing uses the primary
  metric's own direction.
- v1's `scoring_model.method` (`points_desc` / `timed_asc`) is kept in `legacy.v1ScoringMethod`, as `weight` is
  kept in `legacy.v1Weight`.
- **Conversions** (step 2 above, not built yet) will carry a direction **per rule**, on the rule itself, not
  on the Activity. A v1 `timed_asc` Activity can suggest a default when an Official first writes one.

## Amendment 2026-11-10 (issue #42): an Official corrects a field

- **Logged Official action `set-field-value`** (Activity, entrant, **score entry id**, field, value, optional notes):
  an Official's value for one field of one Judge's score entry. The Judge's entry is kept as entered; scoring
  overlays the corrected value on it before totalling and listing. It is also how an Official fills an `official`
  audience field. _(Jim, 2026-11-07: a logged action, not an Official-authored score entry, which would blur who
  scored what.)_
- **Logged Official action `revert-field-value`** (Activity, entrant, score entry id, field, optional notes): undoes a
  correction; the Judge's value counts again. For each entry and field, the **latest** `set-field-value` or
  `revert-field-value` wins, as Reinstate undoes a DQ. Nothing is ever deleted from the log.
- **A correction belongs to the entry it corrects**, not to the entrant. If the Judge (or another Judge) later
  sends a newer entry for that entrant, the newer entry counts as entered and the correction no longer applies. The
  Collator shows it as **superseded**, so an Official looks again: they corrected what they saw, and a new entry is new
  information that neither silently inherits an old fix nor is silently overwritten by one.
  So scoring entries carry their ids (`ScoreEntry.id`, optional for fixtures without them).
- **Checks (one place, #24):** `actionProblem` refuses an unknown Activity or field (Common Fields included), an
  entrant outside the Activity's Competition, and a value of the wrong kind for its field (not a number for a number
  field, not one of the options for a select). A value **outside a number field's min/max is allowed**, with a
  warning shown to the Official: a range is design guidance, and the Official on the spot decides. That the entry id
  exists and is for that Activity and entrant is checked by the Collator, which holds every entry (scoring sees only
  the entries that count). In `scoreEvent` an invalid effective correction is left out with a warning, as for DQ.
- **Finalized Activities:** a correction is an action on the Activity, so while it's finalized it waits for
  `unfinalize`, like every other action (Finalization amendment).
- **Any Official can take any Official action.** No roles and no Director-only actions: few Officials work an Event,
  often only the Director, and the action log (who, when, why) with undo is the control. _(Jim, 2026-11-10.)_
- **Resolving a conflict** (two Judges scored the same entrant; the newest counts, ADR-0027 item 9) is a separate
  action and PR: an Official chooses which entry counts. Choosing needs every entry in the scoring input, not only the
  newest the Collator picks today.
