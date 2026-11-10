import { describe, expect, it } from "vitest";
import {
  actionProblem,
  finalizeRanking,
  scoreEvent,
  type OfficialAction,
  type ScoringInput,
} from "./index.ts";
import { activityId, smallEvent } from "./test-support.ts";

// An Official moves one score entry to another entrant (ADR-0019, reassign-entry; #42 PR 6). Each entry's id is
// `e-<entrant>`; entrants t1 and t2 have entries at the first Activity, t3 is an entrant with none there.

const A = activityId(0);

const move = (
  entryId: string,
  toEntrantId: string,
  entrantId = entryId.replace("e-", ""),
): OfficialAction => ({
  type: "reassign-entry",
  activityId: A,
  entrantId,
  entryId,
  toEntrantId,
});

function build(
  actions: OfficialAction[] = [],
  scores: Record<string, number> = { t2: 20, t1: 30 },
  extra: Partial<ScoringInput["entries"][number]>[] = [],
): ScoringInput {
  const input = smallEvent({ scores: [scores, { t3: 5 }], actions });
  return {
    ...input,
    entries: [
      ...input.entries.map((e, i) => ({
        ...e,
        id: `e-${e.entrantId}`,
        judgeId: `judge-${i}`,
      })),
      ...extra.map((e) => ({
        activityId: A,
        entrantId: "t1",
        values: { score: 1 },
        ...e,
      })),
    ],
  };
}

const first = (input: ScoringInput) => {
  const results = scoreEvent(input);
  const activity = results.activities[0];
  if (!activity) throw new Error("no results");
  return {
    results,
    activity,
    totals: Object.fromEntries(
      activity.entries.map((e) => [e.entrantId, e.total]),
    ),
  };
};

describe("reassign-entry", () => {
  it("an entry counts for the entrant it was moved to", () => {
    const { totals, activity } = first(build([move("e-t1", "t3")]));
    expect(totals).toEqual({ t2: 20, t3: 30 });
    const t3 = activity.entries.find((e) => e.entrantId === "t3");
    expect(t3?.entryId).toBe("e-t1");
    expect(t3?.reassignments).toEqual([
      {
        actionIndex: 0,
        entryId: "e-t1",
        fromEntrantId: "t1",
        toEntrantId: "t3",
        state: "applied",
      },
    ]);
  });

  it("it can make a conflict at the target, and the newest entry counts there", () => {
    const { activity } = first(build([move("e-t1", "t2")]));
    const t2 = activity.entries.find((e) => e.entrantId === "t2");
    expect(activity.entries.map((e) => e.entrantId)).toEqual(["t2"]);
    expect(t2?.conflict).toBe("unresolved");
    expect(t2?.entryId).toBe("e-t1");
    expect(t2?.total).toBe(30);
  });

  it("the latest reassign of an entry wins", () => {
    const { totals } = first(
      build([move("e-t1", "t2"), move("e-t1", "t3", "t2")]),
    );
    expect(totals).toEqual({ t2: 20, t3: 30 });
  });

  it("reassigning back undoes it, and reports nothing to undo", () => {
    const { totals, activity } = first(
      build([move("e-t1", "t3"), move("e-t1", "t1", "t3")]),
    );
    expect(totals).toEqual({ t2: 20, t1: 30 });
    expect(activity.entries.flatMap((e) => e.reassignments)).toEqual([]);
  });

  it("a reassign logged after the finalize waits for unfinalize", () => {
    const base = build();
    const ranking = finalizeRanking(first(base).activity);
    const finalize: OfficialAction = {
      type: "finalize",
      activityId: A,
      ranking,
    };
    const held = first(build([finalize, move("e-t1", "t3")]));
    expect(held.activity.finalized).toBe(true);
    expect(held.activity.entries.map((e) => e.entrantId)).toEqual(
      ranking.map((r) => r.entrantId),
    );
    expect(
      held.activity.entries.find((e) => e.entrantId === "t1")?.reassignments,
    ).toEqual([
      {
        actionIndex: 1,
        entryId: "e-t1",
        fromEntrantId: "t1",
        toEntrantId: "t3",
        state: "held",
      },
    ]);
    expect(
      held.results.warnings.flatMap((w) =>
        "action" in w ? [w.action.type] : [],
      ),
    ).toContain("reassign-entry");
    const after = first(
      build([
        finalize,
        move("e-t1", "t3"),
        { type: "unfinalize", activityId: A },
      ]),
    );
    expect(after.totals).toEqual({ t2: 20, t3: 30 });
  });

  it("a correction follows its entry, whichever entrant it was logged with", () => {
    const fix = (entrantId: string): OfficialAction => ({
      type: "set-field-value",
      activityId: A,
      entrantId,
      entryId: "e-t1",
      fieldId: "score",
      value: 99,
    });
    expect(first(build([fix("t1"), move("e-t1", "t3")])).totals).toEqual({
      t2: 20,
      t3: 99,
    });
    expect(first(build([move("e-t1", "t3"), fix("t3")])).totals).toEqual({
      t2: 20,
      t3: 99,
    });
  });

  it("a choice stays with its entrant: moving the chosen entry away reopens it", () => {
    const input = build(
      [
        {
          type: "choose-entry",
          activityId: A,
          entrantId: "t1",
          entryId: "e-t1",
          newestEntryId: "e-t1b",
        },
        move("e-t1", "t3"),
      ],
      { t1: 30 },
      [{ id: "e-t1b", judgeId: "judge-x" }],
    );
    const { activity } = first(input);
    const t1 = activity.entries.find((e) => e.entrantId === "t1");
    expect(t1?.entryId).toBe("e-t1b");
    expect(t1?.choice?.state).toBe("reopened");
  });

  it("an off-roster entry is reported, not scored, until it is moved to a real entrant", () => {
    const ghost = {
      id: "e-ghost",
      activityId: A,
      entrantId: "ghost",
      judgeId: "judge-g",
      values: { score: 7 },
    };
    const before = build([]);
    const withGhost = { ...before, entries: [...before.entries, ghost] };
    const a = first(withGhost);
    expect(a.totals).toEqual({ t2: 20, t1: 30 });
    expect(a.activity.offRoster).toEqual([
      { entrantId: "ghost", entryId: "e-ghost" },
    ]);
    const b = first({
      ...withGhost,
      actions: [move("e-ghost", "t3", "ghost")],
    });
    expect(b.totals).toEqual({ t2: 20, t1: 30, t3: 7 });
    expect(b.activity.offRoster).toEqual([]);
  });

  it("an invalid reassign is left out, with a warning", () => {
    const cases: [string, OfficialAction][] = [
      ["no such entry", move("e-nope", "t3", "t1")],
      ["not in Competition", move("e-t1", "nobody")],
      ["already there", move("e-t1", "t1")],
      ["the entry isn't that entrant's", move("e-t1", "t3", "t2")],
    ];
    for (const [name, action] of cases) {
      const { totals, results } = first(build([action]));
      expect(totals, name).toEqual({ t2: 20, t1: 30 });
      expect(results.warnings, name).toHaveLength(1);
    }
  });

  it("actionProblem takes the entry's original or current entrant", () => {
    const input = build([move("e-t1", "t3")]);
    expect(actionProblem(input, move("e-t1", "t2", "t1"))).toBeUndefined();
    expect(actionProblem(input, move("e-t1", "t2", "t3"))).toBeUndefined();
    expect(actionProblem(input, move("e-t1", "t3", "t3"))).toMatch(
      /already counts for/,
    );
  });
});
