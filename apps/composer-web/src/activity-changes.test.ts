import type { Activity } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { activityChanges } from "./activity-changes.ts";

/** What the review shows for an Activity proposal (#103 PR 3): each changed part, before and after. */

const base: Activity = {
  schemaVersion: 1,
  id: "0196cfa2-4c00-7000-8000-000000000001",
  kind: "activity",
  slug: "clown-car",
  title: "Clown Car",
  scoringType: "ranked",
  content: {
    story: "Pack the car.",
    objective: "Fit everyone in.",
    description: "Climb in.",
    rules: ["No pushing."],
    timeAndScoring: "Five minutes.",
    setup: "",
    reset: "",
    staffing: "",
    supplies: [{ item: "Car", quantity: "1" }],
    notes: "",
  },
  scoring: {
    fields: [
      {
        id: "clowns",
        label: "Clowns",
        type: "number",
        kind: "points",
        audience: "judge",
        sortOrder: 1,
        weight: 1,
      },
    ],
  },
} as Activity;

describe("activityChanges", () => {
  it("is empty for no change", () => {
    expect(activityChanges(base, structuredClone(base))).toEqual([]);
  });

  it("lists the title, each changed section and each field's wording, in reading order", () => {
    const after = structuredClone(base);
    after.title = "The Big Top Car";
    after.content.story = "The ringmaster's car awaits.";
    after.content.rules = ["No pushing.", "Honk twice."];
    after.content.supplies = [
      { group: "Props", item: "Car (Clown Wagon)", quantity: "1" },
    ];
    const field = after.scoring.fields[0];
    if (field) {
      field.label = "Clowns aboard";
      field.config = { placeholder: "How many clowns" };
    }
    expect(activityChanges(base, after)).toEqual([
      { label: "Title", before: "Clown Car", after: "The Big Top Car" },
      {
        label: "Background (story)",
        before: "Pack the car.",
        after: "The ringmaster's car awaits.",
      },
      {
        label: "Rules & Constraints",
        before: "• No pushing.",
        after: "• No pushing.\n• Honk twice.",
      },
      {
        label: "Supplies",
        before: "• Car (1)",
        after: "• Props: Car (Clown Wagon) (1)",
      },
      {
        label: "Field clowns: label",
        before: "Clowns",
        after: "Clowns aboard",
      },
      {
        label: "Field clowns: placeholder",
        before: "",
        after: "How many clowns",
      },
    ]);
  });
});
