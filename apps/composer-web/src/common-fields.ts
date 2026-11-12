import type {
  Competition,
  Event,
  ScoringField,
} from "@camporee-conductor/schema";
import { moveItem } from "./draft.ts";

/**
 * Pure edits for Common Fields (ADR-0020, #99). A Competition lists the set's field ids it shows before and after
 * each Activity's own fields; they're applied at runtime, never copied into an Activity.
 */

export type Place = "before" | "after";

/** Where a Common Field shows in this Competition's forms, or null if it doesn't. */
export function placementOf(
  competition: Competition,
  fieldId: string,
): Place | null {
  const ref = competition.commonFields;
  if (ref?.before.includes(fieldId)) return "before";
  if (ref?.after.includes(fieldId)) return "after";
  return null;
}

/**
 * The Competition with `fieldId` at the end of `place`'s list, or taken off (null). Links the Competition to
 * `setId` if it had no Common Fields; keeps the link, with empty lists, when the last field is taken off.
 */
export function placeCommonField(
  competition: Competition,
  setId: string,
  fieldId: string,
  place: Place | null,
): Competition {
  const ref = competition.commonFields;
  if (!ref && place === null) return competition;
  const without = (ids: readonly string[]) =>
    ids.filter((id) => id !== fieldId);
  const before = without(ref?.before ?? []);
  const after = without(ref?.after ?? []);
  if (place === "before") before.push(fieldId);
  if (place === "after") after.push(fieldId);
  return {
    ...competition,
    commonFields: { setId: ref?.setId ?? setId, before, after },
  };
}

/** Moves one id up (-1) or down (+1) within the Competition's `place` list. */
export function moveCommonField(
  competition: Competition,
  place: Place,
  index: number,
  step: -1 | 1,
): Competition {
  const ref = competition.commonFields;
  if (!ref) return competition;
  return {
    ...competition,
    commonFields: { ...ref, [place]: moveItem(ref[place], index, step) },
  };
}

/**
 * One message for each id a Competition uses that the set being edited no longer has (removed or renamed), so
 * the page says so before the API refuses the save.
 */
export function inUseMissing(
  event: Event,
  fieldIds: readonly string[],
): string[] {
  const has = new Set(fieldIds);
  return event.competitions.flatMap((c) =>
    [...(c.commonFields?.before ?? []), ...(c.commonFields?.after ?? [])]
      .filter((id) => !has.has(id))
      .map(
        (id) =>
          `${c.label} uses ${id}. Take it off on the Competitions page first, or put the field back.`,
      ),
  );
}

/** The `{{variable}}` keys in the fields' labels and placeholders, once each, first seen first. */
export function variablesUsed(fields: readonly ScoringField[]): string[] {
  const keys = new Set<string>();
  for (const field of fields) {
    for (const text of [field.label, field.config?.placeholder ?? ""]) {
      for (const match of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
        keys.add(match[1] as string);
      }
    }
  }
  return [...keys];
}
