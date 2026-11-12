import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "./app.ts";
import { createAuth } from "./auth/index.ts";
import { anthropicProvider } from "./ai/provider.ts";
import { describeAi, describeAuth, type Config } from "./config.ts";
import { openDb } from "./db/open.ts";

/** Opens the database and starts the API on the configured port. */
export function start(config: Config): ServerType {
  console.log(describeAuth(config.auth));
  console.log(describeAi(config.ai));
  const app = createApp({
    db: openDb(config.databasePath),
    auth: createAuth(config.auth),
    authConfig: config.auth,
    webRoot: config.webRoot,
    ...(config.ai && { ai: anthropicProvider(config.ai) }),
  });
  return serve({ fetch: app.fetch, port: config.port }, (info) =>
    console.log(`composer-api listening on :${info.port}`),
  );
}
