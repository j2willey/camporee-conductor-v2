import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db/open.ts";
import { loadedEvent } from "./load-event.ts";

/** Opens the database and starts the Collator on the configured port. */
export function start(config: Config): ServerType {
  const db = openDb(config.databasePath);
  const event = loadedEvent(db)?.manifest.event;
  console.log(
    event
      ? `event: ${event.title} (${event.slug})`
      : "event: none loaded yet (load-cartridge <file.zip>)",
  );
  return serve({ fetch: createApp({ db }).fetch, port: config.port }, (info) =>
    console.log(`collator listening on :${info.port}`),
  );
}
