import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.ts";
import { scheduleBackups } from "./backup.ts";
import type { Config, FirstLoad } from "./config.ts";
import { openDb } from "./db/open.ts";
import { loadedEvent } from "./load-event.ts";

/** Opens the database, starts backups if configured, and starts the Collator on the configured port. */
export function start(config: Config): ServerType {
  const db = openDb(config.databasePath);
  const event = loadedEvent(db)?.manifest.event;
  console.log(
    event
      ? `event: ${event.title} (${event.slug})`
      : "event: none loaded yet (upload it on the Official page, or load-cartridge <file.zip>)",
  );
  if (!event) console.log(firstLoadLine(config.firstLoad));
  const backups = config.backup && scheduleBackups(db, config.backup);
  console.log(
    config.backup
      ? `backups: to ${config.backup.dir} every ${config.backup.everyMinutes} min`
      : "backups: off (set BACKUP_DIR to turn them on)",
  );
  const server = serve(
    {
      fetch: createApp({
        db,
        webRoot: config.webRoot,
        backup: config.backup,
        firstLoad: config.firstLoad,
      }).fetch,
      port: config.port,
    },
    (info) => console.log(`collator listening on :${info.port}`),
  );
  server.on("close", () => backups?.stop());
  return server;
}

/** What the log says about the first load (ADR-0027, provisional): a made-up setup code is printed here only. */
export function firstLoadLine(firstLoad: FirstLoad): string {
  if (firstLoad.mode === "open") {
    return "first load: open, no setup code (FIRST_LOAD=open: only for a box with no internet)";
  }
  return firstLoad.generated
    ? `first load: setup code ${firstLoad.code} (made up at start; set SETUP_CODE to choose one)`
    : "first load: needs the setup code in SETUP_CODE";
}
