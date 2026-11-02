import { ActivitySchema } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "../scripts/circus-2026-as-run.ts";
import {
  scoreEvent,
  stopwatchSeconds,
  type FieldValue,
  type ScoringInput,
} from "./index.ts";
import { smallEvent } from "./test-support.ts";

describe("stopwatchSeconds: stopwatch text → seconds", () => {
  it.each([
    ["01:32", 92],
    ["1:32", 92],
    ["00:24.5", 24.5],
    ["1:02:03", 3723],
    ["24:37", 1477],
  ])("%s → %d", (text, seconds) => {
    expect(stopwatchSeconds(text)).toBe(seconds);
  });

  it.each([["00:00"], ["0:00:00"], [""], ["  "], ["abc"], ["1:75"], [null]])(
    "%j is no time",
    (value) => {
      expect(stopwatchSeconds(value as FieldValue)).toBeUndefined();
    },
  );
});

/**
 * A small Event whose one Activity also has a primary metric `measure` (direction `listing`), with these
 * raw values; `points` are the judged points that rank it.
 */
function measured({
  type,
  listing,
  values,
  points,
  direction = "higher-wins",
}: {
  type: "number" | "stopwatch";
  listing: "higher-wins" | "lower-wins";
  values: Record<string, FieldValue>;
  points: Record<string, number>;
  direction?: "higher-wins" | "lower-wins";
}): ScoringInput {
  const input = smallEvent({ scores: [points] });
  const [activity] = input.activities;
  if (!activity) throw new Error("no Activity");
  return {
    ...input,
    activities: [
      ActivitySchema.parse({
        ...activity,
        scoring: {
          direction,
          fields: [
            ...activity.scoring.fields,
            {
              id: "measure",
              label: "Measure",
              type,
              kind: "metric",
              audience: "judge",
              sortOrder: 2,
              primary: { direction: listing },
            },
          ],
        },
      }),
    ],
    entries: input.entries.map((e) => ({
      ...e,
      values: { ...e.values, measure: values[e.entrantId] ?? null },
    })),
  };
}

const listed = (input: ScoringInput) =>
  scoreEvent(input).activities[0]?.entries.map((e) => e.entrantId);

describe("Measured Activities: entries listed by the primary metric (ADR-0019)", () => {
  it("lists by a stopwatch time, lowest first, untimed (00:00, blank) last in entry order", () => {
    expect(
      listed(
        measured({
          type: "stopwatch",
          listing: "lower-wins",
          values: {
            t1: "01:32",
            t2: "00:00",
            t3: "00:58",
            t4: "",
            t5: "01:10",
          },
          points: { t1: 1, t2: 1, t3: 1, t4: 1, t5: 1 },
        }),
      ),
    ).toEqual(["t3", "t5", "t1", "t2", "t4"]);
  });

  it("lists by a number, highest first; 0 is a real count", () => {
    expect(
      listed(
        measured({
          type: "number",
          listing: "higher-wins",
          values: { t1: 3, t2: "12", t3: 0, t4: null },
          points: { t1: 1, t2: 1, t3: 1, t4: 1 },
        }),
      ),
    ).toEqual(["t2", "t1", "t3", "t4"]);
  });

  it("uses the metric's own direction, not the Activity's (points higher-wins, time lower-wins)", () => {
    expect(
      listed(
        measured({
          type: "stopwatch",
          listing: "lower-wins",
          direction: "higher-wins",
          values: { t1: "24:37", t2: "07:47", t3: "13:34" },
          points: { t1: 1, t2: 1, t3: 1 },
        }),
      ),
    ).toEqual(["t2", "t3", "t1"]);
  });

  it("keeps entry order for equal values", () => {
    expect(
      listed(
        measured({
          type: "number",
          listing: "higher-wins",
          values: { t1: 5, t2: 9, t3: 5 },
          points: { t1: 1, t2: 1, t3: 1 },
        }),
      ),
    ).toEqual(["t2", "t1", "t3"]);
  });

  it("ranks by points, not by the metric", () => {
    const [activity] = scoreEvent(
      measured({
        type: "stopwatch",
        listing: "lower-wins",
        values: { t1: "00:30", t2: "01:00" },
        points: { t1: 10, t2: 20 },
      }),
    ).activities;
    expect(
      activity?.entries.map((e) => [
        e.entrantId,
        e.disqualified ? "DQ" : e.finalRank,
      ]),
    ).toEqual([
      ["t1", 2],
      ["t2", 1],
    ]);
  });

  it("lists entries as entered when the Activity has no primary metric", () => {
    expect(
      listed(smallEvent({ scores: [{ t1: 10, t2: 30, t3: 20 }] })),
    ).toEqual(["t1", "t2", "t3"]);
  });
});

describe("Measured Activities on real Circus 2026 times", () => {
  it("the-tumbled-trapeze-rescue: fastest first, the untimed 00:00 last", () => {
    const circus = loadCircus2026AsRun();
    const id = circus.activityIdOf("the-tumbled-trapeze-rescue");
    const input: ScoringInput = {
      ...circus.input,
      activities: circus.input.activities.map((a) =>
        a.id !== id
          ? a
          : ActivitySchema.parse({
              ...a,
              scoring: {
                ...a.scoring,
                fields: a.scoring.fields.map((f) =>
                  f.id === "elapsed_time"
                    ? { ...f, primary: { direction: "lower-wins" } }
                    : f,
                ),
              },
            }),
      ),
    };
    const entries =
      scoreEvent(input).activities.find((a) => a.activityId === id)?.entries ??
      [];
    const time = (entrantId: string) =>
      input.entries.find(
        (e) => e.activityId === id && e.entrantId === entrantId,
      )?.values["elapsed_time"];
    expect(entries.map((e) => time(e.entrantId))).toEqual([
      "00:58",
      "01:09",
      "01:10",
      "01:23",
      "01:32",
      "01:43",
      "01:55",
      "01:56",
      "03:05",
      "04:47",
      "00:00",
    ]);
  });
});
