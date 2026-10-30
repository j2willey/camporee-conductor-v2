# Circus 2026: v1 → v4 transcode notes

Source: `v1-source/`, the Circus 2026 cartridge (schema `3.0`), identical to v1's
`tests/fixtures/circus`. Output: `event.json`, `common-fields.json`, `activities/*.json` (schema `4.0`).
Produced by `scripts/transcode-circus-2026.ts`. Re-running it gives byte-identical output.

Counts: 34 Activities (18 ranked in Patrol Games, 12 ranked in Troop Challenges, 4 exhibition),
3 Competitions, 1 Common Field set. The v1 playlist has 34 entries for 34 game files, one to one.

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
- **`p_flag` (Patrol Flag)**: placeholder says "0-10 Points" but `max` is 5, with `weight` 10.
- **v1 weights** are kept exactly (e.g. `0.1` on elapsed time in `ducks-in-a-row` and `telephone`, `0` on
  info fields and on `patrol_size`).
- No Event dates: v1 `meta` has only `year: 2026`.
