import { describe, expect, it } from "vitest";
import { ActivitySchema, type Activity } from "./activity.ts";
import { issuesOf } from "./test-support.ts";

const validActivity = (): Activity => ({
  schemaVersion: "4.0",
  kind: "activity",
  id: "0196cfa2-4c00-7000-8000-000000000001",
  slug: "3-ring-circus",
  title: "3 Ring Circus",
  scoringType: "ranked",
  content: {
    story: "The Ringmaster has a problem.",
    objective: "Pass the rings around the circle 3 times.",
    description: "Your Ring Crew forms a perfect circle.",
    rules: ["All patrol members must join the circle"],
    timeAndScoring: "Fastest time wins.",
    setup: "Clear a flat open area.",
    reset: "Under 1 minute.",
    staffing: "1 judge.",
    supplies: [{ item: "Hula hoop", quantity: "4–5" }, { item: "Stopwatch" }],
    notes: "",
  },
  scoring: {
    direction: "lower-wins",
    fields: [
      {
        id: "elapsed_time",
        label: "Total elapsed time",
        type: "stopwatch",
        kind: "metric",
        audience: "judge",
        sortOrder: 10,
        weight: 1,
      },
    ],
  },
});

describe("ActivitySchema", () => {
  it("accepts a valid Activity", () => {
    expect(ActivitySchema.parse(validActivity())).toEqual(validActivity());
  });

  it("accepts an exhibition Activity with variables, tags, lineage and legacy ids", () => {
    const activity = {
      ...validActivity(),
      scoringType: "exhibition",
      variables: { ten_essentials: "Compass" },
      tags: ["cooking"],
      lineage: {
        parentId: "0196cfa2-4c00-7000-8000-0000000000ff",
        attribution: [{ text: "Theme from XYZ District, ABC Council 2025" }],
      },
      legacy: {
        v1Id: "3-ring-circus",
        v1LibraryUuid: "496b88a7-7af9-4cf4-a533-3a2281ba2980",
      },
    };
    expect(ActivitySchema.safeParse(activity).success).toBe(true);
  });

  it("requires schemaVersion 4.0", () => {
    expect(
      issuesOf(ActivitySchema, { ...validActivity(), schemaVersion: "3.0" }),
    ).toContain('schemaVersion: Invalid input: expected "4.0"');
  });

  it("requires a UUID v7 id", () => {
    const v4 = "5d5a6a80-c9e1-4551-8e15-8ef1ca93b9ca";
    expect(issuesOf(ActivitySchema, { ...validActivity(), id: v4 })).toContain(
      "id: must be a UUID v7",
    );
  });

  it("requires a lowercase, hyphenated slug", () => {
    expect(
      issuesOf(ActivitySchema, { ...validActivity(), slug: "3 Ring Circus" }),
    ).toContain("slug: must be lowercase letters, digits and single hyphens");
  });

  it("rejects the v1 'challenge' content key and other unknown keys", () => {
    const activity = validActivity();
    const content = { ...activity.content, challenge: "old v1 name" };
    expect(issuesOf(ActivitySchema, { ...activity, content })).toContain(
      'content: Unrecognized key: "challenge"',
    );
  });

  it("requires every fixed content field", () => {
    const content: Record<string, unknown> = { ...validActivity().content };
    delete content["staffing"];
    expect(issuesOf(ActivitySchema, { ...validActivity(), content })).toContain(
      "content.staffing: Invalid input: expected string, received undefined",
    );
  });

  it("requires non-empty Program Guide text (story, objective, description, time and scoring)", () => {
    const activity = validActivity();
    const content = { ...activity.content, objective: "  " };
    expect(issuesOf(ActivitySchema, { ...activity, content })).toContain(
      "content.objective: must not be empty",
    );
  });

  it("requires at least one non-empty rule", () => {
    const activity = validActivity();
    expect(
      issuesOf(ActivitySchema, {
        ...activity,
        content: { ...activity.content, rules: [] },
      }),
    ).toContain("content.rules: must have at least one rule");
    expect(
      issuesOf(ActivitySchema, {
        ...activity,
        content: { ...activity.content, rules: [""] },
      }),
    ).toContain("content.rules.0: must not be empty");
  });

  it("only allows ranked or exhibition scoring types", () => {
    expect(
      issuesOf(ActivitySchema, { ...validActivity(), scoringType: "bracket" }),
    ).toContain(
      'scoringType: Invalid option: expected one of "ranked"|"exhibition"',
    );
  });

  it("rejects duplicate scoring field ids", () => {
    const activity = validActivity();
    const field = activity.scoring.fields[0];
    const scoring = { ...activity.scoring, fields: [field, field] };
    expect(issuesOf(ActivitySchema, { ...activity, scoring })).toContain(
      'scoring.fields.1.id: duplicate field id "elapsed_time"',
    );
  });

  it("rejects a negative weight", () => {
    const activity = validActivity();
    const fields = [{ ...activity.scoring.fields[0], weight: -1 }];
    expect(
      issuesOf(ActivitySchema, {
        ...activity,
        scoring: { ...activity.scoring, fields },
      }),
    ).toContain(
      "scoring.fields.0.weight: Too small: expected number to be >=0",
    );
  });
});
