import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const EVENT_DOCUMENT_KINDS = [
  "event",
  "activity",
  "common-field-set",
  "officials",
] as const;
export type EventDocumentKind = (typeof EVENT_DOCUMENT_KINDS)[number];

export const EPOCH_REASONS = ["created", "restore", "reset"] as const;
export type EpochReason = (typeof EPOCH_REASONS)[number];

/** `column IN ('a', 'b')`, so the DB enforces what the TypeScript enum only types. */
const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

/**
 * The loaded Event's documents, exactly as in the cartridge (ADR-0012). One Event per box: loading a
 * cartridge replaces them all.
 */
export const eventDocuments = sqliteTable(
  "event_documents",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: EVENT_DOCUMENT_KINDS }).notNull(),
    json: text("json").notNull(),
  },
  () => [check("event_documents_kind", oneOf("kind", EVENT_DOCUMENT_KINDS))],
);

/** Every cartridge loaded, newest last: which Event the box holds, and when it changed. */
export const cartridgeLoads = sqliteTable("cartridge_loads", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  eventId: text("event_id").notNull(),
  manifest: text("manifest").notNull(),
  loadedAt: integer("loaded_at", { mode: "timestamp_ms" }).notNull(),
});

// The roster lives only in the Collator (ADR-0026). Groups and Teams are added by Judges on the spot
// (v1 parity) with ids their phones make, so resending never duplicates them (ADR-0027 item 8).

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  name: text("name").notNull(),
});

/** Judges have no accounts and no pre-list (ADR-0023, ADR-0027 item 6): they're who the phone says. */
export const judges = sqliteTable("judges", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  /** Their own unit, as they typed it (#41 PR 5): a Group's name, not a roster entry; may not be attending. */
  homeGroup: text("home_group"),
});

/**
 * One Judge's score entry, keyed by the id the phone made (ADR-0027 item 8). `receivedSeq` is the order
 * the box received it, which decides "newest" (item 9); the phone's clock is kept for information only.
 * Entries are never overwritten: conflicts and versions are kept for Officials (ADR-0019).
 */
export const scoreEntries = sqliteTable(
  "score_entries",
  {
    receivedSeq: integer("received_seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    judgeId: text("judge_id")
      .notNull()
      .references(() => judges.id),
    activityId: text("activity_id").notNull(),
    /** A Team or a Group, by the Activity's Competition level. */
    entrantId: text("entrant_id").notNull(),
    /** Field id → value, as entered (ADR-0019). */
    values: text("values").notNull(),
    phoneCreatedAt: text("phone_created_at").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("score_entries_activity").on(t.activityId)],
);

/**
 * A Judge closing an Activity (#41 PR 6, v1's "I'm done, close game"): the ids of every score their phone
 * saved there, so the box can say whether it has them all. Keyed by an id the phone made; never
 * overwritten. `afterScoreSeq` is the newest score entry's `receivedSeq` when it arrived: a score from the
 * same Judge at the same Activity after that means they scored again, which reopens it.
 */
export const activityClosures = sqliteTable(
  "activity_closures",
  {
    receivedSeq: integer("received_seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    judgeId: text("judge_id")
      .notNull()
      .references(() => judges.id),
    activityId: text("activity_id").notNull(),
    /** JSON array of score entry ids. */
    scoreIds: text("score_ids").notNull(),
    afterScoreSeq: integer("after_score_seq").notNull(),
    phoneCreatedAt: text("phone_created_at").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("activity_closures_activity").on(t.activityId)],
);

/** Logged Official actions (ADR-0019), oldest first. Keyed by an id the laptop made, so a resend is a repeat. Never updated or deleted. */
export const officialActions = sqliteTable("official_actions", {
  /** Log order: what "latest" means. */
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  /** `normalEmail()` of who did it. */
  officialEmail: text("official_email").notNull(),
  /** JSON: the OfficialAction exactly as packages/scoring takes it. */
  action: text("action").notNull(),
  /** The laptop's clock, for information. */
  clientCreatedAt: text("client_created_at").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Officials added on the box's console (#42 PR 5, ADR-0027 item 5), laid over the cartridge's list. Append-only:
 * never updated or deleted, and for one email the newest row wins. Tied to the Event they were added for.
 */
export const addedOfficials = sqliteTable(
  "added_officials",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    eventId: text("event_id").notNull(),
    /** `normalEmail()`. */
    email: text("email").notNull(),
    name: text("name"),
    role: text("role", { enum: ["director", "official"] }).notNull(),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).notNull(),
  },
  () => [
    check("added_officials_role", oneOf("role", ["director", "official"])),
  ],
);

/**
 * The roster log (ADR-0027, roster changes on the box): adds, renames, merges and unmerges Officials made on the
 * laptop. Append-only: never updated or deleted, and the latest rename, or merge or unmerge, of an entrant wins.
 * Keyed by an id the laptop made, so a resend is a repeat. The Groups and Teams tables keep what phones sent.
 */
export const rosterChanges = sqliteTable("roster_changes", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  /** `normalEmail()` of who did it. */
  officialEmail: text("official_email").notNull(),
  /** JSON: a `RosterChange`. */
  change: text("change").notNull(),
  /** The Official's reason. */
  notes: text("notes"),
  /** The laptop's clock, for information. */
  clientCreatedAt: text("client_created_at").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * Exhibition results (ADR-0027, #42 PR 7): each save is the whole list for one Exhibition, as an Official gave it.
 * Append-only: never updated or deleted, and the newest save for an Activity is its current list. Keyed by an id
 * the laptop made, so a resend is a repeat.
 */
export const exhibitionResultSaves = sqliteTable(
  "exhibition_result_saves",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    activityId: text("activity_id").notNull(),
    /** `normalEmail()` of who saved it. */
    officialEmail: text("official_email").notNull(),
    /** JSON: an `ExhibitionRow[]`, in the order the Official gave. */
    rows: text("rows").notNull(),
    /** The save this one replaces; null when there was none. */
    replacesId: text("replaces_id"),
    /** The laptop's clock, for information. */
    clientCreatedAt: text("client_created_at").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("exhibition_result_saves_activity").on(t.activityId)],
);

/**
 * Exhibition Final and Draft (ADR-0027, #43 PR 2): each change of an Exhibition's results to final or back to
 * draft. Append-only: never updated or deleted; the latest row for an Activity wins, and none means draft.
 */
export const exhibitionStatusChanges = sqliteTable(
  "exhibition_status_changes",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    activityId: text("activity_id").notNull(),
    /** `normalEmail()` of who changed it. */
    officialEmail: text("official_email").notNull(),
    final: integer("final", { mode: "boolean" }).notNull(),
    /** Finalizing: the save the Official loaded, null when none was saved. Null for back to draft. */
    saveId: text("save_id"),
    notes: text("notes"),
    /** The laptop's clock, for information. */
    clientCreatedAt: text("client_created_at").notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("exhibition_status_changes_activity").on(t.activityId)],
);

/**
 * Award sticker label settings (ADR-0027, #43 PR 3): each save is the whole label, as the Event's
 * `presentation.awardLabel` shape. Append-only; the newest row is the current label. Setup, not results, so a reset
 * keeps it.
 */
export const awardLabelSaves = sqliteTable("award_label_saves", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  /** `normalEmail()` of who saved it. */
  officialEmail: text("official_email").notNull(),
  /** JSON: an `AwardLabel`. */
  label: text("label").notNull(),
  /** The laptop's clock, for information. */
  clientCreatedAt: text("client_created_at").notNull(),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
});

/**
 * The box epoch log (#66, ADR-0027): a random id and a reason each time the database is created, restored from a
 * backup or reset. Append-only; the newest row is the current epoch. Phones compare epochs to know whether the box
 * lost scores (restore: resend) or was cleared on purpose (reset: don't).
 */
export const boxEpochs = sqliteTable(
  "box_epochs",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    reason: text("reason", { enum: EPOCH_REASONS }).notNull(),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
  },
  () => [check("box_epochs_reason", oneOf("reason", EPOCH_REASONS))],
);
