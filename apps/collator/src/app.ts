import type { CheckedBundle } from "@camporee-conductor/cartridge";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Official } from "@camporee-conductor/schema";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import type { Db } from "./db/open.ts";
import { judgeEvent } from "./judge-event.ts";
import { loadedEvent } from "./load-event.ts";
import {
  normalEmail,
  officialActivity,
  officialByEmail,
  officialEvent,
} from "./official-view.ts";
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

/** The header the Official page sends its email in, on every call. */
export const OFFICIAL_EMAIL_HEADER = "x-official-email";

/**
 * The Official view's API (#40 PR 3). Every call is checked against the loaded Event's Officials list.
 * Read-only: edits, DQ, finalize and conflicts are #42.
 */
function officialRoutes(db: Db) {
  const routes = new Hono<{
    Variables: { official: Official; bundle: CheckedBundle };
  }>();

  // The Official gate (ADR-0027 item 5). This is an email-only gate, not authentication: it keeps casual
  // visitors out of the Official view; it doesn't stop someone who knows an Official's email. No passwords,
  // tokens or sessions: the page sends the email on every call and it's checked again here each time.
  routes.use(async (c, next) => {
    const event = loadedEvent(db);
    if (!event) {
      return c.json({ error: "no Event is loaded on this box yet" }, 409);
    }
    const email = c.req.header(OFFICIAL_EMAIL_HEADER)?.trim() ?? "";
    if (email === "") {
      return c.json({ error: "Sign in with an Official's email." }, 401);
    }
    const official = officialByEmail(event.bundle, email);
    if (!official) {
      return c.json(
        {
          error: `${normalEmail(email)} isn't on this Event's list of Officials.`,
        },
        403,
      );
    }
    c.set("official", official);
    c.set("bundle", event.bundle);
    await next();
  });

  routes.get("/me", (c) => {
    const { email, name, role } = c.get("official");
    return c.json({ email: normalEmail(email), name, role });
  });

  routes.get("/event", (c) => c.json(officialEvent(db, c.get("bundle"))));

  routes.get("/activities/:id", (c) => {
    const found = officialActivity(db, c.get("bundle"), c.req.param("id"));
    return found
      ? c.json(found)
      : c.json({ error: "no such Activity in the loaded Event" }, 404);
  });

  return routes;
}

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

  app.route("/api/official", officialRoutes(db));

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
