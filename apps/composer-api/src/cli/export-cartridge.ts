// Writes an Event's cartridge to a file, e.g. onto the USB stick that goes to the on-site box (ADR-0015).
// Usage: pnpm --filter @camporee-conductor/composer-api export-cartridge <org-slug> <event-slug> [--profile design|event-day] [--out file.zip]
//   --profile  design (default) or event-day (what the Collator loads; includes the Officials, ADR-0027 item 5)
//   --out      default: ./<event-slug>-<profile>.zip
// The database is DATABASE_PATH (default composer.db). Relative paths are from where pnpm was run.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  CartridgeError,
  CartridgeProfileSchema,
  exportCartridge,
} from "@camporee-conductor/cartridge";
import { and, eq } from "drizzle-orm";
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { documents, organizations } from "../db/schema.ts";
import { readEventDocuments } from "../export/read-event-documents.ts";

const USAGE =
  "usage: export-cartridge <org-slug> <event-slug> [--profile design|event-day] [--out file.zip]";

function parse() {
  return parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: "string", default: "design" },
      out: { type: "string" },
    },
  });
}
let args: ReturnType<typeof parse>;
try {
  args = parse();
} catch (error) {
  console.error(`${(error as Error).message}\n${USAGE}`);
  process.exit(2);
}
const [orgSlug, eventSlug] = args.positionals;
const profile = CartridgeProfileSchema.safeParse(args.values.profile);
if (!orgSlug || !eventSlug || !profile.success) {
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
const event = db
  .select({ id: documents.id })
  .from(documents)
  .where(
    and(
      eq(documents.organizationId, org.id),
      eq(documents.kind, "event"),
      eq(documents.slug, eventSlug),
    ),
  )
  .get();
const found = event && readEventDocuments(db, event.id);
if (!found) {
  console.error(`no Event "${eventSlug}" in ${orgSlug}`);
  process.exit(1);
}

try {
  const zip = exportCartridge(found.bundle, profile.data, {
    exportedAt: new Date(),
  });
  const out = from(args.values.out ?? `${eventSlug}-${profile.data}.zip`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, zip);
  console.log(
    `wrote ${out}: the ${profile.data} cartridge (${zip.length} bytes)`,
  );
} catch (error) {
  if (error instanceof CartridgeError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
