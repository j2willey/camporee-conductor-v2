import type {
  EntrantName,
  JudgeActivity,
  JudgeLabels,
} from "@camporee-conductor/collator/types";

/** 1 → "1st", 2 → "2nd", 11 → "11th". Display only: places come from packages/scoring. */
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** "Team (Group)" for a Team, the name for a Group, or the id if it isn't on the roster. */
export function entrantLabel(id: string, entrant: EntrantName): string {
  const name = entrant.name ?? id;
  return entrant.group ? `${name} (${entrant.group})` : name;
}

/** The event's word for who's scored at a Competition's level: its Team label or its Group label. */
export function levelLabel(
  level: JudgeActivity["competition"]["level"],
  labels: JudgeLabels,
): string {
  return level === "team" ? labels.team : labels.group;
}
