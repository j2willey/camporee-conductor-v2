// Adds an Official on the box's console, or updates one (#42 PR 5, ADR-0027 item 5). No sign-in: having the
// console is the trust. Usage: add-official <email> [--name "<name>"] [--director | --official]
// The database is DATABASE_PATH (default collator.db), the same file the server uses.
import { parseArgs } from "node:util";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { addOfficial } from "../officials.ts";

const USAGE =
  'usage: add-official <email> [--name "<name>"] [--director | --official]';

let parsed;
try {
  parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      name: { type: "string" },
      director: { type: "boolean" },
      official: { type: "boolean" },
    },
  });
} catch (error) {
  console.error(`${(error as Error).message}\n${USAGE}`);
  process.exit(2);
}
const { values, positionals } = parsed;
const [email] = positionals;
if (!email || positionals.length > 1 || (values.director && values.official)) {
  console.error(USAGE);
  process.exit(2);
}

const result = addOfficial(openDb(databasePathFrom(process.env)), {
  email,
  ...(values.name !== undefined && { name: values.name }),
  ...(values.director && { role: "director" as const }),
  ...(values.official && { role: "official" as const }),
});
if (!result.ok) {
  console.error(`refused: ${result.error}`);
  process.exit(1);
}
const { official } = result;
console.log(`${result.status} ${official.email} (${official.role})`);
console.log(`They sign in at /official with ${official.email}.`);
