import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ActivitySchema, type Activity } from "./activity.ts";
import { CommonFieldSetSchema } from "./common-field-set.ts";
import { EventSchema } from "./event.ts";
import { issuesOf } from "./test-support.ts";

const DIR = new URL("../fixtures/circus-2026/", import.meta.url);
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, DIR), "utf8"));

const activityFiles = readdirSync(new URL("activities/", DIR)).filter((f) =>
  f.endsWith(".json"),
);
const rawEvent = readJson("event.json");
const rawSet = readJson("common-fields.json");
const rawActivities = activityFiles.map((f) => readJson(`activities/${f}`));

describe("Circus 2026 fixtures: every document validates", () => {
  it("event.json", () => {
    expect(issuesOf(EventSchema, rawEvent)).toEqual([]);
  });

  it("common-fields.json", () => {
    expect(issuesOf(CommonFieldSetSchema, rawSet)).toEqual([]);
  });

  it.each(activityFiles.map((f, i) => [f, rawActivities[i]]))(
    "activities/%s",
    (_file, raw) => {
      expect(issuesOf(ActivitySchema, raw)).toEqual([]);
    },
  );
});

describe("Circus 2026 fixtures: content and references", () => {
  const event = EventSchema.parse(rawEvent);
  const set = CommonFieldSetSchema.parse(rawSet);
  const activities = rawActivities.map((a) => ActivitySchema.parse(a));
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const competitionBySlug = new Map(event.competitions.map((c) => [c.slug, c]));

  const activitiesIn = (slug: string): Activity[] => {
    const competition = competitionBySlug.get(slug);
    return event.activities
      .filter((entry) => entry.competitionId === competition?.id)
      .map((entry) => activityById.get(entry.activityId))
      .filter((a): a is Activity => a !== undefined);
  };

  it("has 3 Competitions and 34 Activities: 18 ranked patrol, 12 ranked troop, 4 exhibition", () => {
    expect([...competitionBySlug.keys()].sort()).toEqual([
      "exhibition",
      "patrol-games",
      "troop-challenges",
    ]);
    expect(activities).toHaveLength(34);
    const summary = (slug: string) =>
      activitiesIn(slug).map((a) => a.scoringType);
    expect(summary("patrol-games")).toEqual(Array(18).fill("ranked"));
    expect(summary("troop-challenges")).toEqual(Array(12).fill("ranked"));
    expect(summary("exhibition")).toEqual(Array(4).fill("exhibition"));
  });

  it("lists each Activity file exactly once in the Event", () => {
    expect(event.activities.map((e) => e.activityId).sort()).toEqual(
      activities.map((a) => a.id).sort(),
    );
  });

  it("keeps v1's playlist order and v1 ids", () => {
    const v1 = readJson("v1-source/camporee.json") as {
      playlist: { gameId: string; order: number }[];
    };
    const ordered = [...event.activities]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((entry) => activityById.get(entry.activityId)?.legacy?.v1Id);
    const v1Ordered = [...v1.playlist]
      .sort((a, b) => a.order - b.order)
      .map((p) => p.gameId);
    expect(ordered).toEqual(v1Ordered);
  });

  it("gives every document a distinct id", () => {
    const ids = [
      event.id,
      set.id,
      ...event.competitions.map((c) => c.id),
      ...activities.map((a) => a.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("references only Common Fields that exist in the set", () => {
    const fieldIds = new Set(set.fields.map((f) => f.id));
    for (const competition of event.competitions) {
      if (!competition.commonFields) continue;
      expect(competition.commonFields.setId).toBe(set.id);
      const referenced = [
        ...competition.commonFields.before,
        ...competition.commonFields.after,
      ];
      expect(referenced.filter((id) => !fieldIds.has(id))).toEqual([]);
    }
  });

  it("defines every {{variable}} used by its Competition's Common Field labels", () => {
    const fieldById = new Map(set.fields.map((f) => [f.id, f]));
    const missing: string[] = [];
    for (const competition of event.competitions) {
      const common = competition.commonFields;
      if (!common) continue;
      const tokens = [...common.before, ...common.after].flatMap((id) => {
        const field = fieldById.get(id);
        const text = `${field?.label ?? ""} ${field?.config?.placeholder ?? ""}`;
        return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? "");
      });
      for (const activity of activitiesIn(competition.slug)) {
        for (const token of tokens) {
          if (activity.variables?.[token] === undefined) {
            missing.push(`${activity.slug}: {{${token}}}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("sets every weight to 1 and keeps v1's weight in legacy (v1 never applied weight)", () => {
    const v1Weights = (inputs: { weight: number }[]) =>
      inputs.map((i) => i.weight);
    for (const activity of activities) {
      const v1 = readJson(`v1-source/games/${activity.slug}.json`) as {
        scoring_model: { inputs: { weight: number }[] };
      };
      const fields = activity.scoring.fields;
      expect(fields.map((f) => f.weight)).toEqual(fields.map(() => 1));
      expect(fields.map((f) => f.legacy?.v1Weight)).toEqual(
        v1Weights(v1.scoring_model.inputs),
      );
    }
    const presets = readJson("v1-source/presets.json") as {
      id: string;
      weight: number;
    }[];
    const presetWeight = new Map(presets.map((p) => [p.id, p.weight]));
    for (const field of set.fields) {
      expect(field.weight).toBe(1);
      expect(field.legacy?.v1Weight).toBe(presetWeight.get(field.id));
    }
  });

  it("corrects the Patrol Flag placeholder to its real 0-5 range", () => {
    const flag = set.fields.find((f) => f.id === "p_flag");
    expect(flag?.config).toMatchObject({ max: 5, placeholder: "0-5 Points" });
  });
});
