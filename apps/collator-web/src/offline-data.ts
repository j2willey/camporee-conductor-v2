import type { Group, Roster, Team } from "@camporee-conductor/collator/types";
import { wasRefused } from "./api.ts";
import { entrantLabel } from "./format.ts";
import type { OutboxItem } from "./outbox.ts";

// The judge page with no Wi-Fi (#41 PR 3). The service worker (sw-template.js) keeps the app itself; this keeps
// the event and the roster from the last time the box answered, and lists Teams added on this phone before
// the box has them. All of it lives in the page: a service worker can't read localStorage.

/** The part of localStorage used here, so tests can pass their own. */
export interface KeptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Kept<T> {
  value: T;
  /** True when the box couldn't be reached and this is the copy kept on the phone. */
  fromPhone: boolean;
}

/**
 * Ask the box; keep a copy of its answer. When the box can't be reached, use the kept copy. A refusal
 * (the box answered, and said no) is passed on: an old copy would hide what the box said.
 */
export async function loadKept<T>(
  key: string,
  fetch: () => Promise<T>,
  storage: KeptStorage,
): Promise<Kept<T>> {
  try {
    const value = await fetch();
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      // Private browsing or storage full: it works while the box can be reached.
    }
    return { value, fromPhone: false };
  } catch (e) {
    if (wasRefused(e)) throw e;
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      // Storage unavailable: nothing kept.
    }
    if (raw === null) throw e;
    return { value: JSON.parse(raw) as T, fromPhone: true };
  }
}

const GROUPS = "/api/groups/";
const TEAMS = "/api/teams/";

/** An outbox item adding a Group (the same PUT the box takes). */
export const addGroupItem = (group: Group, queuedAt: string): OutboxItem => ({
  id: group.id,
  path: `${GROUPS}${group.id}`,
  body: { name: group.name },
  label: group.name,
  queuedAt,
});

/** An outbox item adding a Team. Queue its new Group first: the outbox sends in order. */
export const addTeamItem = (
  team: Team,
  groupName: string,
  queuedAt: string,
): OutboxItem => ({
  id: team.id,
  path: `${TEAMS}${team.id}`,
  body: { groupId: team.groupId, name: team.name },
  label: entrantLabel(team.id, { name: team.name, group: groupName }),
  queuedAt,
});

/** The roster plus the Groups and Teams added on this phone and still waiting to send. */
export function rosterWithPending(
  roster: Roster,
  items: readonly OutboxItem[],
): Roster {
  const groups = [...roster.groups];
  const teams = [...roster.teams];
  for (const item of items) {
    if (item.refused !== undefined) continue;
    if (item.path.startsWith(GROUPS)) {
      const body = item.body as { name: string };
      if (!groups.some((g) => g.id === item.id))
        groups.push({ id: item.id, name: body.name });
    } else if (item.path.startsWith(TEAMS)) {
      const body = item.body as { groupId: string; name: string };
      if (!teams.some((t) => t.id === item.id))
        teams.push({ id: item.id, groupId: body.groupId, name: body.name });
    }
  }
  return { groups, teams };
}

/** True for a score; false for a roster add. */
export const isScore = (item: OutboxItem) =>
  !item.path.startsWith(GROUPS) && !item.path.startsWith(TEAMS);
