import type { JudgeField } from "@camporee-conductor/collator/types";
import { numberOf, valueProblem } from "@camporee-conductor/scoring";

/** What the inputs hold: text for most fields, a boolean for checkboxes. */
export type Entry = Record<string, string | boolean>;

/** A score's values, as the Collator stores them (ADR-0019: as entered). */
export type Values = Record<string, number | string | boolean>;

export function initialEntry(fields: readonly JudgeField[]): Entry {
  return Object.fromEntries(
    fields.map((f) => {
      const value = f.config.defaultValue;
      return [
        f.id,
        f.type === "checkbox"
          ? value === true
          : value === undefined
            ? ""
            : String(value),
      ];
    }),
  );
}

/**
 * The values to send, or the problems to show. Numbers are read as numbers; other text is kept as typed
 * (trimmed). Blank fields are left out. Stopwatch times are m:ss text here (typed, or
 * written by the timer, stopwatch.ts).
 */
export function readEntry(
  fields: readonly JudgeField[],
  entry: Entry,
): { ok: true; values: Values } | { ok: false; problems: string[] } {
  const values: Values = {};
  const problems: string[] = [];
  for (const f of fields) {
    const raw = entry[f.id];
    const value =
      f.type === "checkbox"
        ? raw === true
        : typeof raw === "string"
          ? raw.trim()
          : "";
    // The same check the Collator makes (packages/scoring): required fields, number ranges and select
    // options, so the phone and the box agree.
    const problem = valueProblem(f, value);
    if (problem) {
      problems.push(problem);
      continue;
    }
    if (value === "") continue;
    // Read as packages/scoring reads it; valueProblem has already checked it's a number.
    values[f.id] = f.type === "number" ? (numberOf(value) ?? value) : value;
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values };
}
