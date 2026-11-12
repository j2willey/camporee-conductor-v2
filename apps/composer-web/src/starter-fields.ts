import { freeId, renumber, sorted, type Field } from "./scoring-fields.ts";

/**
 * Starter fields (#99): a fixed list of common scoring inputs to add to an Activity in one click. Each becomes a
 * new field of that Activity, with its own id. A starter is never a Common Field: Common Fields are applied at
 * runtime from the Event's set (ADR-0020), never copied into an Activity.
 */
export interface StarterField {
  key: string;
  /** What the picker shows. */
  name: string;
  field: Field;
}

const judge = { audience: "judge", sortOrder: 0, weight: 1 } as const;

export const STARTER_FIELDS: readonly StarterField[] = [
  {
    key: "time",
    name: "Time (stopwatch)",
    field: {
      id: "time",
      label: "Time",
      type: "stopwatch",
      kind: "metric",
      ...judge,
    },
  },
  {
    key: "count",
    name: "Count",
    field: {
      id: "count",
      label: "Count",
      type: "number",
      kind: "metric",
      ...judge,
      config: { min: 0 },
    },
  },
  {
    key: "distance",
    name: "Distance",
    field: {
      id: "distance",
      label: "Distance",
      type: "number",
      kind: "metric",
      ...judge,
      config: { min: 0, placeholder: "Feet" },
    },
  },
  {
    key: "judge-points",
    name: "Judge's points (1–10)",
    field: {
      id: "judge_points",
      label: "Judge's points",
      type: "number",
      kind: "points",
      ...judge,
      config: { min: 1, max: 10, placeholder: "1-10 Points" },
    },
  },
  {
    key: "completed",
    name: "Completed (checkbox)",
    field: {
      id: "completed",
      label: "Completed",
      type: "checkbox",
      kind: "points",
      ...judge,
    },
  },
  {
    key: "penalty",
    name: "Penalty",
    field: {
      id: "penalty",
      label: "Penalty",
      type: "number",
      kind: "penalty",
      ...judge,
      config: { min: 0, placeholder: "Points deducted" },
    },
  },
  {
    key: "notes",
    name: "Notes",
    field: {
      id: "notes",
      label: "Notes",
      type: "textarea",
      kind: "info",
      ...judge,
      weight: 0,
    },
  },
];

/**
 * The Activity's fields with the starter `key` added last, renumbered in tens. Its id is free among the Activity's
 * fields and `avoid`: the ids of the Common Fields the Activity's Competition applies.
 */
export function addStarterField(
  fields: readonly Field[],
  key: string,
  avoid: readonly string[],
): Field[] {
  const starter = STARTER_FIELDS.find((s) => s.key === key);
  if (!starter) throw new Error(`no starter field ${key}`);
  const list = sorted(fields);
  const taken = [...list, ...avoid.map((id) => ({ id }))];
  return renumber([
    ...list,
    { ...starter.field, id: freeId(taken, starter.field.id) },
  ]);
}
