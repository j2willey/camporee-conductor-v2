import {
  CommonFieldSetSchema,
  type CommonFieldSet,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { mergeCommonFields, scoreEvent, type ScoringInput } from "./index.ts";
import { smallEvent } from "./test-support.ts";

/** Common Fields, merged per Competition at runtime and nowhere else (ADR-0020). */
const SET: CommonFieldSet = CommonFieldSetSchema.parse({
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
    {
      id: "spirit",
      label: "Spirit",
      type: "number",
      kind: "points",
      audience: "judge",
      sortOrder: 2,
    },
    {
      id: "late",
      label: "Late",
      type: "number",
      kind: "penalty",
      audience: "official",
      sortOrder: 3,
    },
  ],
});

/** smallEvent's Competition using SET: `before` and `after` field ids. */
function withCommonFields(
  input: ScoringInput,
  before: string[],
  after: string[],
): ScoringInput {
  return {
    ...input,
    event: {
      ...input.event,
      competitions: input.event.competitions.map((c) => ({
        ...c,
        commonFields: { setId: SET.id, before, after },
      })),
    },
    commonFieldSets: [SET],
  };
}

describe("mergeCommonFields (ADR-0020)", () => {
  const input = withCommonFields(
    smallEvent({ scores: [{ t1: 1 }] }),
    ["flag"],
    ["spirit", "late"],
  );
  const [activity] = input.activities;
  const [competition] = input.event.competitions;
  if (!activity || !competition) throw new Error("no Activity");

  it("puts the Competition's `before` fields first, then the Activity's, then its `after` fields", () => {
    expect(
      mergeCommonFields(activity, competition, input.commonFieldSets).map(
        (f) => f.id,
      ),
    ).toEqual(["flag", "score", "spirit", "late"]);
  });

  it("leaves the Activity's own fields alone when the Competition has no Common Fields", () => {
    const [plain] = smallEvent({ scores: [{ t1: 1 }] }).event.competitions;
    if (!plain) throw new Error("no Competition");
    expect(mergeCommonFields(activity, plain, []).map((f) => f.id)).toEqual([
      "score",
    ]);
  });

  it("never copies Common Fields into the Activity document", () => {
    mergeCommonFields(activity, competition, input.commonFieldSets);
    expect(activity.scoring.fields.map((f) => f.id)).toEqual(["score"]);
  });

  it("names the missing set or field instead of scoring without it", () => {
    expect(() => mergeCommonFields(activity, competition, [])).toThrow(
      /uses Common Field set .* which isn't given/,
    );
    const [missing] = withCommonFields(input, ["nope"], []).event.competitions;
    if (!missing) throw new Error("no Competition");
    expect(() =>
      mergeCommonFields(activity, missing, input.commonFieldSets),
    ).toThrow(/Common Field set common has no field nope/);
  });
});

describe("scoreEvent counts Common Fields in every entry's total", () => {
  it("adds `points` Common Fields and subtracts `penalty` ones", () => {
    const base = smallEvent({ scores: [{ t1: 10, t2: 10 }] });
    const input = withCommonFields(base, ["flag"], ["late"]);
    const scored = scoreEvent({
      ...input,
      entries: input.entries.map((e) => ({
        ...e,
        values: {
          ...e.values,
          ...(e.entrantId === "t1" ? { flag: 5, late: 2 } : { flag: 1 }),
        },
      })),
    });
    expect(
      scored.activities[0]?.entries.map((e) => [e.entrantId, e.total]),
    ).toEqual([
      ["t1", 13],
      ["t2", 11],
    ]);
  });
});
