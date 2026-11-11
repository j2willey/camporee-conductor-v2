import type { CheckedBundle } from "@camporee-conductor/cartridge";
import { desc, eq } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import { exhibitionResultSaves, exhibitionStatusChanges } from "./db/schema.ts";
import { activityFields } from "./bundle-lookup.ts";
import { officialByEmail } from "./officials.ts";
import {
  conflict,
  invalid,
  type Recorded,
  type Refused,
} from "./roster-and-scores.ts";

// Exhibition results (ADR-0027, #42 PR 7): an Official's record of each Participant's place at an Exhibition. Each
// save is the whole list, appended to a log; the newest save is the current list. Never seen by packages/scoring.

/** One Participant's result. All free text (a Participant may not be on the roster), trimmed. */
export interface ExhibitionRow {
  participantName: string;
  group: string;
  team: string;
  place: string;
  notes: string;
}

export interface ExhibitionSaveSubmission {
  id: string;
  /** `normalEmail()` of the Official. */
  officialEmail: string;
  activityId: string;
  rows: ExhibitionRow[];
  /** The `saveId` the Official loaded; null when there was none. */
  replacesId: string | null;
  clientCreatedAt: string;
}

export interface ExhibitionResultsView {
  activity: {
    id: string;
    title: string;
    competition: { id: string; label: string; level: "team" | "group" };
  };
  rows: ExhibitionRow[];
  saveId: string | null;
  /** The Official's name, else email. */
  savedBy: string | null;
  savedAt: string | null;
  /** The latest status change when it made the results final; null for a draft (none, or put back to draft). */
  final: {
    by: string;
    at: string;
    saveId: string | null;
    notes: string | null;
  } | null;
  /** Every save, newest first. */
  history: { saveId: string; by: string; at: string; rowCount: number }[];
}

export const MAX_ROWS = 500;
const MAX_FIELD = 200;
const MAX_NOTES = 1000;

const FINAL_MESSAGE =
  "These results are final; put them back to draft to change them.";

const STALE: Refused = {
  ok: false,
  reason: "conflict",
  message:
    "Another Official saved these results since you loaded them; reload and save again.",
};

/** The rows trimmed, with the keys in a fixed order; a problem in plain words for the first bad row. */
function checkedRows(
  rows: ExhibitionRow[],
): { rows: ExhibitionRow[] } | { problem: string } {
  if (rows.length > MAX_ROWS) {
    return { problem: `At most ${MAX_ROWS} rows can be saved` };
  }
  const out: ExhibitionRow[] = [];
  for (const [i, r] of rows.entries()) {
    const row = {
      participantName: r.participantName.trim(),
      group: r.group.trim(),
      team: r.team.trim(),
      place: r.place.trim(),
      notes: r.notes.trim(),
    };
    if (row.participantName === "") {
      return { problem: `Row ${i + 1} has no name` };
    }
    for (const [key, value] of Object.entries(row)) {
      if (value.length > (key === "notes" ? MAX_NOTES : MAX_FIELD)) {
        return {
          problem: `Row ${i + 1}: ${key} is too long (at most ${key === "notes" ? MAX_NOTES : MAX_FIELD} characters)`,
        };
      }
    }
    out.push(row);
  }
  return { rows: out };
}

const contentOf = (
  email: string,
  activityId: string,
  rows: ExhibitionRow[],
  replacesId: string | null,
  clientCreatedAt: string,
) => JSON.stringify([email, activityId, rows, replacesId, clientCreatedAt]);

const latestSave = (db: Db, activityId: string) =>
  db
    .select()
    .from(exhibitionResultSaves)
    .where(eq(exhibitionResultSaves.activityId, activityId))
    .orderBy(desc(exhibitionResultSaves.seq))
    .limit(1)
    .get();

const latestStatus = (db: Db, activityId: string) =>
  db
    .select()
    .from(exhibitionStatusChanges)
    .where(eq(exhibitionStatusChanges.activityId, activityId))
    .orderBy(desc(exhibitionStatusChanges.seq))
    .limit(1)
    .get();

/** The Activity ids whose latest status change is final. */
export function finalExhibitions(db: Db): Set<string> {
  const latest = new Map<string, boolean>();
  for (const c of db
    .select()
    .from(exhibitionStatusChanges)
    .orderBy(exhibitionStatusChanges.seq)
    .all()) {
    latest.set(c.activityId, c.final);
  }
  return new Set([...latest].filter(([, final]) => final).map(([id]) => id));
}

/** The rows of an Exhibition's latest save, in the Official's order; empty when never saved. */
export function latestRows(db: Db, activityId: string): ExhibitionRow[] {
  const latest = latestSave(db, activityId);
  return latest ? (JSON.parse(latest.rows) as ExhibitionRow[]) : [];
}

export interface ExhibitionStatusSubmission {
  id: string;
  /** `normalEmail()` of the Official. */
  officialEmail: string;
  activityId: string;
  final: boolean;
  /** Finalizing: the save the Official loaded (null when none). Null for back to draft. */
  saveId: string | null;
  notes: string | null;
  clientCreatedAt: string;
}

const statusContent = (s: {
  officialEmail: string;
  activityId: string;
  final: boolean;
  saveId: string | null;
  notes: string | null;
  clientCreatedAt: string;
}) =>
  JSON.stringify([
    s.officialEmail,
    s.activityId,
    s.final,
    s.saveId,
    s.notes,
    s.clientCreatedAt,
  ]);

/**
 * Logs marking an Exhibition's results final, or back to draft (ADR-0027, #43 PR 2). A resend of the same id and
 * content is a repeat; the same id with other content is a conflict. Finalizing must name the latest save (or none),
 * or it's refused as stale.
 */
export function recordExhibitionStatus(
  db: Db,
  bundle: CheckedBundle,
  submission: ExhibitionStatusSubmission,
): Recorded {
  const { id, activityId, final } = submission;
  const existing = db
    .select()
    .from(exhibitionStatusChanges)
    .where(eq(exhibitionStatusChanges.id, id))
    .get();
  if (existing) {
    return statusContent(existing) === statusContent(submission)
      ? { ok: true, status: "repeat" }
      : conflict("Exhibition status change", id);
  }
  const wrongKind = notExhibition(bundle, activityId);
  if (wrongKind !== undefined) return invalid(wrongKind);
  const isFinal = latestStatus(db, activityId)?.final ?? false;
  if (final && isFinal) return invalid("These results are already final.");
  if (!final && !isFinal) return invalid("These results are already a draft.");
  if (final && (latestSave(db, activityId)?.id ?? null) !== submission.saveId) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "New results were saved since you loaded this; reload and mark final again.",
    };
  }
  db.insert(exhibitionStatusChanges)
    .values({
      id,
      activityId,
      officialEmail: submission.officialEmail,
      final,
      saveId: final ? submission.saveId : null,
      notes: submission.notes,
      clientCreatedAt: submission.clientCreatedAt,
      receivedAt: new Date(),
    })
    .run();
  return { ok: true, status: "created" };
}

/** Why this Activity can't hold results, or undefined when it's an Exhibition in the Event. */
export function notExhibition(
  bundle: CheckedBundle,
  activityId: string,
): string | undefined {
  const found = activityFields(bundle, activityId);
  if (!found) return "No such Activity in the loaded Event";
  if (found.activity.scoringType !== "exhibition") {
    return `${found.activity.title} isn't an Exhibition, so it has no results to record`;
  }
  return undefined;
}

/**
 * Logs a save of an Exhibition's whole results list. A resend of the same id and content is a repeat; the same id
 * with other content is a conflict. The save must replace the latest one (the one the Official loaded), or it's
 * refused as stale.
 */
export function recordExhibitionResults(
  db: Db,
  bundle: CheckedBundle,
  submission: ExhibitionSaveSubmission,
): Recorded {
  const { id, activityId, replacesId } = submission;
  const checked = checkedRows(submission.rows);
  const rows = "rows" in checked ? checked.rows : submission.rows;
  const existing = db
    .select()
    .from(exhibitionResultSaves)
    .where(eq(exhibitionResultSaves.id, id))
    .get();
  if (existing) {
    const same =
      contentOf(
        existing.officialEmail,
        existing.activityId,
        JSON.parse(existing.rows) as ExhibitionRow[],
        existing.replacesId,
        existing.clientCreatedAt,
      ) ===
      contentOf(
        submission.officialEmail,
        activityId,
        rows,
        replacesId,
        submission.clientCreatedAt,
      );
    return same
      ? { ok: true, status: "repeat" }
      : conflict("Exhibition results save", id);
  }
  const wrongKind = notExhibition(bundle, activityId);
  if (wrongKind !== undefined) return invalid(wrongKind);
  if ("problem" in checked) return invalid(checked.problem);
  if (latestStatus(db, activityId)?.final) {
    return { ok: false, reason: "conflict", message: FINAL_MESSAGE };
  }
  if ((latestSave(db, activityId)?.id ?? null) !== replacesId) return STALE;
  db.insert(exhibitionResultSaves)
    .values({
      id,
      activityId,
      officialEmail: submission.officialEmail,
      rows: JSON.stringify(checked.rows),
      replacesId,
      clientCreatedAt: submission.clientCreatedAt,
      receivedAt: new Date(),
    })
    .run();
  return { ok: true, status: "created" };
}

/** The number of rows in each Activity's latest save, by Activity id; Activities never saved are left out. */
export function resultCounts(db: Db): Map<string, number> {
  const counts = new Map<string, number>();
  for (const s of db
    .select()
    .from(exhibitionResultSaves)
    .orderBy(exhibitionResultSaves.seq)
    .all()) {
    counts.set(s.activityId, (JSON.parse(s.rows) as unknown[]).length);
  }
  return counts;
}

/**
 * An Exhibition's current results and the log of saves. Undefined for an Activity not in the Event; an Activity
 * that isn't an Exhibition is a problem to say in words (`notExhibition`).
 */
export function exhibitionResults(
  db: Db,
  bundle: CheckedBundle,
  activityId: string,
): ExhibitionResultsView | undefined {
  const found = activityFields(bundle, activityId);
  if (!found) return undefined;
  const who = (email: string) =>
    officialByEmail(db, bundle, email)?.name ?? email;
  const saves = db
    .select()
    .from(exhibitionResultSaves)
    .where(eq(exhibitionResultSaves.activityId, activityId))
    .orderBy(desc(exhibitionResultSaves.seq))
    .all();
  const [latest] = saves;
  const status = latestStatus(db, activityId);
  return {
    activity: {
      id: found.activity.id,
      title: found.activity.title,
      competition: {
        id: found.competition.id,
        label: found.competition.label,
        level: found.competition.level,
      },
    },
    rows: latest ? (JSON.parse(latest.rows) as ExhibitionRow[]) : [],
    saveId: latest?.id ?? null,
    savedBy: latest ? who(latest.officialEmail) : null,
    savedAt: latest ? latest.receivedAt.toISOString() : null,
    final: status?.final
      ? {
          by: who(status.officialEmail),
          at: status.receivedAt.toISOString(),
          saveId: status.saveId,
          notes: status.notes,
        }
      : null,
    history: saves.map((s) => ({
      saveId: s.id,
      by: who(s.officialEmail),
      at: s.receivedAt.toISOString(),
      rowCount: (JSON.parse(s.rows) as unknown[]).length,
    })),
  };
}
