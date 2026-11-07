import type { EntrantName } from "@camporee-conductor/collator/types";

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
