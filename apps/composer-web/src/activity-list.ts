/**
 * Changes to an Event's Activity list (#6 PR 2b), as pure functions on the list. Each returns a new list for an
 * Event save; the order within a Competition is `sortOrder` (ADR-0012), which stays unique across the Event.
 */

export interface Entry {
  activityId: string;
  competitionId: string;
  sortOrder: number;
  enabled?: boolean | undefined;
}

/** One Competition's entries, in list order. */
export const entriesOf = <E extends Entry>(
  entries: readonly E[],
  competitionId: string,
): E[] =>
  entries
    .filter((e) => e.competitionId === competitionId)
    .sort((a, b) => a.sortOrder - b.sortOrder);

/**
 * Swaps an Activity with its neighbor in the same Competition (`-1` up, `+1` down). The two trade sortOrders, so
 * nothing else changes. At either end, the list comes back unchanged.
 */
export function moveWithin<E extends Entry>(
  entries: readonly E[],
  activityId: string,
  step: -1 | 1,
): E[] {
  const entry = entries.find((e) => e.activityId === activityId);
  if (!entry) return [...entries];
  const siblings = entriesOf(entries, entry.competitionId);
  const neighbor = siblings[siblings.indexOf(entry) + step];
  if (!neighbor) return [...entries];
  return entries.map((e) =>
    e === entry
      ? { ...e, sortOrder: neighbor.sortOrder }
      : e === neighbor
        ? { ...e, sortOrder: entry.sortOrder }
        : e,
  );
}

/** Moves an Activity to the end of another Competition. */
export function moveTo<E extends Entry>(
  entries: readonly E[],
  activityId: string,
  competitionId: string,
): E[] {
  const last = Math.max(0, ...entries.map((e) => e.sortOrder));
  return entries.map((e) =>
    e.activityId === activityId && e.competitionId !== competitionId
      ? { ...e, competitionId, sortOrder: last + 1 }
      : e,
  );
}

/**
 * Switches an Activity on or off (ADR-0029 item 9). On removes the key (left out = enabled), so a document that
 * never disabled anything stays exactly as it was.
 */
export function setEnabled<E extends Entry>(
  entries: readonly E[],
  activityId: string,
  enabled: boolean,
): E[] {
  return entries.map((e) => {
    if (e.activityId !== activityId) return e;
    if (!enabled) return { ...e, enabled: false };
    const on = { ...e };
    delete on.enabled;
    return on;
  });
}
