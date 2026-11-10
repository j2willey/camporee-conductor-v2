import { asc, eq } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { groups, rosterChanges, teams } from "./db/schema.ts";
import { loadedEvent } from "./load-event.ts";
import {
  conflict,
  invalid,
  NO_EVENT,
  type Group,
  type Recorded,
  type Team,
} from "./roster-and-scores.ts";

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

/** JSON with object keys sorted, so the same content compares equal however a client ordered it. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const contentOf = (s: {
  officialEmail: string;
  change: unknown;
  notes?: string | null | undefined;
  clientCreatedAt: string;
}) =>
  canonical([s.officialEmail, s.change, s.notes ?? null, s.clientCreatedAt]);

/**
 * Logs a roster change after checking it. A resend of the same id and content is a repeat; the same id with other
 * content is a conflict. An add also inserts the Group or Team with the laptop's id, in the same transaction, so a
 * phone that later sends the same id and content gets a repeat (ADR-0027 item 8).
 */
export function recordRosterChange(
  db: Db,
  submission: RosterChangeSubmission,
): Recorded {
  if (!loadedEvent(db)) return NO_EVENT;
  const existing = db
    .select()
    .from(rosterChanges)
    .where(eq(rosterChanges.id, submission.id))
    .get();
  if (existing) {
    return contentOf({
      ...existing,
      change: JSON.parse(existing.change) as unknown,
    }) === contentOf(submission)
      ? { ok: true, status: "repeat" }
      : conflict("Roster change", submission.id);
  }
  const { change } = submission;
  const problem = changeProblem(db, change);
  if (problem !== undefined) return invalid(problem);

  db.transaction((tx) => {
    if (change.type === "add-group") {
      tx.insert(groups)
        .values({ id: change.groupId, name: change.name.trim() })
        .run();
    } else if (change.type === "add-team") {
      tx.insert(teams)
        .values({
          id: change.teamId,
          groupId: change.groupId,
          name: change.name.trim(),
        })
        .run();
    }
    tx.insert(rosterChanges)
      .values({
        id: submission.id,
        officialEmail: submission.officialEmail,
        change: JSON.stringify(change),
        notes: submission.notes ?? null,
        clientCreatedAt: submission.clientCreatedAt,
        receivedAt: new Date(),
      })
      .run();
  });
  return { ok: true, status: "created" };
}

const levelName = (kind: "group" | "team") =>
  kind === "team" ? "Team" : "Group";

const isGroup = (db: Db, id: string) =>
  db.select().from(groups).where(eq(groups.id, id)).get() !== undefined;
const isTeam = (db: Db, id: string) =>
  db.select().from(teams).where(eq(teams.id, id)).get() !== undefined;
const isKind = (db: Db, kind: "group" | "team", id: string) =>
  kind === "team" ? isTeam(db, id) : isGroup(db, id);

/** Why the change makes no sense, in plain words, or undefined when it's fine. */
function changeProblem(db: Db, change: RosterChange): string | undefined {
  switch (change.type) {
    case "add-group":
      if (change.name.trim() === "") return "A Group needs a name";
      if (isGroup(db, change.groupId) || isTeam(db, change.groupId)) {
        return `${change.groupId} is already on the roster`;
      }
      return undefined;
    case "add-team":
      if (change.name.trim() === "") return "A Team needs a name";
      if (!isGroup(db, change.groupId)) {
        return `Group ${change.groupId} isn't on the roster`;
      }
      if (isGroup(db, change.teamId) || isTeam(db, change.teamId)) {
        return `${change.teamId} is already on the roster`;
      }
      return undefined;
    case "rename":
      if (change.name.trim() === "") {
        return `A ${levelName(change.kind)} needs a name`;
      }
      return isKind(db, change.kind, change.id)
        ? undefined
        : `${change.id} isn't a ${levelName(change.kind)} on the roster`;
    case "merge": {
      if (!isKind(db, change.kind, change.id)) {
        return `${change.id} isn't a ${levelName(change.kind)} on the roster`;
      }
      if (change.intoId === change.id) {
        return `A ${levelName(change.kind)} can't be merged into itself`;
      }
      if (!isKind(db, change.kind, change.intoId)) {
        return isGroup(db, change.intoId) || isTeam(db, change.intoId)
          ? `${change.id} is a ${levelName(change.kind)}; it can only merge into another ${levelName(change.kind)}, not a ${levelName(change.kind === "team" ? "group" : "team")}`
          : `${change.intoId} isn't on the roster`;
      }
      // Following the chain from the target must never come back to this one (a loop).
      const { mergedInto } = resolvedRoster(db);
      let at: string | undefined = change.intoId;
      for (let hops = 0; at !== undefined && hops < 10_000; hops++) {
        if (at === change.id) {
          return "That merge would make a loop: the other one is already merged into this one";
        }
        at = mergedInto.get(at);
      }
      return undefined;
    }
    case "unmerge":
      return resolvedRoster(db).directMerge.has(change.id)
        ? undefined
        : `${change.id} isn't merged now`;
  }
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
  /** Display names, and not the ones merged away now. */
  groups: Group[];
  /** Display names, under their surviving Group, and not the ones merged away now. */
  teams: Team[];
  /** Every merged-away Team and Group, to the one it counts for (chains followed). */
  mergedInto: Map<string, string>;
  /** What each merged-away Team and Group was merged into directly (the latest merge, not yet unmerged). */
  directMerge: Map<string, string>;
  /** The surviving id: itself when not merged away. */
  resolve: (id: string) => string;
  /** The display name of any Group or Team, merged away or not; undefined for an id not on the roster. */
  displayName: (id: string) => string | undefined;
  /** The name as a phone or an add sent it. */
  sentName: (id: string) => string | undefined;
  /** The log with who and when, newest first. */
  history: RosterHistoryRow[];
}

/** The roster as everything but the phones' resend path sees it: the log (ADR-0027) laid over what phones sent. */
export function resolvedRoster(db: Db): ResolvedRoster {
  const log: RosterHistoryRow[] = db
    .select()
    .from(rosterChanges)
    .orderBy(asc(rosterChanges.seq))
    .all()
    .map((row) => ({
      ...row,
      change: JSON.parse(row.change) as RosterChange,
    }));
  const renamed = new Map<string, string>();
  const directMerge = new Map<string, string>();
  for (const { change } of log) {
    if (change.type === "rename") renamed.set(change.id, change.name.trim());
    else if (change.type === "merge") directMerge.set(change.id, change.intoId);
    else if (change.type === "unmerge") directMerge.delete(change.id);
  }
  const resolve = (id: string): string => {
    let at = id;
    // The hop limit is only a guard: a loop is refused when it's logged.
    for (let hops = 0; hops < 10_000; hops++) {
      const next = directMerge.get(at);
      if (next === undefined) return at;
      at = next;
    }
    return at;
  };
  const mergedInto = new Map(
    [...directMerge.keys()].map((id) => [id, resolve(id)]),
  );
  const rawGroups = db.select().from(groups).all();
  const rawTeams = db.select().from(teams).all();
  const sent = new Map([...rawGroups, ...rawTeams].map((e) => [e.id, e.name]));
  const displayName = (id: string) => renamed.get(id) ?? sent.get(id);
  const byName = <T extends { name: string }>(a: T, b: T) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  return {
    groups: rawGroups
      .filter((g) => !directMerge.has(g.id))
      .map((g) => ({ id: g.id, name: displayName(g.id) ?? g.name }))
      .sort(byName),
    teams: rawTeams
      .filter((t) => !directMerge.has(t.id))
      .map((t) => ({
        id: t.id,
        groupId: resolve(t.groupId),
        name: displayName(t.id) ?? t.name,
      }))
      .sort(byName),
    mergedInto,
    directMerge,
    resolve,
    displayName,
    sentName: (id) => sent.get(id),
    history: log.reverse(),
  };
}
