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

/** `points` fields minus `penalty` fields. `metric` and `info` fields don't count. */
export function entryTotal(
  fields: readonly ScoringField[],
  values: Readonly<Record<string, FieldValue>>,
): number {
  let total = 0;
  for (const field of fields) {
    if (field.kind !== "points" && field.kind !== "penalty") continue;
    const n = numberOf(values[field.id]);
    if (n === undefined) continue;
    total += field.kind === "penalty" ? -n : n;
  }
  return total;
}
