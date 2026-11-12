import { checkEventBundle } from "@camporee-conductor/cartridge";
import {
  ScoringFieldSchema,
  type Activity,
  type CommonFieldSet,
  type Event,
} from "@camporee-conductor/schema";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addStarterField, STARTER_FIELDS } from "./starter-fields.ts";

const FIXTURE = new URL(
  "../../../packages/schema/fixtures/circus-2026/",
  import.meta.url,
);
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));
const event = read("event.json") as Event;
const set = read("common-fields.json") as CommonFieldSet;
const activities = readdirSync(new URL("activities/", FIXTURE))
  .filter((f) => f.endsWith(".json"))
  .map((f) => read(`activities/${f}`) as Activity);

describe("starter fields (#99): a fixed list, never a copy of a Common Field", () => {
  it("each starter is a valid scoring field, none primary", () => {
    expect(STARTER_FIELDS.length).toBeGreaterThanOrEqual(5);
    for (const starter of STARTER_FIELDS) {
      expect(ScoringFieldSchema.safeParse(starter.field).success).toBe(true);
      expect(starter.field.primary).toBeUndefined();
    }
    const keys = STARTER_FIELDS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("adds a starter last, numbered in tens, with an id the Activity doesn't have", () => {
    const [first] = STARTER_FIELDS;
    if (!first) throw new Error("no starters");
    const once = addStarterField([], first.key, []);
    expect(once).toEqual([{ ...first.field, sortOrder: 10 }]);
    const twice = addStarterField(once, first.key, []);
    expect(twice.map((f) => f.id)).toEqual([
      first.field.id,
      `${first.field.id}_2`,
    ]);
    expect(twice[1]?.sortOrder).toBe(20);
  });

  it("never takes the id of a Common Field the Activity's Competition applies", () => {
    for (const starter of STARTER_FIELDS) {
      const added = addStarterField([], starter.key, [starter.field.id]);
      expect(added[0]?.id).toBe(`${starter.field.id}_2`);
    }
  });

  it("every starter, added to every Patrol Games Activity, keeps the Circus Event valid", () => {
    const games = event.competitions[0];
    const applied = [
      ...(games?.commonFields?.before ?? []),
      ...(games?.commonFields?.after ?? []),
    ];
    const inGames = new Set(
      event.activities
        .filter((a) => a.competitionId === games?.id)
        .map((a) => a.activityId),
    );
    const changed = activities.map((activity) => {
      if (!inGames.has(activity.id)) return activity;
      let fields = activity.scoring.fields;
      for (const starter of STARTER_FIELDS) {
        fields = addStarterField(fields, starter.key, applied);
      }
      return { ...activity, scoring: { ...activity.scoring, fields } };
    });
    const check = checkEventBundle({
      event,
      activities: changed,
      commonFieldSets: [set],
    });
    expect(check.ok ? [] : check.issues).toEqual([]);
  });

  it("refuses a key that isn't on the list", () => {
    expect(() => addStarterField([], "nope", [])).toThrow(/no starter field/);
  });
});
