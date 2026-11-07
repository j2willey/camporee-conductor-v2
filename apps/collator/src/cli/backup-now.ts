// Writes one backup now, as the server's timer does (ADR-0027 item 11): before shutting the box down, or to
// check the stick. Safe while the server runs.
// Usage: pnpm --filter @camporee-conductor/collator backup-now [folder]
// The folder defaults to BACKUP_DIR; the database is DATABASE_PATH, the same file the server uses.
import { backupNow } from "../backup.ts";
import { backupConfigFrom, ConfigError, databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";

const [folder] = process.argv.slice(2);
try {
  const config = backupConfigFrom({
    ...process.env,
    ...(folder && { BACKUP_DIR: folder }),
  });
  if (!config) {
    console.error("usage: backup-now <folder>   (or set BACKUP_DIR)");
    process.exit(2);
  }
  const result = backupNow(openDb(databasePathFrom(process.env)), config);
  if (!result.ok) {
    console.error(`backup failed: ${result.error}`);
    process.exit(1);
  }
  console.log(`backup written: ${result.file}`);
  for (const file of result.pruned) console.log(`pruned: ${file}`);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(2);
}
