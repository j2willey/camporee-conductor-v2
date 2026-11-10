import {
  CommonFieldSetSchema,
  type CommonFieldSet,
  type ScoringField,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import {
  correctedValues,
  fieldCorrections,
  scoreEvent,
  type FieldValue,
  type OfficialAction,
  type ScoringInput,
} from "./index.ts";
import { activityId, smallEvent } from "./test-support.ts";

/** An Official corrects a field (ADR-0019, #42). Each entry's id is `e-<entrant>`. */
const A = activityId(0);

function withIds(input: ScoringInput): ScoringInput {
  return {
    ...input,
    entries: input.entries.map((e) => ({ ...e, id: `e-${e.entrantId}` })),
  };
}

const set = (
  entrantId: string,
  value: FieldValue,
  fieldId = "score",
  entryId = `e-${entrantId}`,
): OfficialAction => ({
  type: "set-field-value",
  activityId: A,
  entrantId,
  entryId,
  fieldId,
  value,
});

const revert = (
  entrantId: string,
  fieldId = "score",
  entryId = `e-${entrantId}`,
): OfficialAction => ({
  type: "revert-field-value",
  activityId: A,
  entrantId,
  entryId,
  fieldId,
});

function run(actions: OfficialAction[], scores = { t1: 30, t2: 20, t3: 10 }) {
  const input = withIds(smallEvent({ scores: [scores], actions }));
  const results = scoreEvent(input);
  const [activity] = results.activities;
  return {
    results,
    totals: Object.fromEntries(
      (activity?.entries ?? []).map((e) => [e.entrantId, e.total]),
    ),
    ranks: Object.fromEntries(
      (activity?.entries ?? []).map((e) => [
        e.entrantId,
        e.disqualified ? "DQ" : e.finalRank,
      ]),
    ),
  };
}

describe("fieldCorrections and correctedValues", () => {
  const entry = { id: "e1", values: { score: 5, other: 1 } };

  it("the latest set or revert per field wins; a revert removes the field", () => {
    const actions = [
      set("t1", 7, "score", "e1"),
      set("t1", 8, "score", "e1"),
      set("t1", 3, "other", "e1"),
      revert("t1", "other", "e1"),
    ];
    const corrections = fieldCorrections(entry, actions);
    expect([...corrections.keys()]).toEqual(["score"]);
    expect(corrections.get("score")?.value).toBe(8);
    expect(correctedValues(entry, actions)).toEqual({ score: 8, other: 1 });
  });

  it("ignores other entries, and an entry with no id has none", () => {
    expect(fieldCorrections(entry, [set("t1", 7, "score", "e2")]).size).toBe(0);
    expect(fieldCorrections({}, [set("t1", 7, "score", "e1")]).size).toBe(0);
  });
});

describe("scoreEvent applies corrections", () => {
  it("a correction changes the total and the ranking", () => {
    const { totals, ranks } = run([set("t3", 50)]);
    expect(totals).toEqual({ t1: 30, t2: 20, t3: 50 });
    expect(ranks).toEqual({ t1: 2, t2: 3, t3: 1 });
  });

  it("the latest of two corrections wins", () => {
    expect(run([set("t3", 50), set("t3", 15)]).totals["t3"]).toBe(15);
  });

  it("a revert restores the Judge's value", () => {
    const { totals, ranks } = run([set("t3", 50), revert("t3")]);
    expect(totals["t3"]).toBe(10);
    expect(ranks).toEqual({ t1: 1, t2: 2, t3: 3 });
  });

  it("a correction naming an entry that isn't there changes nothing, and warns", () => {
    const { totals, results } = run([set("t3", 50, "score", "superseded")]);
    expect(totals["t3"]).toBe(10);
    expect(results.warnings).toHaveLength(1);
  });

  it("a value outside min/max is applied, with no warning from scoring", () => {
    const input = withIds(
      smallEvent({ scores: [{ t1: 5, t2: 4 }], actions: [set("t2", 99)] }),
    );
    const [activity] = input.activities;
    if (!activity) throw new Error("no Activity");
    const ranged: ScoringInput = {
      ...input,
      activities: [
        {
          ...activity,
          scoring: {
            fields: activity.scoring.fields.map((f) => ({
              ...f,
              config: { min: 0, max: 9 },
            })),
          },
        },
      ],
    };
    const results = scoreEvent(ranged);
    expect(results.warnings).toEqual([]);
    expect(results.activities[0]?.entries[1]).toMatchObject({ total: 99 });
  });

  it("a blank value clears the field", () => {
    expect(run([set("t1", null)]).totals["t1"]).toBe(0);
  });
});

describe("scoreEvent leaves out an invalid correction, with a warning", () => {
  it("an unknown field", () => {
    const bad = set("t3", 50, "nope");
    const { totals, results } = run([bad]);
    expect(totals["t3"]).toBe(10);
    expect(results.warnings).toEqual([
      { action: bad, message: expect.stringContaining("nope") },
    ]);
  });

  it("a non-number on a number field", () => {
    const bad = set("t3", "lots");
    const { totals, results } = run([bad]);
    expect(totals["t3"]).toBe(10);
    expect(results.warnings).toEqual([
      { action: bad, message: expect.stringContaining("must be a number") },
    ]);
  });

  it("a select value that isn't one of its options", () => {
    const input = withIds(
      smallEvent({ scores: [{ t1: 5 }], actions: [set("t1", "huge", "size")] }),
    );
    const [activity] = input.activities;
    if (!activity) throw new Error("no Activity");
    const size: ScoringField = {
      id: "size",
      label: "Size",
      type: "select",
      kind: "info",
      audience: "judge",
      sortOrder: 2,
      weight: 1,
      config: { options: ["small", "large"] },
    } as ScoringField;
    const results = scoreEvent({
      ...input,
      activities: [
        {
          ...activity,
          scoring: { fields: [...activity.scoring.fields, size] },
        },
      ],
    });
    expect(results.warnings).toEqual([
      {
        action: expect.objectContaining({ type: "set-field-value" }),
        message:
          "set-field-value: Size must be one of the listed options; left out",
      },
    ]);
  });

  it("only the effective correction is checked", () => {
    const { results } = run([set("t3", "lots"), set("t3", 12)]);
    expect(results.warnings).toEqual([]);
  });
});

describe("corrections to Common Fields, finalized Activities and listing", () => {
  it("a correction to a Common Field works", () => {
    const common: CommonFieldSet = CommonFieldSetSchema.parse({
      schemaVersion: "4.0",
      kind: "common-field-set",
      id: "0196cfa2-4c00-7000-8000-000000000040",
      slug: "common",
      title: "Common Fields",
      fields: [
        {
          id: "flag",
          label: "Flag",
          type: "number",
          kind: "points",
          audience: "judge",
          sortOrder: 1,
        },
      ],
    });
    const input = withIds(
      smallEvent({
        scores: [{ t1: 5, t2: 4 }],
        actions: [set("t2", 10, "flag")],
      }),
    );
    const results = scoreEvent({
      ...input,
      event: {
        ...input.event,
        competitions: input.event.competitions.map((c) => ({
          ...c,
          commonFields: { setId: common.id, before: [], after: ["flag"] },
        })),
      },
      commonFieldSets: [common],
    });
    expect(results.warnings).toEqual([]);
    expect(results.activities[0]?.entries[1]).toMatchObject({ total: 14 });
  });

  it("on a finalized Activity, a correction logged after finalize waits", () => {
    const finalize: OfficialAction = {
      type: "finalize",
      activityId: A,
      ranking: [
        { entrantId: "t1", rank: 1, points: 10, disqualified: false },
        { entrantId: "t2", rank: 2, points: 8, disqualified: false },
      ],
    };
    const input = withIds(
      smallEvent({
        scores: [{ t1: 30, t2: 20 }],
        actions: [finalize, set("t2", 99)],
      }),
    );
    const results = scoreEvent(input);
    expect(results.activities[0]?.finalized).toBe(true);
    expect(results.activities[0]?.entries.map((e) => e.entrantId)).toEqual([
      "t1",
      "t2",
    ]);
    expect(results.warnings).toContainEqual({
      action: expect.objectContaining({ type: "set-field-value" }),
      message: expect.stringContaining("won't apply until it's unfinalized"),
    });
  });

  it("the primary-metric listing uses the corrected value", () => {
    const input = withIds(
      smallEvent({
        scores: [{ t1: 5, t2: 5 }],
        actions: [set("t2", 9, "measure")],
      }),
    );
    const [activity] = input.activities;
    if (!activity) throw new Error("no Activity");
    const measure: ScoringField = {
      id: "measure",
      label: "Measure",
      type: "number",
      kind: "metric",
      audience: "judge",
      sortOrder: 2,
      weight: 1,
      primary: { direction: "higher-wins" },
    } as ScoringField;
    const results = scoreEvent({
      ...input,
      activities: [
        {
          ...activity,
          scoring: { fields: [...activity.scoring.fields, measure] },
        },
      ],
      entries: input.entries.map((e) => ({
        ...e,
        values: { ...e.values, measure: e.entrantId === "t1" ? 3 : 1 },
      })),
    });
    // Ties on points, so ranks tie; the listing order is t2 first by its corrected measure of 9.
    expect(results.activities[0]?.entries.map((e) => e.entrantId)).toEqual([
      "t2",
      "t1",
    ]);
  });
});
