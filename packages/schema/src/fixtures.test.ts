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

  it("has 3 Competitions and 33 Activities: 18 ranked patrol, 11 ranked troop, 4 exhibition", () => {
    expect([...competitionBySlug.keys()].sort()).toEqual([
      "exhibition",
      "patrol-games",
      "troop-challenges",
    ]);
    expect(activities).toHaveLength(33);
    const summary = (slug: string) =>
      activitiesIn(slug).map((a) => a.scoringType);
    expect(summary("patrol-games")).toEqual(Array(18).fill("ranked"));
    expect(summary("troop-challenges")).toEqual(Array(11).fill("ranked"));
    expect(summary("exhibition")).toEqual(Array(4).fill("exhibition"));
  });

  it("marks the primary metric of 10 Measured Activities, all times or counts where lower wins (#3)", () => {
    expect(
      activities.flatMap((a) =>
        a.scoring.fields.flatMap((f) =>
          f.primary ? [`${a.slug} ${f.id} ${f.primary.direction}`] : [],
        ),
      ),
    ).toEqual([
      "3-ring-circus elapsed_time lower-wins",
      "circus-line elapsed_time lower-wins",
      "ducks-in-a-row total_turns lower-wins",
      "pioneering-train-performance elapsed_time lower-wins",
      "setting-up-the-big-top elapsed_time lower-wins",
      "sports-land-skis elapsed_time lower-wins",
      "the-a-frame-trapeze elapsed_time lower-wins",
      "the-barrel-of-monkeys-caravan elapsed_time lower-wins",
      "the-high-wire-fire-act base_time lower-wins",
      "the-tumbled-trapeze-rescue elapsed_time lower-wins",
    ]);
  });

  it("has Overall (1st to 3rd, Patrol Games) and Top Dog (top 25% of Troop Challenges) as Awards, not Activities (#3, #43)", () => {
    expect(activities.map((a) => a.slug)).not.toContain("top-dog");
    expect(
      event.awards?.map(({ slug, label, competitionId, scope, rule }) => ({
        slug,
        label,
        competitionId,
        scope,
        rule,
      })),
    ).toEqual([
      {
        slug: "overall",
        label: "Overall",
        competitionId: competitionBySlug.get("patrol-games")?.id,
        scope: "event",
        rule: { type: "places", names: ["1st", "2nd", "3rd"] },
      },
      {
        slug: "top-dog",
        label: "Top Dog",
        competitionId: competitionBySlug.get("troop-challenges")?.id,
        scope: "event",
        rule: { type: "top-percent", percent: 25 },
      },
    ]);
  });

  it("hides Patrol Games' Activities from the Program Guide and lists the rest (#5)", () => {
    expect(
      event.competitions.map((c) => [
        c.slug,
        c.programGuide?.listActivities ?? "default",
      ]),
    ).toEqual([
      ["patrol-games", false],
      ["exhibition", "default"],
      ["troop-challenges", "default"],
    ]);
  });

  it("has the 12 skills the 2026 Program Guide promised units (#5)", () => {
    expect(event.programGuide?.skills).toEqual([
      "Fire starting",
      "First aid",
      "Campfire entertainment",
      "Tent assembly",
      "Cooking",
      "Map and compass",
      "Color guard presentation",
      "Fitness",
      "Pioneering",
      "Lashings",
      "Teamwork",
      "Problem solving",
    ]);
  });

  it("lists each Activity file exactly once in the Event", () => {
    expect(event.activities.map((e) => e.activityId).sort()).toEqual(
      activities.map((a) => a.id).sort(),
    );
  });

  it("keeps v1's playlist order and v1 ids, without top-dog (an Award)", () => {
    const v1 = readJson("v1-source/camporee.json") as {
      playlist: { gameId: string; order: number }[];
    };
    const ordered = [...event.activities]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((entry) => activityById.get(entry.activityId)?.legacy?.v1Id);
    const v1Ordered = [...v1.playlist]
      .sort((a, b) => a.order - b.order)
      .map((p) => p.gameId)
      .filter((id) => id !== "top-dog");
    expect(ordered).toEqual(v1Ordered);
  });

  it("gives every document a distinct id", () => {
    const ids = [
      event.id,
      set.id,
      ...event.competitions.map((c) => c.id),
      ...activities.map((a) => a.id),
      ...(event.awards ?? []).map((a) => a.id),
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

// --- As-run Circus 2026 (issue #3) ------------------------------------------
// The design fixtures above carry Jim's post-event corrections (v1 BACKLOG 2026-06-18). The as-run
// fixtures are the cartridge the event laptop actually ran, used only by the scoring parity tests.

const AS_RUN = new URL("../fixtures/circus-2026-as-run/", import.meta.url);
const readAsRun = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, AS_RUN), "utf8"));
const asRunActivityFiles = readdirSync(new URL("activities/", AS_RUN)).filter(
  (f) => f.endsWith(".json"),
);

describe("Circus 2026 as-run fixtures", () => {
  const asRunEvent = EventSchema.parse(readAsRun("event.json"));
  const asRunSet = CommonFieldSetSchema.parse(readAsRun("common-fields.json"));
  const asRun = asRunActivityFiles.map((f) =>
    ActivitySchema.parse(readAsRun(`activities/${f}`)),
  );
  const design = rawActivities.map((a) => ActivitySchema.parse(a));
  const designBySlug = new Map(design.map((a) => [a.slug, a]));

  it("has the same Activities, Competitions and playlist order as the design, except top-dog", () => {
    // Top Dog is an Award in the design (#3); the as-run fixture keeps it as v1 ran it.
    expect(asRunActivityFiles.filter((f) => f !== "top-dog.json")).toEqual(
      activityFiles,
    );
    expect(asRunActivityFiles).toContain("top-dog.json");
    const slugById = new Map(asRun.map((a) => [a.id, a.slug]));
    const designEvent = EventSchema.parse(rawEvent);
    const designSlugById = new Map(design.map((a) => [a.id, a.slug]));
    const order = (e: typeof asRunEvent, slugs: Map<string, string>) =>
      [...e.activities]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((x) => slugs.get(x.activityId));
    expect(
      order(asRunEvent, slugById).filter((slug) => slug !== "top-dog"),
    ).toEqual(order(designEvent, designSlugById));
    expect(asRunEvent.competitions.map((c) => c.slug)).toEqual(
      designEvent.competitions.map((c) => c.slug),
    );
  });

  it("records v1's dense tie numbering in both event.json files, not by default (ADR-0019)", () => {
    for (const raw of [rawEvent, readAsRun("event.json")]) {
      expect((raw as { tieNumbering?: string }).tieNumbering).toBe("dense");
    }
  });

  it("has only the Overall Award: v1 ran Top Dog as a Troop Challenge (#43)", () => {
    expect(asRunEvent.awards?.map((a) => a.slug)).toEqual(["overall"]);
  });

  it("has no Program Guide settings: v1 had none (#5)", () => {
    expect(asRunEvent.programGuide).toBeUndefined();
    expect(asRunEvent.competitions.map((c) => c.programGuide)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("has its own ids, so the two fixtures are never mistaken for each other", () => {
    const designIds = new Set(design.map((a) => a.id));
    expect(asRun.filter((a) => designIds.has(a.id))).toEqual([]);
  });

  it("has the same Common Fields as the design", () => {
    const designSet = CommonFieldSetSchema.parse(rawSet);
    expect(asRunSet.fields).toEqual(designSet.fields);
  });

  it("differs from the design only in the documented scoring fields (TRANSCODE-NOTES)", () => {
    const differences: string[] = [];
    for (const a of asRun) {
      if (a.slug === "top-dog") continue; // an Award in the design (#3)
      const d = designBySlug.get(a.slug);
      if (!d) throw new Error(`no design Activity ${a.slug}`);
      expect(a.content, a.slug).toEqual(d.content);
      expect(a.variables, a.slug).toEqual(d.variables);
      expect(a.scoringType, a.slug).toBe(d.scoringType);
      expect(a.legacy?.v1ScoringMethod, a.slug).toBe(d.legacy?.v1ScoringMethod);
      const asRunFields = new Map(a.scoring.fields.map((f) => [f.id, f]));
      const designFields = new Map(d.scoring.fields.map((f) => [f.id, f]));
      for (const id of new Set([
        ...asRunFields.keys(),
        ...designFields.keys(),
      ])) {
        const x = asRunFields.get(id);
        const y = designFields.get(id);
        if (!x) {
          differences.push(`${a.slug} ${id}: design only`);
          continue;
        }
        if (!y) {
          differences.push(`${a.slug} ${id}: as-run only`);
          continue;
        }
        for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
          const xv = JSON.stringify(x[key as keyof typeof x]);
          const yv = JSON.stringify(y[key as keyof typeof y]);
          if (xv !== yv)
            differences.push(
              `${a.slug} ${id} ${key}: as-run ${xv}, design ${yv}`,
            );
        }
      }
    }
    expect(differences.sort()).toEqual(
      [
        // Reclassified after the event (v1 BACKLOG 2026-06-18): 7 fields across 6 games.
        '3-ring-circus hand_breaks kind: as-run "penalty", design "metric"',
        'sports-land-skis falls kind: as-run "penalty", design "metric"',
        'the-barrel-of-monkeys-caravan barrel_drops kind: as-run "penalty", design "metric"',
        'the-grand-entry retreat_penalty kind: as-run "penalty", design "metric"',
        'the-high-wire-fire-act fire_extinguished kind: as-run "penalty", design "points"',
        'the-high-wire-fire-act matches_used kind: as-run "penalty", design "metric"',
        'the-tumbled-trapeze-rescue patient_ground kind: as-run "penalty", design "metric"',
        // Stripped from the event-day cartridge by a v1 Composer export bug, restored after (e296c7c).
        "setting-up-the-big-top judge_notes: design only",
        "the-big-top-goes-down judge_notes: design only",
        "the-circus-orchestra judge_notes: design only",
        "the-grand-entry judge_notes: design only",
        "trapeze-swing-assembly judge_notes: design only",
        // Primary metrics are a v2 design decision (#3); v1 had none, so the as-run fixture has none.
        ...[
          "3-ring-circus elapsed_time",
          "circus-line elapsed_time",
          "ducks-in-a-row total_turns",
          "pioneering-train-performance elapsed_time",
          "setting-up-the-big-top elapsed_time",
          "sports-land-skis elapsed_time",
          "the-a-frame-trapeze elapsed_time",
          "the-barrel-of-monkeys-caravan elapsed_time",
          "the-high-wire-fire-act base_time",
          "the-tumbled-trapeze-rescue elapsed_time",
        ].map(
          (field) =>
            `${field} primary: as-run undefined, design {"direction":"lower-wins"}`,
        ),
        // No v1 sortOrder, so it comes from list position, which the restored judge_notes shifts.
        "trapeze-swing-assembly field_1778197726672 sortOrder: as-run 60, design 70",
      ].sort(),
    );
  });
});
