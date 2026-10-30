import { describe, expect, it } from "vitest";
import {
  exportCollatorTables,
  REDACTED,
  type CollatorTables,
  type FieldTypeOf,
} from "./collator-export.ts";

// Made-up rows in the shape of v1's Collator tables. No real data in tests.
const tables = (): CollatorTables => ({
  entities: [
    {
      id: "p2",
      name: "Flaming Arrows",
      type: "patrol",
      troop_number: "T7",
      parent_id: "t7",
      manual_rank: null,
    },
    {
      id: "p1",
      name: "Night Owls",
      type: "patrol",
      troop_number: "T7",
      parent_id: "t7",
      manual_rank: null,
    },
  ],
  judges: [
    { id: 12, name: "Zed Example", email: "zed@example.com", unit: "T7" },
    { id: 3, name: "Amy Example", email: "amy@example.com", unit: null },
  ],
  scores: [
    {
      uuid: "u2",
      game_id: "relay",
      entity_id: "p2",
      score_payload: JSON.stringify({
        elapsed_time: "02:15",
        elapsed_time_pts: "90",
        p_flag: "5",
        off_notes: "Amy Example says the patrol was great",
        manual_rank: "1",
        manual_points: 100,
      }),
      timestamp: 2000,
      judge_id: 12,
    },
    {
      uuid: "u1",
      game_id: "relay",
      entity_id: "p1",
      score_payload: JSON.stringify({
        elapsed_time: "",
        p_flag: "4",
        off_notes: "",
        mystery_key: "free text nobody declared",
      }),
      timestamp: 1000,
      judge_id: 3,
    },
  ],
  gameStatus: [{ game_id: "relay", status: "finalized" }],
});

const fieldTypeOf: FieldTypeOf = (_gameId, fieldId) =>
  ({ elapsed_time: "stopwatch", p_flag: "number", off_notes: "textarea" })[
    fieldId
  ];

describe("exportCollatorTables", () => {
  const out = exportCollatorTables(tables(), fieldTypeOf);
  const text = JSON.stringify(out);

  it("renames judges Judge 1, Judge 2… in original id order, dropping name, email and unit", () => {
    expect(out.judges).toEqual([
      { id: 1, name: "Judge 1" },
      { id: 2, name: "Judge 2" },
    ]);
    for (const secret of [
      "Zed Example",
      "zed@example.com",
      "amy@example.com",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("points each score at its renumbered judge", () => {
    expect(out.scores.map((s) => [s.uuid, s.judge_id])).toEqual([
      ["u1", 1],
      ["u2", 2],
    ]);
  });

  it("redacts non-empty free text, which can contain names", () => {
    const [first, second] = out.scores;
    expect(second?.score_payload["off_notes"]).toBe(REDACTED);
    expect(first?.score_payload["off_notes"]).toBe("");
    expect(first?.score_payload["mystery_key"]).toBe(REDACTED);
    expect(text).not.toContain("Amy Example");
  });

  it("keeps everything scoring reads: numbers, times, Official points and overrides", () => {
    expect(out.scores[1]?.score_payload).toMatchObject({
      elapsed_time: "02:15",
      elapsed_time_pts: "90",
      p_flag: "5",
      manual_rank: "1",
      manual_points: 100,
    });
  });

  it("writes only entities, judges, scores and game status, in a stable order", () => {
    expect(Object.keys(out)).toEqual([
      "entities",
      "judges",
      "scores",
      "gameStatus",
    ]);
    expect(out.entities.map((e) => e.id)).toEqual(["p1", "p2"]);
    expect(out.scores.map((s) => s.uuid)).toEqual(["u1", "u2"]);
  });
});
