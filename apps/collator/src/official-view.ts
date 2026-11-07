import type { CheckedBundle } from "@camporee-conductor/cartridge";
import type { Official } from "@camporee-conductor/schema";
import {
  fillVariables,
  inRankOrder,
  newestEntries,
  scoreEvent,
  type FieldValue,
} from "@camporee-conductor/scoring";
import type { Db } from "./db/open.ts";
import { activityFields, judgeEvent, type JudgeEvent } from "./judge-event.ts";
import { judgeList, roster, scoreEntries } from "./roster-and-scores.ts";

// What Officials see on the box (#40 PR 3): each Activity's score entries and its ranking. Read-only;
// edits, DQ, finalize, conflicts and standings are #42. Every ranking comes from packages/scoring.

/** An email as Officials are matched: trimmed, any case. */
export const normalEmail = (email: string) => email.trim().toLowerCase();

/** The Official on the loaded Event's list with this email, or undefined. */
export function officialByEmail(
  bundle: CheckedBundle,
  email: string,
): Official | undefined {
  const wanted = normalEmail(email);
  return bundle.officials?.officials.find(
    (o) => normalEmail(o.email) === wanted,
  );
}

/** A Team (with its Group) or a Group, by name; null names for an id that isn't on the roster. */
export interface EntrantName {
  name: string | null;
  group: string | null;
}

export interface OfficialEvent {
  event: JudgeEvent["event"];
  activities: (Omit<JudgeEvent["activities"][number], "fields"> & {
    entryCount: number;
  })[];
}

export function officialEvent(db: Db, bundle: CheckedBundle): OfficialEvent {
  const { event, activities } = judgeEvent(bundle);
  const entries = scoreEntries(db);
  return {
    event,
    activities: activities.map(({ id, title, competition }) => ({
      id,
      title,
      competition,
      entryCount: entries.filter((e) => e.activityId === id).length,
    })),
  };
}

export interface OfficialActivity {
  activity: OfficialEvent["activities"][number];
  /** Every field scored at the Activity, Common Fields included, to show values by label. */
  fields: { id: string; label: string }[];
  /** Best first, from packages/scoring (`scoreEvent`, listed by `inRankOrder`). */
  ranking: {
    entrantId: string;
    entrant: EntrantName;
    /** The Final Ranking; null when DQ'd. */
    place: number | null;
    total: number;
    /** Placement points. */
    points: number;
    disqualified: boolean;
  }[];
  /** Every score entry received, in the order received. */
  entries: {
    id: string;
    receivedSeq: number;
    /** The Judge's name only: Judges' emails aren't served. */
    judge: { name: string };
    entrantId: string;
    entrant: EntrantName;
    values: Record<string, FieldValue>;
    phoneCreatedAt: string;
    /** The newest received for this entrant, so the one the ranking uses (ADR-0027 item 9). */
    counts: boolean;
  }[];
}

/** One Activity for Officials, or undefined if the Event doesn't have it. */
export function officialActivity(
  db: Db,
  bundle: CheckedBundle,
  activityId: string,
): OfficialActivity | undefined {
  const found = activityFields(bundle, activityId);
  const listed = officialEvent(db, bundle).activities.find(
    (a) => a.id === activityId,
  );
  if (!found || !listed) return undefined;

  const { groups, teams } = roster(db);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const entrantName = (id: string): EntrantName => {
    const team = teams.find((t) => t.id === id);
    if (team) {
      return { name: team.name, group: groupName.get(team.groupId) ?? null };
    }
    return { name: groupName.get(id) ?? null, group: null };
  };

  const all = scoreEntries(db);
  const newest = newestEntries(all);
  const results = scoreEvent({
    event: bundle.event,
    activities: bundle.activities,
    commonFieldSets: bundle.commonFieldSets,
    entrants: bundle.event.competitions.flatMap((c) =>
      (c.level === "team" ? teams : groups).map((e) => ({
        id: e.id,
        competitionId: c.id,
      })),
    ),
    entries: newest,
    // Official actions are logged on the box with #42.
    actions: [],
  }).activities.find((a) => a.activityId === activityId);

  const judgeName = new Map(judgeList(db).map((j) => [j.id, j.name]));
  const counting = new Set(newest.map((e) => e.id));
  return {
    activity: listed,
    fields: fillVariables(found.fields, found.activity.variables ?? {}).map(
      (f) => ({ id: f.id, label: f.label }),
    ),
    ranking: (results ? inRankOrder(results) : []).map((r) => ({
      entrantId: r.entrantId,
      entrant: entrantName(r.entrantId),
      place: r.disqualified ? null : r.finalRank,
      total: r.total,
      points: r.points,
      disqualified: r.disqualified,
    })),
    entries: all
      .filter((e) => e.activityId === activityId)
      .map((e) => ({
        id: e.id,
        receivedSeq: e.receivedSeq,
        judge: { name: judgeName.get(e.judgeId) ?? e.judgeId },
        entrantId: e.entrantId,
        entrant: entrantName(e.entrantId),
        values: e.values,
        phoneCreatedAt: e.phoneCreatedAt,
        counts: counting.has(e.id),
      })),
  };
}
