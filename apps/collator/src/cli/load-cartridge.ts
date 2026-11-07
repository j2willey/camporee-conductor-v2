// Loads an event-day cartridge onto the box (issue #40, ADR-0015).
// Usage: pnpm --filter @camporee-conductor/collator load-cartridge <file.zip>
// The database is DATABASE_PATH (default collator.db), the same file the server uses. Relative paths are
// from where pnpm was run.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { loadEventCartridge } from "../load-event.ts";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage: load-cartridge <event-day-cartridge.zip>");
  process.exit(2);
}
// pnpm runs scripts in the package directory; INIT_CWD is where the command was typed.
const path = resolve(process.env["INIT_CWD"] ?? ".", file);

const result = loadEventCartridge(
  openDb(databasePathFrom(process.env)),
  new Uint8Array(readFileSync(path)),
);
if (!result.ok) {
  console.error(`cartridge refused:\n${result.issues.join("\n")}`);
  process.exit(1);
}
console.log(`loaded ${result.event.title} (${result.event.slug})`);
for (const note of result.notes) console.log(`note: ${note}`);
