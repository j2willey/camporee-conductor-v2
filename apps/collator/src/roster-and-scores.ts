import {
  mergeCommonFields,
  type FieldValue,
} from "@camporee-conductor/scoring";
import { asc, eq } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import {
  groups,
  judges,
  scoreEntries as scoreEntriesTable,
  teams,
} from "./db/schema.ts";
import { loadedEvent } from "./load-event.ts";

// What Judges' phones send: Groups and Teams added on the spot, and score entries. Each carries an id
// the phone made, so a resend is a repeat, never a duplicate (ADR-0027 item 8). The same id with
// different content is refused: that's an accidental conflicting resend. Judge corrections are a new
// flow, decided in #41 / #42.

export type Recorded =
  | { ok: true; status: "created" | "repeat" }
  | { ok: false; reason: "no-event" | "conflict" | "invalid"; message: string };

const NO_EVENT: Recorded = {
  ok: false,
  reason: "no-event",
  message: "no Event is loaded on this box yet",
};
const CREATED: Recorded = { ok: true, status: "created" };
const REPEAT: Recorded = { ok: true, status: "repeat" };
const conflict = (what: string, id: string): Recorded => ({
  ok: false,
  reason: "conflict",
  message: `${what} ${id} was already received with different content`,
});
const invalid = (message: string): Recorded => ({
  ok: false,
  reason: "invalid",
  message,
});

export interface GroupSubmission {
  id: string;
  name: string;
}

export function recordGroup(db: Db, group: GroupSubmission): Recorded {
  if (!loadedEvent(db)) return NO_EVENT;
  const existing = db
    .select()
    .from(groups)
    .where(eq(groups.id, group.id))
    .get();
  if (existing) {
    return existing.name === group.name ? REPEAT : conflict("Group", group.id);
  }
  db.insert(groups).values(group).run();
  return CREATED;
}

export interface TeamSubmission {
  id: string;
  groupId: string;
  name: string;
}

export function recordTeam(db: Db, team: TeamSubmission): Recorded {
  if (!loadedEvent(db)) return NO_EVENT;
  const existing = db.select().from(teams).where(eq(teams.id, team.id)).get();
  if (existing) {
    return existing.groupId === team.groupId && existing.name === team.name
      ? REPEAT
      : conflict("Team", team.id);
  }
  if (!db.select().from(groups).where(eq(groups.id, team.groupId)).get()) {
    return invalid(`Group ${team.groupId} isn't on the roster`);
  }
  db.insert(teams).values(team).run();
  return CREATED;
}

export interface JudgeIdentity {
  id: string;
  name: string;
  email: string;
}

export interface ScoreSubmission {
  id: string;
  /** Who the phone says is judging: no account (ADR-0023). */
  judge: JudgeIdentity;
  activityId: string;
  entrantId: string;
  values: Record<string, FieldValue>;
  /** The phone's clock: for information only (ADR-0027 item 9). */
  phoneCreatedAt: string;
}

export function recordScore(db: Db, score: ScoreSubmission): Recorded {
  const event = loadedEvent(db);
  if (!event) return NO_EVENT;

  // A resend is checked first: an acknowledged score stays a repeat even if the design was reloaded since.
  const existing = db
    .select()
    .from(scoreEntriesTable)
    .where(eq(scoreEntriesTable.id, score.id))
    .get();
  if (existing) {
    const same =
      sameContent({
        judgeId: existing.judgeId,
        activityId: existing.activityId,
        entrantId: existing.entrantId,
        values: JSON.parse(existing.values) as Record<string, FieldValue>,
        phoneCreatedAt: existing.phoneCreatedAt,
      }) === sameContent({ ...score, judgeId: score.judge.id });
    return same ? REPEAT : conflict("Score entry", score.id);
  }

  const { bundle } = event;
  const listed = bundle.event.activities.find(
    (a) => a.activityId === score.activityId,
  );
  const activity = bundle.activities.find((a) => a.id === score.activityId);
  const competition = bundle.event.competitions.find(
    (c) => c.id === listed?.competitionId,
  );
  if (!listed || !activity || !competition) {
    return invalid(`Activity ${score.activityId} isn't in the loaded Event`);
  }

  const fieldIds = new Set(
    mergeCommonFields(activity, competition, bundle.commonFieldSets).map(
      (f) => f.id,
    ),
  );
  const unknown = Object.keys(score.values).filter((id) => !fieldIds.has(id));
  if (unknown.length > 0) {
    return invalid(
      `${activity.title} has no field ${unknown.join(", ")} (its fields, with Common Fields: ${[...fieldIds].join(", ")})`,
    );
  }

  const onRoster =
    competition.level === "team"
      ? db.select().from(teams).where(eq(teams.id, score.entrantId)).get()
      : db.select().from(groups).where(eq(groups.id, score.entrantId)).get();
  if (!onRoster) {
    const level = competition.level === "team" ? "Team" : "Group";
    return invalid(
      `${score.entrantId} isn't a ${level} on the roster; ${activity.title} is scored per ${level} (${competition.label})`,
    );
  }

  db.transaction((tx) => {
    tx.insert(judges)
      .values(score.judge)
      .onConflictDoUpdate({
        target: judges.id,
        set: { name: score.judge.name, email: score.judge.email },
      })
      .run();
    tx.insert(scoreEntriesTable)
      .values({
        id: score.id,
        judgeId: score.judge.id,
        activityId: score.activityId,
        entrantId: score.entrantId,
        values: JSON.stringify(score.values),
        phoneCreatedAt: score.phoneCreatedAt,
        receivedAt: new Date(),
      })
      .run();
  });
  return CREATED;
}

/** What makes two submissions of one score id the same: everything but the Judge's name and email. */
function sameContent(s: {
  judgeId: string;
  activityId: string;
  entrantId: string;
  values: Record<string, FieldValue>;
  phoneCreatedAt: string;
}): string {
  const values = Object.fromEntries(
    Object.entries(s.values).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return JSON.stringify([
    s.judgeId,
    s.activityId,
    s.entrantId,
    values,
    s.phoneCreatedAt,
  ]);
}

export interface ScoreEntryRow {
  receivedSeq: number;
  id: string;
  judgeId: string;
  activityId: string;
  entrantId: string;
  values: Record<string, FieldValue>;
  phoneCreatedAt: string;
}

/** Every score entry, in the order the box received them. */
export function scoreEntries(db: Db): ScoreEntryRow[] {
  return db
    .select()
    .from(scoreEntriesTable)
    .orderBy(asc(scoreEntriesTable.receivedSeq))
    .all()
    .map((row) => ({
      receivedSeq: row.receivedSeq,
      id: row.id,
      judgeId: row.judgeId,
      activityId: row.activityId,
      entrantId: row.entrantId,
      values: JSON.parse(row.values) as Record<string, FieldValue>,
      phoneCreatedAt: row.phoneCreatedAt,
    }));
}

export function roster(db: Db) {
  return {
    groups: db.select().from(groups).orderBy(asc(groups.name)).all(),
    teams: db.select().from(teams).orderBy(asc(teams.name)).all(),
  };
}

/** Judges, with their emails: never served without the Official gate (#40 PR 3). */
export function judgeList(db: Db): JudgeIdentity[] {
  return db.select().from(judges).orderBy(asc(judges.id)).all();
}
