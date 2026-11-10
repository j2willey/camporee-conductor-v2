import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Db } from "./db/open.ts";
import { officialByEmail } from "./officials.ts";
import { resolvedRoster, type RosterChange } from "./roster.ts";
import type { Group, Team } from "./roster-and-scores.ts";

// The Roster page's data (#42 PR 6): the resolved roster, what is merged, and the log in plain words.

export interface MergedEntrant {
  kind: "group" | "team";
  id: string;
  /** Its display name. */
  name: string;
  intoId: string;
  /** The surviving entrant's display name. */
  intoName: string;
  by: string;
  at: string;
  notes?: string;
}

export interface RosterHistoryItem {
  seq: number;
  by: string;
  at: string;
  notes?: string;
  /** The change in plain words. */
  text: string;
}

export interface OfficialRoster {
  groups: Group[];
  teams: Team[];
  merged: MergedEntrant[];
  /** The last 50 changes, newest first. */
  history: RosterHistoryItem[];
}

export function officialRoster(db: Db, bundle: CheckedBundle): OfficialRoster {
  const roster = resolvedRoster(db);
  const who = (email: string) =>
    officialByEmail(db, bundle, email)?.name ?? email;
  const name = (id: string) => roster.displayName(id) ?? id;
  const describe = (change: RosterChange): string => {
    switch (change.type) {
      case "add-group":
        return `Added Group ${change.name}`;
      case "add-team":
        return `Added Team ${change.name} to ${name(change.groupId)}`;
      case "rename":
        return `Renamed ${roster.sentName(change.id) ?? change.id} to ${change.name}`;
      case "merge":
        return `Merged ${name(change.id)} into ${name(change.intoId)}`;
      case "unmerge":
        return `Unmerged ${name(change.id)}`;
    }
  };
  const merged = [...roster.directMerge].flatMap(([id, intoId]) => {
    // The newest merge of it in the log: the one still in force.
    const row = roster.history.find(
      (h) => h.change.type === "merge" && h.change.id === id,
    );
    if (!row || row.change.type !== "merge") return [];
    return [
      {
        kind: row.change.kind,
        id,
        name: name(id),
        intoId,
        intoName: name(roster.resolve(intoId)),
        by: who(row.officialEmail),
        at: row.receivedAt.toISOString(),
        ...(row.notes !== null && { notes: row.notes }),
      } satisfies MergedEntrant,
    ];
  });
  return {
    groups: roster.groups,
    teams: roster.teams,
    merged,
    history: roster.history.slice(0, 50).map((h) => ({
      seq: h.seq,
      by: who(h.officialEmail),
      at: h.receivedAt.toISOString(),
      ...(h.notes !== null && { notes: h.notes }),
      text: describe(h.change),
    })),
  };
}
