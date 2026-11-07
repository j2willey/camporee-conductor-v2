import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { ScoringField } from "@camporee-conductor/schema";
import { fillVariables } from "@camporee-conductor/scoring";
import { activityFields } from "./bundle-lookup.ts";

// The Event as a Judge's phone sees it (#40 PR 2): each Activity's form, already merged with its
// Competition's Common Fields by packages/scoring (ADR-0020), Judge fields only.

export interface JudgeField {
  id: string;
  label: string;
  type: ScoringField["type"];
  required: boolean;
  config: NonNullable<ScoringField["config"]>;
}

export interface JudgeActivity {
  id: string;
  title: string;
  competition: { id: string; label: string; level: "team" | "group" };
  fields: JudgeField[];
}

/** What this pack calls a Team and a Group on screen (ADR-0003), e.g. Patrol and Troop. */
export interface JudgeLabels {
  team: string;
  group: string;
}

export interface JudgeEvent {
  event: {
    id: string;
    title: string;
    labels: JudgeLabels;
  };
  activities: JudgeActivity[];
}

export function judgeEvent(bundle: CheckedBundle): JudgeEvent {
  const { event } = bundle;
  const activities = [...event.activities]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((listed): JudgeActivity[] => {
      const found = activityFields(bundle, listed.activityId);
      if (!found) return [];
      const { activity, competition, fields } = found;
      return [
        {
          id: activity.id,
          title: activity.title,
          competition: {
            id: competition.id,
            label: competition.label,
            level: competition.level,
          },
          fields: fillVariables(fields, activity.variables ?? {})
            .filter((f) => f.audience === "judge")
            .map((f) => ({
              id: f.id,
              label: f.label,
              type: f.type,
              required: f.required ?? false,
              config: f.config ?? {},
            })),
        },
      ];
    });
  return {
    event: {
      id: event.id,
      title: event.title,
      labels: {
        team: event.terminology.labels?.team ?? "Team",
        group: event.terminology.labels?.group ?? "Group",
      },
    },
    activities,
  };
}
