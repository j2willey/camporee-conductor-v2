import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.ts";
import { scheduleBackups } from "./backup.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db/open.ts";
import { loadedEvent } from "./load-event.ts";

/** Opens the database, starts backups if configured, and starts the Collator on the configured port. */
export function start(config: Config): ServerType {
  const db = openDb(config.databasePath);
  const event = loadedEvent(db)?.manifest.event;
  console.log(
    event
      ? `event: ${event.title} (${event.slug})`
      : "event: none loaded yet (load-cartridge <file.zip>)",
  );
  const backups = config.backup && scheduleBackups(db, config.backup);
  console.log(
    config.backup
      ? `backups: to ${config.backup.dir} every ${config.backup.everyMinutes} min`
      : "backups: off (set BACKUP_DIR to turn them on)",
  );
  const server = serve(
    {
      fetch: createApp({ db, webRoot: config.webRoot }).fetch,
      port: config.port,
    },
    (info) => console.log(`collator listening on :${info.port}`),
  );
  server.on("close", () => backups?.stop());
  return server;
}
