import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Db = BetterSQLite3Database<typeof schema>;

const MIGRATIONS = new URL("../../drizzle", import.meta.url).pathname;

/** Opens (or creates) the database and applies any pending migrations. `:memory:` for tests. */
export function openDb(path: string): Db {
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL"); // Litestream needs WAL (ADR-0013)
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}
