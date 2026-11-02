# Circus 2026: v1 → v4 transcode notes

Source: `v1-source/`, the Circus 2026 cartridge (schema `3.0`), identical to v1's
`tests/fixtures/circus`. Output: `event.json`, `common-fields.json`, `activities/*.json` (schema `4.0`).
Produced by `scripts/transcode-circus-2026.ts`. Re-running it gives byte-identical output.

Counts: 34 Activities (18 ranked in Patrol Games, 12 ranked in Troop Challenges, 4 exhibition),
3 Competitions, 1 Common Field set. The v1 playlist has 34 entries for 34 game files, one to one.

## Design vs as run

There are two Circus 2026 fixtures. They describe the same event at two moments, not two competing copies:

| Fixture | Source | What it is | Used by |
| --- | --- | --- | --- |
| `circus-2026/` (this folder) | v3 cartridge (schema `3.0`) | **Design.** The Circus with Jim's post-event corrections. The future Template. | Everything |
| `circus-2026-as-run/` | Event-day cartridge (schema `2.9`), run by v1 commit 9ebffa5 on 2026-05-16 | **As run.** What was actually scored at the event. | Only the `packages/scoring` parity tests (issue #3) |

Both come from `scripts/transcode-circus-2026.ts` with the same mapping. The as-run documents have their own ids
(namespace `circus-2026-as-run`), so neither can be mistaken for the other.

Every scoring-field difference between them, and why. `src/fixtures.test.ts` fails if this list changes.

| Activity | Field | As run | Design | Why |
| --- | --- | --- | --- | --- |
| `3-ring-circus` | `hand_breaks` ("+15 sec each") | `penalty` | `metric` | Corrected (v1 BACKLOG 2026-06-18). A time adjustment, not points to subtract. |
| `the-barrel-of-monkeys-caravan` | `barrel_drops` ("+10 sec each") | `penalty` | `metric` | Same correction: a time adjustment. |
| `sports-land-skis` | `falls` ("+10 sec each") | `penalty` | `metric` | Same correction: a time adjustment. |
| `the-high-wire-fire-act` | `matches_used` ("each = +1 min penalty") | `penalty` | `metric` | Same correction: a time adjustment. |
| `the-tumbled-trapeze-rescue` | `patient_ground` ("+30 sec each") | `penalty` | `metric` | Same correction: a time adjustment. |
| `the-grand-entry` | `retreat_penalty` | `penalty` | `metric` | Same correction (2026-06-18). Recorded for the Official rather than subtracted. |
| `the-high-wire-fire-act` | `fire_extinguished` ("Fire fully extinguished & reset") | `penalty` | `points` | Same correction: it's an achievement, so as a penalty it cost the patrols that did it right. |
| `setting-up-the-big-top`, `the-big-top-goes-down`, `the-circus-orchestra`, `the-grand-entry`, `trapeze-swing-assembly` | `judge_notes` (text, `info`) | absent | present | v1's Composer stripped `judge_notes` on every cartridge export, so the event-day cartridge lost them. Fixed and restored 2026-05-21 (v1 e296c7c). Text only; never scored. |
| `trapeze-swing-assembly` | `field_1778197726672` `sortOrder` | 60 | 70 | No v1 `sortOrder`, so it comes from list position, which the restored `judge_notes` shifts. |

That's 7 fields across 6 Activities reclassified (5 of them finalized Patrol Games, plus the Troop Challenge
`sports-land-skis`), and 5 restored note fields. Nothing else differs: Activity content, variables, scoring
direction, Common Fields, Competitions and playlist order are the same.

The schema `2.9` cartridge predates v1's league model, so the as-run transcode fills three gaps:

- **Game `type` → Competition.** `patrol`, `troop` and `exhibition` map to `patrol-games`, `troop-challenges` and
  `exhibition`. v1's own schema-v3 migration (5888d22) used the same mapping.
- **Common Fields per Competition.** `type_defaults` is keyed by type, and is re-keyed the same way.
- **Competitions and terminology.** The `2.9` manifest has neither, so both come from the design manifest.

## Renamed or restructured

| v1                                           | v4                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| game                                         | Activity (ADR-0003, amended)                                                                                                        |
| `league` (Competition)                       | Event `activities[].competitionId`; `scoringType` = `exhibition` for the `exhibition` league, else `ranked`                         |
| `content.challenge`                          | `content.objective` (generic vocabulary: "Challenge" isn't a code term)                                                             |
| `content.time_and_scoring`                   | `content.timeAndScoring`                                                                                                            |
| `content.supplies_text` (free text)          | `content.supplies[]` of `{ group?, item, quantity? }`; see below                                                                    |
| `content.instructions` / `scoring_notes` / `references` | `content.customSections[]`, only when non-empty (5 Activities)                                                            |
| `content.tags`                               | `tags` (1 Activity)                                                                                                                 |
| `scoring_model.method`                       | `scoring.direction`: `points_desc` → `higher-wins`, `timed_asc` → `lower-wins`                                                      |
| `scoring_model.inputs[]`                     | `scoring.fields[]`                                                                                                                  |
| field `audience: "admin"`                    | `audience: "official"` (4 fields)                                                                                                   |
| `library_uuid`, `library_title`, `id`        | `legacy.v1LibraryUuid`, `legacy.v1LibraryTitle` (17 Activities), `legacy.v1Id` (all)                                               |
| `presets.json`                               | `common-fields.json` (Common Field set)                                                                                             |
| league `tier`: `subunit` / `unit`            | Competition `level`: `team` / `group`                                                                                               |
| `type_defaults[league].prefix` / `.suffix`   | Competition `commonFields.before` / `.after`                                                                                        |
| `meta.director`                              | Event `organizerName`                                                                                                               |
| `meta.theme_colors`                          | `presentation.themeColors`                                                                                                          |
| `meta.awards_config` (styles `"1"`–`"4"`)    | `presentation.awardLabel`, styles named `line1`, `line2`, `activityName`, `winner` (the order v1 prints them on the award sticker)  |
| `terminology.unit/subunit/member/event`      | `terminology.labels.group/team/participant/event`, pack `scouting`                                                                  |
| `meta.camporeeId`                            | Event `legacy.v1Id`                                                                                                                 |

New ids are UUID v7, derived from a hash of the v1 id with the timestamp fixed at the transcode date
(2026-10-30), so they're stable across re-runs.

## Fixed or normalized

- **Weights set to 1; v1 values kept in `legacy.v1Weight`.** v1 stored a `weight` on every field but
  never applied it: only `public/js/core/schema.js` passes it through, and no total or ranking reads it.
  So Circus 2026's announced results used an effective weight of 1. Every field (34 Activities and the
  Common Field set) now has `weight: 1`, with the original v1 number in the field's `legacy.v1Weight`
  (v1 had 0, 0.1, 0.5, 1, 2, 3, 5 and 10). This lets #3 (scoring) reproduce the results announced in May.
- **`p_flag` placeholder.** v1 said "0-10 Points", but `max` is 5 and judges scored 0–5. Corrected to
  "0-5 Points"; `max` stays 5.
- **v1 bug: `{{ten_essentials_item}}`.** The `ten_ess` preset label and placeholder used
  `{{ten_essentials_item}}`, but all 18 Patrol Games define the variable `ten_essentials`. v1 substitutes
  `'___'` for an unknown variable, so v1 would have shown "10 Essentials: \_\_\_". v4 uses `{{ten_essentials}}`,
  matching the games and v1's own Composer default. A fixture test now checks every token resolves.
- **Field ids with a trailing space.** 8 fields in 5 Activities (`buried-bearded-ladys-jewels`, `clown-car`,
  `setting-up-the-big-top`, `the-high-wire-fire-act`, `trapeze-swing-assembly`) had Composer-generated ids
  like `"field_1778195167953 "`. Trimmed. **For #8:** v1 scores are keyed by the untrimmed id, so the
  v1-compatible export must add the space back.
- **Missing field `sortOrder`.** Those same 8 fields had none. Set to `(position + 1) × 10`, matching v1's
  array order.
- **Boolean defaults on number fields.** 5 fields (`toss_success`, `retreat_penalty`, `fire_extinguished`,
  `load_test`, `required_lashings`) had `defaultValue: false` on a `number` field. Converted to `0`.
- **Empty rules.** One empty-string rule removed from `showtime-in-the-center-ring`.
- **Supplies.** 200 items. Lines ending in `:` (`SCENE PROPS:`, `Option A — Tent:`, …) became `group` on the
  items after them (`the-big-top-goes-down`, `setting-up-the-big-top`). One indented continuation line in
  `the-a-frame-trapeze` was appended to the item above it. 3 items have no quantity because v1 gave none.

## Left empty (data gaps in v1, not transcode losses)

- `showtime-in-the-center-ring`: `setup`, `reset`, `staffing`, `supplies` and `notes` are empty.
- `slack-lining` (exhibition): no rules.
- `notes` is empty in 11 Activities.
- The 4 exhibition Activities (`archery`, `climbing-wall`, `slack-lining`, `tomahawk-throwing`) have no
  scoring fields. v1 recorded exhibition results in a separate `exhibition_results` table.

## Dropped

- **Presets `off_score`, `final_rank`, `overall_points`** (Official-only "Official Score", "Final Ranking",
  "Overall Points"). In v2 these are outputs of the scoring pipeline (Official-set Final Ranking, placement
  points; ADR-0019), not form fields. As a result, Troop Challenges and Exhibition Events have no Common
  Fields; their v1 `type_defaults` listed only these three.
- **Preset `bracket_result`**: bracket mode is unused (`bracketMode` is `false` in all 34 games).
- **Preset `tier` and `position`**: the Competition now decides where a Common Field applies.
- **Game `bracketMode`** (all `false`), **`match_label`** (all `""`), **`session`** (all `null`),
  **`sortOrder`**: per-league and repeated (10, 20, 30… in each league). Event order comes from the
  v1 `playlist` instead, as `activities[].sortOrder` 1–34.
- **Terminology `organizer: "Event Director"`**: packs relabel only the participant hierarchy and the event
  name (ADR-0003, amended).
- **`sessions`, `officials`** (both empty) and **`rosters`** (empty; rosters are Collator-only, ADR-0026).

## Carried over as-is, but worth a look

- **`top-dog`** is modelled in v1 as a Troop Challenge, but it's really an award ("top 25% of troops by
  aggregate score; no ranking among them"). It's kept as a ranked Activity so the counts match v1. Under
  ADR-0019, overall awards come from the pipeline, so #3 (scoring) should decide whether it stays an
  Activity.
- No Event dates: v1 `meta` has only `year: 2026`.
