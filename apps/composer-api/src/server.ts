import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/index.ts";
import type { Config } from "./config.ts";
import { openDb } from "./db/open.ts";

/** Opens the database and starts the API on the configured port. */
export function start(config: Config): ServerType {
  const app = createApp({
    db: openDb(config.databasePath),
    auth: createAuth(config.auth),
    authConfig: config.auth,
  });
  return serve({ fetch: app.fetch, port: config.port }, (info) =>
    console.log(`composer-api listening on :${info.port}`),
  );
}
