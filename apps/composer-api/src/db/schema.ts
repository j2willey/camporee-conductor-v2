import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const DOCUMENT_KINDS = [
  "event",
  "activity",
  "common-field-set",
  "template",
  /** An Event's Officials: event-day cartridge only (ADR-0027 item 5, issue #8). */
  "officials",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** `column IN ('a', 'b')`, so the DB enforces what the TypeScript enum only types. */
const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`${column} IN (${values.map((v) => `'${v}'`).join(", ")})`);

/** A person who has signed in. `id` is the auth provider's user id (ADR-0014). */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Owns Events and, later, profiles and private Templates (ADR-0021). */
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** A user's role in an Organization (issue #4, D3). */
export const memberships = sqliteTable(
  "memberships",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    check("memberships_role", oneOf("role", ROLES)),
  ],
);

/**
 * Design documents (Event, Activity, Common Field set, Template) exactly as they appear in a cartridge,
 * plus a few indexed fields (ADR-0012). `json` is the document as imported, never a DB-only shape.
 */
export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    json: text("json").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => [
    index("documents_organization_kind").on(t.organizationId, t.kind),
    check("documents_kind", oneOf("kind", DOCUMENT_KINDS)),
  ],
);

/**
 * A pending invite (#35, #101): an owner added an email no one has signed in with yet. The first sign-in with
 * that **verified** email turns it into a membership, and the invite goes (`recordUser`). Emails are stored
 * lowercase. Re-inviting the same email updates the role.
 */
export const invites = sqliteTable(
  "invites",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    email: text("email").notNull(),
    role: text("role", { enum: ROLES }).notNull(),
    /** The owner who invited them: the auth provider's user id. */
    invitedBy: text("invited_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.email] }),
    index("invites_email").on(t.email),
    check("invites_role", oneOf("role", ROLES)),
  ],
);

/**
 * Who changed what, and when (ADR-0029 item 5). One row per save, create, delete, import, publish or accepted
 * AI change. Never holds document bodies; `detail` is a small JSON object when an action needs one.
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    /** The auth provider's user id (ADR-0014); null for a CLI action. */
    userId: text("user_id"),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    action: text("action").notNull(),
    documentKind: text("document_kind", { enum: DOCUMENT_KINDS }),
    documentId: text("document_id"),
    detail: text("detail", { mode: "json" }),
  },
  (t) => [index("audit_log_organization_at").on(t.organizationId, t.at)],
);
