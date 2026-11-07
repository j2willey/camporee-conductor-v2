import type {
  Activity,
  CommonFieldSet,
  Competition,
  ScoringField,
} from "@camporee-conductor/schema";
import type { FieldValue } from "./types.ts";

/**
 * The fields scored at an Activity: the Competition's `before` Common Fields, the Activity's own,
 * then its `after` Common Fields (ADR-0020). The only place Common Fields are merged.
 */
export function mergeCommonFields(
  activity: Activity,
  competition: Competition,
  commonFieldSets: readonly CommonFieldSet[],
): ScoringField[] {
  const ref = competition.commonFields;
  if (!ref) return [...activity.scoring.fields];
  const set = commonFieldSets.find((s) => s.id === ref.setId);
  if (!set) {
    throw new Error(
      `Competition ${competition.slug} uses Common Field set ${ref.setId}, which isn't given`,
    );
  }
  const byId = new Map(set.fields.map((f) => [f.id, f]));
  const resolve = (ids: readonly string[]): ScoringField[] =>
    ids.map((id) => {
      const field = byId.get(id);
      if (!field) {
        throw new Error(`Common Field set ${set.slug} has no field ${id}`);
      }
      return field;
    });
  return [
    ...resolve(ref.before),
    ...activity.scoring.fields,
    ...resolve(ref.after),
  ];
}

/**
 * Fields with an Activity's `variables` filled into `{{key}}` tokens in their labels and placeholders,
 * e.g. a Common Field "10 Essentials: {{ten_essentials}}" (ADR-0020). A token the Activity doesn't
 * define is left as it is. Ids and everything that affects scoring are unchanged.
 */
export function fillVariables(
  fields: readonly ScoringField[],
  variables: Readonly<Record<string, string>>,
): ScoringField[] {
  const fill = (text: string) =>
    text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (token, key: string) =>
      Object.hasOwn(variables, key) ? (variables[key] ?? token) : token,
    );
  return fields.map((field) => {
    const placeholder = field.config?.placeholder;
    return {
      ...field,
      label: fill(field.label),
      ...(field.config &&
        placeholder !== undefined && {
          config: { ...field.config, placeholder: fill(placeholder) },
        }),
    };
  });
}

/**
 * What's wrong with an entered value for its field, or undefined if nothing is. The judge page and the
 * Collator both use this, so the box refuses what the phone would (#40).
 * - A blank (null, missing, or text that's empty or only spaces) is "not entered": a problem only if the
 *   field is `required`. An unticked checkbox (`false`) is a value, not a blank. Which fields a caller
 *   holds to `required` is its choice: a Judge's entry is checked against Judge fields only.
 * - A number field must hold a number (or text that reads as one, as scoring reads it) within its min/max.
 * - A select field must hold one of its `options`, exactly.
 * Other field types aren't checked here.
 */
export function valueProblem(
  field: Pick<ScoringField, "type" | "label" | "config" | "required">,
  value: FieldValue | undefined,
): string | undefined {
  if (isBlank(value)) {
    return field.required ? `${field.label} is required` : undefined;
  }
  if (field.type === "select") {
    return (field.config?.options ?? []).some((option) => option === value)
      ? undefined
      : `${field.label} must be one of the listed options`;
  }
  if (field.type !== "number") return undefined;
  const n = numberOf(value);
  if (n === undefined) return `${field.label} must be a number`;
  const { min, max } = field.config ?? {};
  if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
    if (min !== undefined && max !== undefined) {
      return `${field.label} must be from ${min} to ${max}`;
    }
    return min !== undefined
      ? `${field.label} must be at least ${min}`
      : `${field.label} must be at most ${max}`;
  }
  return undefined;
}

/** Nothing entered: null, missing, or text that's empty or only spaces. */
function isBlank(value: FieldValue | undefined): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

/**
 * A numeric reading of an entered value, or undefined if it isn't a number. Every reader (the box, the
 * phone, exports) uses this one, so they can't drift.
 */
export function numberOf(value: FieldValue | undefined): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * `points` fields minus `penalty` fields, each times its `weight` (ADR-0019).
 * `metric` and `info` fields don't count.
 */
export function entryTotal(
  fields: readonly ScoringField[],
  values: Readonly<Record<string, FieldValue>>,
): number {
  let total = 0;
  for (const field of fields) {
    if (field.kind !== "points" && field.kind !== "penalty") continue;
    const n = numberOf(values[field.id]);
    if (n === undefined) continue;
    const weighted = n * field.weight;
    total += field.kind === "penalty" ? -weighted : weighted;
  }
  return total;
}

/**
 * Stopwatch text read as seconds: `m:ss` or `h:mm:ss`, with optional decimal seconds. `null` if it's
 * blank (nothing entered); undefined if it's entered but can't be read, e.g. `"7.47"` or `"1:75"`.
 */
function readStopwatch(
  value: FieldValue | undefined,
): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value !== "string") return undefined;
  if (value.trim() === "") return null;
  const match = /^(?:(\d+):)?(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return undefined;
  const [, hours = "0", minutes = "0", seconds = "0"] = match;
  if (
    Number(seconds) >= 60 ||
    (match[1] !== undefined && Number(minutes) >= 60)
  )
    return undefined;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * A stopwatch value in seconds. `"00:00"`, blank or unreadable means no time: the stopwatch wasn't
 * used (ADR-0019 Measured Activities).
 */
export function stopwatchSeconds(
  value: FieldValue | undefined,
): number | undefined {
  const seconds = readStopwatch(value);
  return seconds ? seconds : undefined;
}

/**
 * A stopwatch value that was entered but can't be read as a time, e.g. `"7.47"` or `"7;47"`: probably
 * a typo. Blank and `"00:00"` aren't; they mean no time.
 */
export function unreadableStopwatch(value: FieldValue | undefined): boolean {
  return readStopwatch(value) === undefined;
}

/** A primary metric's raw value as a number: seconds for a stopwatch, the count for a number field. */
export function metricValue(
  field: ScoringField,
  value: FieldValue | undefined,
): number | undefined {
  return field.type === "stopwatch" ? stopwatchSeconds(value) : numberOf(value);
}
