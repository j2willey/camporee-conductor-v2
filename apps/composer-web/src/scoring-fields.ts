import type { Activity } from "@camporee-conductor/schema";
import { moveItem, omit, removeItem } from "./draft.ts";

/**
 * Edits to an Activity's scoring fields (#6 PR 5), as pure functions on the list. The list is kept in
 * `sortOrder` order; after a change that adds, removes or moves a field it's renumbered 10, 20, 30…, as v1 and
 * the Circus 2026 transcode number them. A change that only edits a field keeps every number.
 */

export type Field = Activity["scoring"]["fields"][number];
type Direction = NonNullable<Field["primary"]>["direction"];

/** In list order. */
export const sorted = (fields: readonly Field[]): Field[] =>
  [...fields].sort((a, b) => a.sortOrder - b.sortOrder);

const renumber = (fields: readonly Field[]): Field[] =>
  fields.map((f, i) => ({ ...f, sortOrder: (i + 1) * 10 }));

const freeId = (fields: readonly Field[], base: string): string => {
  const taken = new Set(fields.map((f) => f.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
  }
};

const without = (field: Field, key: keyof Field): Field => omit(field, key);

/** A new Judge points field, last. */
export function addField(fields: readonly Field[]): Field[] {
  const list = sorted(fields);
  return renumber([
    ...list,
    {
      id: freeId(list, "new_field"),
      label: "New field",
      type: "number",
      kind: "points",
      audience: "judge",
      sortOrder: 0,
      weight: 1,
    },
  ]);
}

/** A copy right after field `index`: a new id, "(copy)" on the label, and never the primary metric. */
export function duplicateField(
  fields: readonly Field[],
  index: number,
): Field[] {
  const list = sorted(fields);
  const source = list[index];
  if (!source) return list;
  const copy = without(
    {
      ...source,
      id: freeId(list, `${source.id}_copy`),
      label: `${source.label} (copy)`,
    },
    "primary",
  );
  return renumber([
    ...list.slice(0, index + 1),
    copy,
    ...list.slice(index + 1),
  ]);
}

export const moveField = (
  fields: readonly Field[],
  index: number,
  step: -1 | 1,
): Field[] => {
  const list = sorted(fields);
  const moved = moveItem(list, index, step);
  return moved.every((f, i) => f === list[i]) ? list : renumber(moved);
};

export const removeField = (fields: readonly Field[], index: number) =>
  renumber(removeItem(sorted(fields), index));

/** Changes field `index` without touching the order. */
export const updateField = (
  fields: readonly Field[],
  index: number,
  change: (field: Field) => Field,
): Field[] => sorted(fields).map((f, i) => (i === index ? change(f) : f));

const canBePrimary = (field: Field) =>
  field.kind === "metric" &&
  (field.type === "number" || field.type === "stopwatch");

/** The Activity's primary metric: field `index` with `direction`, or none (`null`). At most one field has it. */
export const setPrimary = (
  fields: readonly Field[],
  index: number,
  direction: Direction | null,
): Field[] =>
  sorted(fields).map((f, i) =>
    i === index && direction !== null
      ? { ...f, primary: { direction } }
      : i === index || direction !== null
        ? without(f, "primary")
        : f,
  );

/** A kind or type change drops `primary` when the field can no longer be one (the schema's rule). */
export const setKind = (
  fields: readonly Field[],
  index: number,
  kind: Field["kind"],
): Field[] =>
  updateField(fields, index, (f) => {
    const next = { ...f, kind };
    return canBePrimary(next) ? next : without(next, "primary");
  });

export const setType = (
  fields: readonly Field[],
  index: number,
  type: Field["type"],
): Field[] =>
  updateField(fields, index, (f) => {
    const next = { ...f, type };
    return canBePrimary(next) ? next : without(next, "primary");
  });
