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
