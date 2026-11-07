import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import type { Db } from "./db/open.ts";
import { judgeEvent } from "./judge-event.ts";
import { loadedEvent } from "./load-event.ts";
import {
  recordGroup,
  recordScore,
  recordTeam,
  roster,
  type Recorded,
} from "./roster-and-scores.ts";

const Name = z.string().trim().min(1).max(200);
/** An id a phone made (ADR-0027 item 8). Any opaque string; phones use UUIDs. */
const PhoneId = z.string().min(1).max(100);

const GroupBody = z.strictObject({ name: Name });
const TeamBody = z.strictObject({ groupId: PhoneId, name: Name });
const ScoreBody = z.strictObject({
  judge: z.strictObject({
    id: PhoneId,
    name: Name,
    email: z.string().trim().toLowerCase().pipe(z.email()),
  }),
  activityId: z.string().min(1),
  entrantId: PhoneId,
  values: z.record(
    z.string(),
    z.union([z.number(), z.string(), z.boolean(), z.null()]),
  ),
  phoneCreatedAt: z.iso.datetime({ offset: true }),
});

/** Validates the JSON body with `schema` (400 if it doesn't match). */
const jsonBody = <S extends z.ZodType>(schema: S) =>
  validator("json", (value): z.infer<S> => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new HTTPException(400, { message: z.prettifyError(result.error) });
    }
    return result.data;
  });

const idParam = validator("param", (value: Record<string, string>) => {
  const id = PhoneId.safeParse(value["id"]);
  if (!id.success) throw new HTTPException(400, { message: "bad id" });
  return { id: id.data };
});

/** created → 201, repeat → 200; a refusal says why. */
function reply(c: Context, result: Recorded) {
  if (result.ok) {
    return c.json(
      { status: result.status },
      result.status === "created" ? 201 : 200,
    );
  }
  return c.json(
    { error: result.message },
    result.reason === "invalid" ? 400 : 409,
  );
}

/**
 * The Collator API (issue #40). Judges need no account (ADR-0023); what they send is keyed by ids their
 * phones made, so resending is always safe (ADR-0027 item 8).
 */
export function createApp({
  db,
  webRoot = null,
}: {
  db: Db;
  /** The built web app (judge page) to serve, or null in development, where Vite serves it. */
  webRoot?: string | null;
}) {
  const app = new Hono();

  app.get("/api/health", (c) => {
    const event = loadedEvent(db);
    return c.json({ ok: true, event: event?.manifest.event ?? null });
  });

  app.get("/api/event", (c) => {
    const event = loadedEvent(db);
    if (!event) {
      return c.json({ error: "no Event is loaded on this box yet" }, 409);
    }
    return c.json(judgeEvent(event.bundle));
  });

  app.get("/api/roster", (c) => c.json(roster(db)));

  app.put("/api/groups/:id", idParam, jsonBody(GroupBody), (c) =>
    reply(
      c,
      recordGroup(db, { id: c.req.valid("param").id, ...c.req.valid("json") }),
    ),
  );

  app.put("/api/teams/:id", idParam, jsonBody(TeamBody), (c) =>
    reply(
      c,
      recordTeam(db, { id: c.req.valid("param").id, ...c.req.valid("json") }),
    ),
  );

  app.put("/api/scores/:id", idParam, jsonBody(ScoreBody), (c) =>
    reply(
      c,
      recordScore(db, { id: c.req.valid("param").id, ...c.req.valid("json") }),
    ),
  );

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    console.error(error);
    return c.json({ error: "internal error" }, 500);
  });

  if (webRoot) {
    app
      .all("/api/*", (c) => c.json({ error: "not found" }, 404))
      .get("*", serveStatic({ root: webRoot }))
      // Any other path is one of the app's own routes: send the page and let it route.
      .get("*", serveStatic({ root: webRoot, path: "index.html" }));
  }
  return app;
}
