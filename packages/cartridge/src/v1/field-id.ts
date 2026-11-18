/**
 * v1 field ids, normalized once for everything that comes from v1 (issue #10): the field definitions the
 * transcode turns into v2 Activities, and the keys of v1 score payloads. v1's Composer generated some ids with a
 * trailing space ("field_1778195167953 ") and used them both in the game and in every score, so the two must be
 * normalized the same way, or those values match no field and drop out of the totals.
 */
import { V1ImportError } from "./errors.ts";

/** A v1 field id as v2 has it. */
export const v1FieldId = (id: string): string => id.trim();

/**
 * A v1 score payload keyed by v2 field ids. Refuses an entry where two keys become the same id, rather than
 * picking one; `where` names the entry in the message (e.g. "clown-car/<entrant id>").
 */
export function v1ScoreValues<V>(
  values: Readonly<Record<string, V>>,
  where: string,
): Record<string, V> {
  const out: Record<string, V> = {};
  const from = new Map<string, string>();
  for (const [key, value] of Object.entries(values)) {
    const id = v1FieldId(key);
    const earlier = from.get(id);
    if (earlier !== undefined) {
      throw new V1ImportError([
        `${where}: score keys ${JSON.stringify(earlier)} and ${JSON.stringify(key)} are both field ${id}`,
      ]);
    }
    from.set(id, key);
    out[id] = value;
  }
  return out;
}
