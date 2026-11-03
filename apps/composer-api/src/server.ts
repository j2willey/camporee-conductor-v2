import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type { Config } from "./config.ts";

/** Starts the API on the configured port. */
export async function start(config: Config): Promise<ServerType> {
  const app = new Hono().get("/health", (c) => c.json({ ok: true }));
  return serve({ fetch: app.fetch, port: config.port });
}
