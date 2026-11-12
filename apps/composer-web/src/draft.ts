/**
 * Small, pure edits for a document being edited in a form (ADR-0029). The form keeps a draft copy of the stored
 * document and saves it whole, so these never add keys the document didn't have (ADR-0012).
 */

/** Swaps item `index` with its neighbor (`-1` up, `+1` down). At either end, the list comes back unchanged. */
export function moveItem<T>(
  list: readonly T[],
  index: number,
  step: -1 | 1,
): T[] {
  const other = index + step;
  if (other < 0 || other >= list.length) return [...list];
  const next = [...list];
  [next[index], next[other]] = [next[other] as T, next[index] as T];
  return next;
}

export const removeItem = <T>(list: readonly T[], index: number): T[] =>
  list.filter((_, i) => i !== index);

export const replaceItem = <T>(
  list: readonly T[],
  index: number,
  item: T,
): T[] => list.map((old, i) => (i === index ? item : old));

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0);

/**
 * `doc` with an optional key set, or removed when `value` is empty (`undefined`, "", [] or {}), so a document
 * that never had it stays exactly as stored.
 */
export function withOptional<D extends object, K extends keyof D>(
  doc: D,
  key: K,
  value: D[K] | undefined,
): D {
  if (!isEmpty(value)) return { ...doc, [key]: value };
  return Object.fromEntries(
    Object.entries(doc).filter(([k]) => k !== key),
  ) as D;
}

/** Renames a variable, keeping its value and its place. Throws if another variable has the new name. */
export function renameVariable(
  variables: Readonly<Record<string, string>>,
  from: string,
  to: string,
): Record<string, string> {
  if (from === to) return { ...variables };
  if (to in variables) {
    throw new Error(`There's already a variable called ${to}.`);
  }
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [
      key === from ? to : key,
      value,
    ]),
  );
}
