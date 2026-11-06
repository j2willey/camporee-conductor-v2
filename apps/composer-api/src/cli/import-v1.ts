// Imports a v1 cartridge (a v1 Composer export zip, or a v1 workspace directory) into an Organization,
// applying the event's overlay (issue #46). 2027 is designed in v1, so this runs again after every design
// change; ids are stable, so a re-import updates rather than duplicates.
// Usage: pnpm --filter @camporee-conductor/composer-api import-v1 <org-slug> <cartridge.zip|dir> [--overlay overlay.json] [--strict]
//   --strict  refuse if any game would be skipped (use it for the final pre-event import)
// The database is DATABASE_PATH (default composer.db). Relative paths are from where pnpm was run.
// Unpublished designs: keep the cartridge outside the repo; only the overlay belongs in events/.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  importV1,
  parseV1Overlay,
  v1ImportOptions,
  V1ImportError,
} from "@camporee-conductor/cartridge";
import { eq } from "drizzle-orm";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { organizations } from "../db/schema.ts";
import { ImportError, importEvent } from "../import/import-event.ts";
import { leftoverActivities } from "../import/leftover-activities.ts";
import {
  CartridgeReadError,
  readV1Cartridge,
} from "../import/read-v1-cartridge.ts";

const USAGE =
  "usage: import-v1 <org-slug> <cartridge.zip|dir> [--overlay overlay.json] [--strict]";

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      overlay: { type: "string" },
      strict: { type: "boolean", default: false },
    },
  });
}
try {
  args = parse();
} catch (error) {
  console.error(`${(error as Error).message}\n${USAGE}`);
  process.exit(2);
}
const [orgSlug, cartridgePath] = args.positionals;
if (!orgSlug || !cartridgePath) {
  console.error(USAGE);
  process.exit(2);
}
// pnpm runs scripts in the package directory; INIT_CWD is where the command was typed.
const from = (path: string) => resolve(process.env["INIT_CWD"] ?? ".", path);

const db = openDb(databasePathFrom(process.env));
const org = db
  .select({ id: organizations.id })
  .from(organizations)
  .where(eq(organizations.slug, orgSlug))
  .get();
if (!org) {
  console.error(`no Organization with slug "${orgSlug}"`);
  process.exit(1);
}

try {
  const cartridge = readV1Cartridge(from(cartridgePath));
  const overlay = args.values.overlay
    ? parseV1Overlay(
        JSON.parse(readFileSync(from(args.values.overlay), "utf8")),
      )
    : {};
  const result = importV1(cartridge, overlay, { strict: args.values.strict });

  if (result.skipped.length > 0) {
    const n = result.skipped.length;
    console.log("");
    console.log(
      `!! SKIPPED ${n} ${n === 1 ? "game" : "games"} (not imported):`,
    );
    for (const { game, reason } of result.skipped) {
      console.log(`!!   ${game}: ${reason}`);
    }
    console.log("");
  }
  for (const note of result.notes) console.log(`note: ${note}`);

  const { eventId, created, updated } = importEvent(db, org.id, {
    event: result.event,
    activities: result.activities,
    commonFieldSets: [result.commonFieldSet],
    ...(result.officials && { officials: result.officials }),
  });
  console.log(
    `imported Event ${eventId}: ${created} created, ${updated} updated`,
  );

  const leftovers = leftoverActivities(
    db,
    org.id,
    cartridge,
    v1ImportOptions(cartridge, overlay),
  );
  if (leftovers.length > 0) {
    const n = leftovers.length;
    console.log("");
    console.log(
      `${n} ${n === 1 ? "Activity" : "Activities"} no longer in the cartridge (kept in the database, not in the Event):`,
    );
    for (const { slug, title } of leftovers) {
      console.log(`  - ${title} (${slug})`);
    }
  }
} catch (error) {
  if (
    error instanceof V1ImportError ||
    error instanceof ImportError ||
    error instanceof CartridgeReadError
  ) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
