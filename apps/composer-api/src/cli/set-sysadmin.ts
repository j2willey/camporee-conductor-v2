// Makes a signed-in user a sysadmin (ADR-0032, #104), who manages users from the admin pages and acts as an owner of
// every Organization for the rollout; --off takes it away. For the first sysadmin; after that, the admin page.
// Usage: pnpm --filter @camporee-conductor/composer-api set-sysadmin <email> [--off]
// The database is DATABASE_PATH (default composer.db). The user must have signed in once.
import { parseArgs } from "node:util";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { setSysadmin } from "../admin.ts";

const USAGE = "usage: set-sysadmin <email> [--off]";

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
if (!setSysadmin(openDb(databasePathFrom(process.env)), email, on)) {
  console.error(`no one with the email ${email} has signed in yet`);
  process.exit(1);
}
console.log(`${email} is ${on ? "now a sysadmin" : "no longer a sysadmin"}`);
