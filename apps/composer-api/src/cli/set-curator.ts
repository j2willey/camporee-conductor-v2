// Makes a signed-in user a curator, who publishes to and unpublishes from the library (ADR-0031 item 3, #102), or
// takes it away with --off. The sysadmin's tool until the admin pages (#104).
// Usage: pnpm --filter @camporee-conductor/composer-api set-curator <email> [--off]
// The database is DATABASE_PATH (default composer.db). The user must have signed in once.
import { parseArgs } from "node:util";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { setCurator } from "../library.ts";

const USAGE = "usage: set-curator <email> [--off]";

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: { off: { type: "boolean", default: false } },
  });
}
try {
  args = parse();
} catch (error) {
  console.error(`${(error as Error).message}\n${USAGE}`);
  process.exit(2);
}
const [email] = args.positionals;
if (!email) {
  console.error(USAGE);
  process.exit(2);
}
const on = !args.values.off;
if (!setCurator(openDb(databasePathFrom(process.env)), email, on)) {
  console.error(`no one with the email ${email} has signed in yet`);
  process.exit(1);
}
console.log(`${email} is ${on ? "now a curator" : "no longer a curator"}`);
