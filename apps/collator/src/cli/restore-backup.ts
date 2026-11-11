// Restores a backup over the box's database. Run while the server is stopped (docs/runbook/collator.md §5).
// Usage: pnpm --filter @camporee-conductor/collator restore-backup <backup-file>
// The database is DATABASE_PATH, the same file the server uses. A restore appends a `restore` epoch (#66), so
// phones resend what the backup missed.
import { resolve } from "node:path";
import { databasePathFrom } from "../config.ts";
import { restoreBackup } from "../restore.ts";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage: restore-backup <backup-file>");
  process.exit(2);
}
const result = restoreBackup(
  resolve(process.env["INIT_CWD"] ?? ".", file),
  databasePathFrom(process.env),
);
if (!result.ok) {
  console.error(`restore refused: ${result.error}`);
  process.exit(1);
}
console.log(`restored backup: ${result.backup}`);
console.log(`box epoch: ${result.epoch.id} (${result.epoch.reason})`);
