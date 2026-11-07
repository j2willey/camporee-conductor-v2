import type { JudgeField } from "@camporee-conductor/collator/types";

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
 * (trimmed). Blank fields are left out. Stopwatch times are text here; their timer is #41.
 */
export function readEntry(
  fields: readonly JudgeField[],
  entry: Entry,
): { ok: true; values: Values } | { ok: false; problems: string[] } {
  const values: Values = {};
  const problems: string[] = [];
  for (const f of fields) {
    const raw = entry[f.id];
    if (f.type === "checkbox") {
      values[f.id] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "") {
      if (f.required) problems.push(`${f.label} is required`);
      continue;
    }
    if (f.type !== "number") {
      values[f.id] = text;
      continue;
    }
    const n = Number(text);
    if (!Number.isFinite(n)) {
      problems.push(`${f.label} must be a number`);
      continue;
    }
    const { min, max } = f.config;
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      problems.push(
        `${f.label} must be from ${min ?? "any"} to ${max ?? "any"}`,
      );
      continue;
    }
    values[f.id] = n;
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, values };
}
