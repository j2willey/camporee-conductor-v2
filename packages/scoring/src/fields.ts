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

/** A numeric reading of an entered value, or undefined if it isn't a number. */
function numberOf(value: FieldValue | undefined): number | undefined {
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
