import type { Event } from "@camporee-conductor/schema";
import { omit } from "./draft.ts";

/** Edits to an Event's details (#6 PR 7). Fields the schema doesn't allow empty are removed when cleared. */

/** v1's "reset to defaults" colors (composer.js `resetThemeColors`). */
export const DEFAULT_THEME_COLORS = {
  main: "#0d6efd",
  header: "#34495e",
  accent: "#3498db",
} as const;

/** The year, or none when the text isn't a whole number. */
export function setYear(event: Event, text: string): Event {
  const year = Number(text);
  return text.trim() !== "" && Number.isInteger(year)
    ? { ...event, year }
    : omit(event, "year");
}

export const setDate = (
  event: Event,
  key: "startDate" | "endDate",
  value: string,
): Event => (value === "" ? omit(event, key) : { ...event, [key]: value });

type LabelKey = keyof NonNullable<Event["terminology"]["labels"]>;

/** A participant-hierarchy label (ADR-0003). A blank one goes, and so do `labels` when none is left. */
export function setLabel(event: Event, key: LabelKey, value: string): Event {
  const current = event.terminology.labels ?? {};
  const labels =
    value.trim() === "" ? omit(current, key) : { ...current, [key]: value };
  const terminology =
    Object.keys(labels).length > 0
      ? { ...event.terminology, labels }
      : omit(event.terminology, "labels");
  return { ...event, terminology };
}
