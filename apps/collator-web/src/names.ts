// Name matching for the roster (#40 PR 2): a Judge adding a Team or Group whose name matches one already
// on the list is warned and offered the existing one, so two phones don't add the same Patrol twice.
// Merging duplicates that slip through is an Official's tool (#42).

interface Named {
  id: string;
  name: string;
}

/** Lowercase letters and digits only, accents dropped; `label` (e.g. "Troop") removed when given. */
function key(name: string, label?: string): string {
  let text = name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  if (label) {
    const word = key(label);
    if (word) text = text.replace(new RegExp(word, "g"), " ");
  }
  return text.replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The same name, ignoring case, spacing, punctuation, accents, and the `label` word if given. */
export function sameName(a: string, b: string, label?: string): boolean {
  const ka = key(a, label);
  return ka !== "" && ka === key(b, label);
}

/** A Team already in `groupId` with this name. */
export function matchingTeam<T extends Named & { groupId: string }>(
  teams: readonly T[],
  groupId: string,
  name: string,
): T | undefined {
  return teams.find((t) => t.groupId === groupId && sameName(t.name, name));
}

/** A Group already on the roster with this name; `groupLabel` (e.g. "Troop") is ignored in both. */
export function matchingGroup<G extends Named>(
  groups: readonly G[],
  name: string,
  groupLabel: string,
): G | undefined {
  return groups.find((g) => sameName(g.name, name, groupLabel));
}
