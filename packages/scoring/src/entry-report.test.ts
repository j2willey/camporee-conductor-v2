import { describe, expect, it } from "vitest";
import {
  scoreEvent,
  type OfficialAction,
  type ScoreEntry,
  type ScoringInput,
} from "./index.ts";
import { activityId, smallEvent } from "./test-support.ts";

/** Scoring picks the counting entry and reports what it used (ADR-0019 2026-11-10, #42). */
const A = activityId(0);

const entry = (
  id: string,
  entrantId: string,
  score: number,
  judgeId?: string,
): ScoreEntry => ({
  id,
  activityId: A,
  entrantId,
  values: { score },
  ...(judgeId !== undefined && { judgeId }),
});

function run(entries: ScoreEntry[], actions: OfficialAction[] = []) {
  const base: ScoringInput = smallEvent({ scores: [{ t1: 0, t2: 0 }] });
  const results = scoreEvent({ ...base, entries, actions });
  const activity = results.activities[0];
  const of = (entrantId: string) =>
    activity?.entries.find((e) => e.entrantId === entrantId);
  return { results, activity, of };
}

const set = (
  entryId: string,
  value: number,
  entrantId = "t1",
): OfficialAction => ({
  type: "set-field-value",
  activityId: A,
  entrantId,
  entryId,
  fieldId: "score",
  value,
});

describe("scoreEvent takes every entry and the newest counts", () => {
  it("with several entries for one entrant, the newest counts and the others don't affect the total", () => {
    const { of, activity } = run([
      entry("a", "t1", 50),
      entry("b", "t2", 10),
      entry("c", "t1", 20),
    ]);
    expect(of("t1")).toMatchObject({
      total: 20,
      finalRank: 1,
      entryId: "c",
    });
    expect(of("t2")).toMatchObject({ total: 10, entryId: "b" });
    expect(activity?.entries).toHaveLength(2);
  });

  it("reports the entry id and the values it used", () => {
    const { of } = run([entry("a", "t1", 7)]);
    expect(of("t1")).toMatchObject({
      entryId: "a",
      values: { score: 7 },
      corrections: [],
      conflict: "none",
    });
  });

  it("entries without ids report no entry id", () => {
    const { of } = run([
      { activityId: A, entrantId: "t1", values: { score: 3 } },
    ]);
    expect(of("t1")?.entryId).toBeUndefined();
    expect(of("t1")?.values).toEqual({ score: 3 });
  });

  it("a DQ'd entrant still reports what it used", () => {
    const { of } = run(
      [entry("a", "t1", 7)],
      [
        {
          type: "disqualify",
          activityId: A,
          entrantId: "t1",
          disqualified: true,
        },
      ],
    );
    expect(of("t1")).toMatchObject({
      disqualified: true,
      entryId: "a",
      values: { score: 7 },
    });
  });
});

describe("correction states", () => {
  it("applied: on the counting entry, laid over the values, with the Judge's original", () => {
    const { of } = run([entry("a", "t1", 5)], [set("a", 9)]);
    expect(of("t1")).toMatchObject({
      total: 9,
      values: { score: 9 },
      corrections: [
        {
          actionIndex: 0,
          entryId: "a",
          fieldId: "score",
          value: 9,
          original: 5,
          state: "applied",
        },
      ],
    });
  });

  it("a reverted correction isn't reported", () => {
    const { of } = run(
      [entry("a", "t1", 5)],
      [
        set("a", 9),
        {
          type: "revert-field-value",
          activityId: A,
          entrantId: "t1",
          entryId: "a",
          fieldId: "score",
        },
      ],
    );
    expect(of("t1")?.corrections).toEqual([]);
    expect(of("t1")?.values).toEqual({ score: 5 });
  });

  it("superseded: on an older entry that a newer entry replaced", () => {
    const { of } = run(
      [entry("a", "t1", 5), entry("b", "t1", 6)],
      [set("a", 9)],
    );
    expect(of("t1")).toMatchObject({
      total: 6,
      entryId: "b",
      values: { score: 6 },
      corrections: [
        { entryId: "a", value: 9, original: 5, state: "superseded" },
      ],
    });
  });

  it("held: logged after the finalize that freezes the Activity, and not laid over the values", () => {
    const finalize: OfficialAction = {
      type: "finalize",
      activityId: A,
      ranking: [
        { entrantId: "t1", rank: 1, points: 10, disqualified: false },
        { entrantId: "t2", rank: 2, points: 8, disqualified: false },
      ],
    };
    const { of, activity } = run(
      [entry("a", "t1", 5), entry("b", "t2", 4)],
      [finalize, set("a", 99)],
    );
    expect(activity?.finalized).toBe(true);
    expect(of("t1")).toMatchObject({
      total: 5,
      finalRank: 1,
      values: { score: 5 },
      corrections: [{ actionIndex: 1, value: 99, original: 5, state: "held" }],
    });
  });

  it("a finalized Activity's entries carry the report fields", () => {
    const finalize: OfficialAction = {
      type: "finalize",
      activityId: A,
      ranking: [
        { entrantId: "t1", rank: 1, points: 10, disqualified: false },
        { entrantId: "t2", disqualified: true },
      ],
    };
    const { of } = run(
      [entry("a", "t1", 5, "j1"), entry("b", "t2", 4, "j1")],
      [finalize],
    );
    expect(of("t1")).toMatchObject({
      entryId: "a",
      values: { score: 5 },
      conflict: "none",
      corrections: [],
    });
    expect(of("t2")).toMatchObject({ entryId: "b", values: { score: 4 } });
  });

  it("actionIndex is the index in the actions as given, with an invalid action earlier in the log", () => {
    const bad: OfficialAction = {
      type: "set-field-value",
      activityId: A,
      entrantId: "t1",
      entryId: "a",
      fieldId: "nope",
      value: 1,
    };
    const { of, results } = run([entry("a", "t1", 5)], [bad, set("a", 9)]);
    expect(results.warnings).toHaveLength(1);
    expect(of("t1")?.corrections).toMatchObject([
      { actionIndex: 1, fieldId: "score", state: "applied" },
    ]);
  });
});

describe("conflict", () => {
  it("one Judge's two entries are none", () => {
    const { of } = run([entry("a", "t1", 5, "j1"), entry("b", "t1", 6, "j1")]);
    expect(of("t1")?.conflict).toBe("none");
  });

  it("two Judges' entries are unresolved, and the newest counts", () => {
    const { of } = run([entry("a", "t1", 5, "j1"), entry("b", "t1", 6, "j2")]);
    expect(of("t1")).toMatchObject({ conflict: "unresolved", entryId: "b" });
  });
});

const choose = (
  entryId: string,
  newestEntryId: string,
  entrantId = "t1",
): OfficialAction => ({
  type: "choose-entry",
  activityId: A,
  entrantId,
  entryId,
  newestEntryId,
});

describe("an Official chooses which entry counts", () => {
  const two = () => [entry("a", "t1", 5, "j1"), entry("b", "t1", 8, "j2")];

  it("choosing the older entry: its values and total count, and the conflict is resolved", () => {
    const { of } = run(two(), [choose("a", "b")]);
    expect(of("t1")).toMatchObject({
      entryId: "a",
      total: 5,
      values: { score: 5 },
      conflict: "resolved",
      choice: { actionIndex: 0, entryId: "a", state: "applied" },
    });
  });

  it("a newer entry after the choice reopens it, and the newest counts", () => {
    const { of } = run(
      [...two(), entry("c", "t1", 9, "j1")],
      [choose("a", "b")],
    );
    expect(of("t1")).toMatchObject({
      entryId: "c",
      total: 9,
      conflict: "reopened",
      choice: { actionIndex: 0, entryId: "a", state: "reopened" },
    });
  });

  it("choosing the newest is resolved", () => {
    const { of } = run(two(), [choose("b", "b")]);
    expect(of("t1")).toMatchObject({
      entryId: "b",
      total: 8,
      conflict: "resolved",
      choice: { state: "applied" },
    });
  });

  it("with a single Judge a choice is reported and the conflict stays none", () => {
    const { of } = run(
      [entry("a", "t1", 5, "j1"), entry("b", "t1", 8, "j1")],
      [choose("a", "b")],
    );
    expect(of("t1")).toMatchObject({
      entryId: "a",
      conflict: "none",
      choice: { state: "applied" },
    });
  });

  it("corrections follow their entry: choosing A brings back A's, and B's are not-counting", () => {
    const { of } = run(two(), [set("a", 6), set("b", 7), choose("a", "b")]);
    expect(of("t1")).toMatchObject({
      entryId: "a",
      total: 6,
      values: { score: 6 },
    });
    const states = Object.fromEntries(
      (of("t1")?.corrections ?? []).map((c) => [c.entryId, c.state]),
    );
    expect(states).toEqual({ a: "applied", b: "not-counting" });
  });

  it("a reopened choice leaves the older entry's corrections superseded", () => {
    const { of } = run(
      [...two(), entry("c", "t1", 9, "j1")],
      [set("a", 6), choose("a", "b")],
    );
    expect(of("t1")?.corrections).toMatchObject([
      { entryId: "a", state: "superseded" },
    ]);
  });

  it("a choice logged after a finalize is held, and the default still counts", () => {
    const finalize: OfficialAction = {
      type: "finalize",
      activityId: A,
      ranking: [
        { entrantId: "t1", rank: 1, points: 10, disqualified: false },
        { entrantId: "t2", rank: 2, points: 8, disqualified: false },
      ],
    };
    const { of } = run(
      [...two(), entry("x", "t2", 1)],
      [finalize, choose("a", "b")],
    );
    expect(of("t1")).toMatchObject({
      entryId: "b",
      total: 8,
      conflict: "unresolved",
      choice: { actionIndex: 1, entryId: "a", state: "held" },
    });
  });

  it("an unknown entry, or another entrant's entry, is left out with a warning", () => {
    const { of, results } = run(
      [...two(), entry("z", "t2", 3, "j1")],
      [choose("nope", "b"), choose("z", "b")],
    );
    expect(of("t1")).toMatchObject({ entryId: "b", conflict: "unresolved" });
    expect(of("t1")?.choice).toBeUndefined();
    expect(results.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it("an invalid latest choice is left out and warns; the earlier valid one doesn't come back", () => {
    const { of, results } = run(two(), [choose("a", "b"), choose("nope", "b")]);
    expect(results.warnings).toHaveLength(1);
    expect(of("t1")?.choice).toBeUndefined();
  });

  it("the latest choice wins", () => {
    const { of } = run(two(), [choose("a", "b"), choose("b", "b")]);
    expect(of("t1")).toMatchObject({
      entryId: "b",
      choice: { actionIndex: 1, entryId: "b", state: "applied" },
    });
  });
});

describe("a revert held by finalize", () => {
  it("is reported as held with the Judge's original, while the earlier correction still applies", () => {
    const finalize: OfficialAction = {
      type: "finalize",
      activityId: A,
      ranking: [{ entrantId: "t1", rank: 1, points: 10, disqualified: false }],
    };
    const { of } = run(
      [entry("a", "t1", 5)],
      [
        set("a", 9),
        finalize,
        {
          type: "revert-field-value",
          activityId: A,
          entrantId: "t1",
          entryId: "a",
          fieldId: "score",
        },
      ],
    );
    expect(of("t1")?.values).toEqual({ score: 9 });
    expect(of("t1")?.corrections).toMatchObject([
      { actionIndex: 0, value: 9, state: "applied" },
      {
        actionIndex: 2,
        entryId: "a",
        fieldId: "score",
        value: 5,
        original: 5,
        state: "held",
      },
    ]);
  });
});
