import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ensureEpoch } from "../epoch.ts";
import * as schema from "./schema.ts";

/** The Drizzle database, with the better-sqlite3 connection underneath (`$client`) for backups. */
export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

const MIGRATIONS = new URL("../../drizzle", import.meta.url).pathname;

/** Opens (or creates) the Collator database and applies any pending migrations. `:memory:` for tests. */
export function openDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  ensureEpoch(db);
  return db;
}
