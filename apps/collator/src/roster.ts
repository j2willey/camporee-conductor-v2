import type { Db } from "./db/open.ts";
import type { Group, Recorded, Team } from "./roster-and-scores.ts";

// Roster changes on the box (ADR-0027, 2026-11-10): adds, renames and reversible merges, kept as an append-only log.

export type RosterChange =
  | { type: "add-group"; groupId: string; name: string }
  | { type: "add-team"; teamId: string; groupId: string; name: string }
  | { type: "rename"; kind: "group" | "team"; id: string; name: string }
  | { type: "merge"; kind: "group" | "team"; id: string; intoId: string }
  | { type: "unmerge"; kind: "group" | "team"; id: string };

export interface RosterChangeSubmission {
  id: string;
  /** `normalEmail()` of the Official. */
  officialEmail: string;
  change: RosterChange;
  notes?: string | undefined;
  clientCreatedAt: string;
}

export function recordRosterChange(
  _db: Db,
  _submission: RosterChangeSubmission,
): Recorded {
  throw new Error("not built yet");
}

export interface RosterHistoryRow {
  seq: number;
  id: string;
  officialEmail: string;
  change: RosterChange;
  notes: string | null;
  clientCreatedAt: string;
  receivedAt: Date;
}

export interface ResolvedRoster {
  groups: Group[];
  teams: Team[];
  mergedInto: Map<string, string>;
  resolve: (id: string) => string;
  /** The display name of any Group or Team, merged away or not; undefined for an id not on the roster. */
  displayName: (id: string) => string | undefined;
  history: RosterHistoryRow[];
}

export function resolvedRoster(_db: Db): ResolvedRoster {
  throw new Error("not built yet");
}
