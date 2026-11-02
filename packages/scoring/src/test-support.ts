import {
  ActivitySchema,
  EventSchema,
  type Award,
  type Event,
} from "@camporee-conductor/schema";
import type { OfficialAction, ScoringInput } from "./types.ts";

export const COMPETITION = "0196cfa2-4c00-7000-8000-000000000020";

/** A stable UUID v7 for test document number `n`. */
const uuid = (n: number): string =>
  `0196cfa2-4c00-7000-8000-${n.toString().padStart(12, "0")}`;

/** The id of the `index`th Activity built by `smallEvent`. */
export const activityId = (index: number): string => uuid(100 + index);

/**
 * A one-Competition Event for unit tests. Each Activity has one `points` field; `scores[i]` maps
 * entrant ids to that Activity's value. Every entrant in any Activity enters the Competition.
 */
export function smallEvent({
  scores,
  tieNumbering = "dense",
  awards = [],
  actions = [],
}: {
  scores: Record<string, number>[];
  tieNumbering?: Event["tieNumbering"];
  awards?: Award[];
  actions?: OfficialAction[];
}): ScoringInput {
  const activities = scores.map((_, i) =>
    ActivitySchema.parse({
      schemaVersion: "4.0",
      kind: "activity",
      id: activityId(i),
      slug: `activity-${i}`,
      title: `Activity ${i}`,
      scoringType: "ranked",
      content: {
        story: "A test Activity.",
        objective: "Score points.",
        description: "Score points.",
        rules: [],
        timeAndScoring: "Most points wins.",
        setup: "None.",
        reset: "None.",
        staffing: "1 Judge.",
        supplies: [],
        notes: "",
      },
      scoring: {
        direction: "higher-wins",
        fields: [
          {
            id: "score",
            label: "Score",
            type: "number",
            kind: "points",
            audience: "judge",
            sortOrder: 1,
          },
        ],
      },
    }),
  );
  const event = EventSchema.parse({
    schemaVersion: "4.0",
    kind: "event",
    id: uuid(1),
    slug: "test-event",
    title: "Test Event",
    terminology: { pack: "scouting" },
    presentation: {
      themeColors: { main: "#000000", header: "#000000", accent: "#000000" },
    },
    competitions: [
      {
        id: COMPETITION,
        slug: "teams",
        label: "Teams",
        level: "team",
        registration: "registered",
        divisions: [],
      },
    ],
    activities: activities.map((a, i) => ({
      activityId: a.id,
      competitionId: COMPETITION,
      sortOrder: i + 1,
    })),
    tieNumbering,
    awards,
  });
  const entrantIds = [...new Set(scores.flatMap((s) => Object.keys(s)))];
  return {
    event,
    activities,
    commonFieldSets: [],
    entrants: entrantIds.map((id) => ({ id, competitionId: COMPETITION })),
    entries: scores.flatMap((s, i) =>
      Object.entries(s).map(([entrantId, score]) => ({
        activityId: activityId(i),
        entrantId,
        values: { score },
      })),
    ),
    actions,
  };
}
