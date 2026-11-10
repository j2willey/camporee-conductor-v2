// Lists the box's Officials: the cartridge's, with those added on the console (#42 PR 5).
// Usage: list-officials. The database is DATABASE_PATH (default collator.db).
import { databasePathFrom } from "../config.ts";
import { openDb } from "../db/open.ts";
import { loadedEvent } from "../load-event.ts";
import { officialsOf } from "../officials.ts";

const db = openDb(databasePathFrom(process.env));
const event = loadedEvent(db);
if (!event) {
  console.error("no Event is loaded on this box yet");
  process.exit(1);
}
for (const o of officialsOf(db, event.bundle)) {
  const from =
    o.source === "box" && o.addedAt
      ? `box, added ${o.addedAt.toISOString()}`
      : "cartridge";
  console.log([o.email, o.role, o.name ?? "-", from].join("\t"));
}
