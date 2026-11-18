/**
 * Issue #10: the Circus 2026 results, imported through the shared v1 normalization, keep all 53 values whose v1
 * field ids ended in a space, under the trimmed ids the transcode gave those fields. Without it they match no field
 * and drop out of the totals.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "./circus-2026-as-run.ts";

const SPACED: [v1GameId: string, fieldId: string, values: number][] = [
  ["buried-bearded-ladys-jewels", "field_1778195167953", 9],
  ["buried-bearded-ladys-jewels", "field_1778195205040", 9],
  ["buried-bearded-ladys-jewels", "field_1778195292154", 9],
  ["buried-bearded-ladys-jewels", "field_1778195322777", 9],
  ["clown-car", "field_1778199810679", 6],
  ["setting-up-the-big-top", "field_1778193741073", 6],
  ["trapeze-swing-assembly", "field_1778197726672", 5],
];

describe("Circus 2026 results with spaced v1 field ids (#10)", () => {
  const { input, activityIdOf } = loadCircus2026AsRun();

  it("the fixture really has the 53 spaced keys", () => {
    const scores = JSON.parse(
      readFileSync(
        new URL("../fixtures/circus-2026-results/scores.json", import.meta.url),
        "utf8",
      ),
    ) as { score_payload: Record<string, unknown> }[];
    const spaced = scores.flatMap((s) =>
      Object.keys(s.score_payload).filter((k) => k !== k.trim()),
    );
    expect(spaced).toHaveLength(53);
  });

  it.each(SPACED)(
    "%s keeps %s's values under the trimmed id",
    (game, fieldId, values) => {
      const activityId = activityIdOf(game);
      const activity = input.activities.find((a) => a.id === activityId);
      expect(activity?.scoring.fields.map((f) => f.id)).toContain(fieldId);
      const kept = input.entries.filter(
        (e) => e.activityId === activityId && fieldId in e.values,
      );
      expect(kept).toHaveLength(values);
    },
  );

  it("no entry keeps a key with whitespace", () => {
    const keys = input.entries.flatMap((e) => Object.keys(e.values));
    expect(keys.filter((k) => k !== k.trim())).toEqual([]);
  });
});
