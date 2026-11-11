import type { CheckedBundle } from "@camporee-conductor/cartridge";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Official } from "@camporee-conductor/schema";
import type { OfficialAction } from "@camporee-conductor/scoring";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import type { BackupConfig } from "./config.ts";
import type { Db } from "./db/open.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { recordClosure } from "./closures.ts";
import {
  exhibitionResults,
  notExhibition,
  recordExhibitionResults,
} from "./exhibition-results.ts";
import { currentEpoch, epochsSince } from "./epoch.ts";
import { resetBox } from "./reset.ts";
import { judgeEvent } from "./judge-event.ts";
import { loadedEvent } from "./load-event.ts";
import { recordOfficialAction } from "./official-actions.ts";
import { normalEmail, officialByEmail } from "./officials.ts";
import { officialStandings } from "./standings.ts";
import { officialActivity, officialEvent } from "./official-view.ts";
import {
  recordGroup,
  recordScore,
  recordTeam,
  type Recorded,
} from "./roster-and-scores.ts";
import { officialRoster } from "./roster-view.ts";
import { recordRosterChange, resolvedRoster } from "./roster.ts";

const Name = z.string().trim().min(1).max(200);
/** An id a phone made (ADR-0027 item 8). Any opaque string; phones use UUIDs. */
const PhoneId = z.string().min(1).max(100);

const GroupBody = z.strictObject({ name: Name });
const TeamBody = z.strictObject({ groupId: PhoneId, name: Name });
const JudgeBody = z.strictObject({
  id: PhoneId,
  name: Name,
  email: z.string().trim().toLowerCase().pipe(z.email()),
  /** Optional free text (#41 PR 5); blank means none. */
  homeGroup: z.string().max(200).optional(),
});
const ScoreBody = z.strictObject({
  judge: JudgeBody,
  activityId: z.string().min(1),
  entrantId: PhoneId,
  values: z.record(
    z.string(),
    z.union([z.number(), z.string(), z.boolean(), z.null()]),
  ),
  phoneCreatedAt: z.iso.datetime({ offset: true }),
});

/** A Judge closing an Activity (#41 PR 6): every score id their phone saved there. */
const ClosureBody = z.strictObject({
  judge: JudgeBody,
  activityId: z.string().min(1),
  scoreIds: z.array(PhoneId).max(5000),
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

/** The Official's reason: optional, but not blank (spaces only is refused). */
const Notes = z.string().trim().min(1).max(500).optional();

/**
 * An Official's action (#42): a per-Activity `disqualify` (PR 2b), an Official's correction of a field (PR 3), a
 * `choose-entry` (which entry counts), `reassign-entry`, `finalize`, `unfinalize`, `set-final-rank` and `adjust-points` (PR 4), and the
 * overall `disqualify` (no activityId) and `set-overall-rank`. Other types come with later slices, and answer 400.
 */
const ActionBody = z.strictObject({
  action: z.discriminatedUnion(
    "type",
    [
      z.strictObject({
        type: z.literal("disqualify"),
        // Left out for an overall DQ (ADR-0019).
        activityId: z.string().min(1).optional(),
        entrantId: PhoneId,
        disqualified: z.boolean(),
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("set-field-value"),
        activityId: z.string().min(1),
        entrantId: PhoneId,
        entryId: PhoneId,
        fieldId: z.string().min(1),
        value: z.union([z.number(), z.string(), z.boolean(), z.null()]),
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("revert-field-value"),
        activityId: z.string().min(1),
        entrantId: PhoneId,
        entryId: PhoneId,
        fieldId: z.string().min(1),
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("choose-entry"),
        activityId: z.string().min(1),
        entrantId: PhoneId,
        entryId: PhoneId,
        newestEntryId: PhoneId,
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("finalize"),
        activityId: z.string().min(1),
        ranking: z.array(
          z.union([
            z.strictObject({
              entrantId: PhoneId,
              rank: z.number().int().positive(),
              points: z.number().finite(),
              disqualified: z.literal(false),
            }),
            z.strictObject({
              entrantId: PhoneId,
              disqualified: z.literal(true),
            }),
          ]),
        ),
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("reassign-entry"),
        activityId: z.string().min(1),
        entrantId: PhoneId,
        entryId: PhoneId,
        toEntrantId: PhoneId,
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("unfinalize"),
        activityId: z.string().min(1),
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("set-final-rank"),
        activityId: z.string().min(1),
        entrantId: PhoneId,
        rank: z.number().int().positive(),
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("set-overall-rank"),
        competitionId: z.string().min(1),
        entrantId: PhoneId,
        rank: z.number().int().positive(),
        notes: Notes,
      }),
      z.strictObject({
        type: z.literal("adjust-points"),
        activityId: z.string().min(1),
        entrantId: PhoneId,
        points: z.number().finite(),
        notes: Notes,
      }),
    ],
    {
      error:
        "Only a disqualify, set-field-value, revert-field-value, choose-entry, reassign-entry, finalize, unfinalize, set-final-rank, set-overall-rank or adjust-points action is accepted so far",
    },
  ),
  clientCreatedAt: z.iso.datetime({ offset: true }),
});

/** An Official's roster change (#42 PR 6): add, rename, merge or unmerge a Group or Team (ADR-0027). */
const RosterChangeBody = z.strictObject({
  change: z.discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("add-group"),
      groupId: PhoneId,
      name: Name,
    }),
    z.strictObject({
      type: z.literal("add-team"),
      teamId: PhoneId,
      groupId: PhoneId,
      name: Name,
    }),
    z.strictObject({
      type: z.literal("rename"),
      kind: z.enum(["group", "team"]),
      id: PhoneId,
      name: Name,
    }),
    z.strictObject({
      type: z.literal("merge"),
      kind: z.enum(["group", "team"]),
      id: PhoneId,
      intoId: PhoneId,
    }),
    z.strictObject({
      type: z.literal("unmerge"),
      kind: z.enum(["group", "team"]),
      id: PhoneId,
    }),
  ]),
  notes: Notes,
  clientCreatedAt: z.iso.datetime({ offset: true }),
});

/** An Official's whole results list for one Exhibition (#42 PR 7). Rules are checked in exhibition-results.ts. */
const ExhibitionSaveBody = z.strictObject({
  rows: z.array(
    z.strictObject({
      participantName: z.string(),
      group: z.string(),
      team: z.string(),
      place: z.string(),
      notes: z.string(),
    }),
  ),
  replacesId: PhoneId.nullable(),
  clientCreatedAt: z.iso.datetime({ offset: true }),
});

/** An Official resetting the box for a rehearsal; the typed name is checked in reset.ts. */
const ResetBody = z.strictObject({
  kind: z.enum(["scores", "full"]),
  confirm: z.string().max(500),
});

/** Named, so the refusal says why: placement points are #23, not parity. Runs before `ActionBody` is checked. */
const refusePlacementPoints: MiddlewareHandler = async (c, next) => {
  const body = (await c.req.json().catch(() => null)) as {
    action?: { type?: unknown };
  } | null;
  if (body?.action?.type === "set-placement-points") {
    throw new HTTPException(400, {
      message: "Event-day placement-points changes aren't supported (#23)",
    });
  }
  await next();
};

/** What `/api/official/me` answers: who's signed in on the Official page. */
export interface SignedInOfficial {
  email: string;
  name?: string;
  role: "director" | "official";
}

/**
 * The Official view's API (#40 PR 3). Every call is checked against the loaded Event's Officials list.
 */
function officialRoutes(db: Db, backup: BackupConfig | null) {
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
    const official = officialByEmail(db, event.bundle, email);
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
    const me: SignedInOfficial = {
      email: normalEmail(email),
      role,
      ...(name !== undefined && { name }),
    };
    return c.json(me);
  });

  routes.get("/event", (c) => c.json(officialEvent(db, c.get("bundle"))));

  routes.get("/standings", (c) =>
    c.json(officialStandings(db, c.get("bundle"))),
  );

  routes.get("/roster", (c) => c.json(officialRoster(db, c.get("bundle"))));

  routes.put(
    "/roster-changes/:id",
    idParam,
    jsonBody(RosterChangeBody),
    (c) => {
      const { change, notes, clientCreatedAt } = c.req.valid("json");
      return reply(
        c,
        recordRosterChange(db, {
          id: c.req.valid("param").id,
          officialEmail: normalEmail(c.get("official").email),
          change,
          notes,
          clientCreatedAt,
        }),
      );
    },
  );

  routes.get("/exhibitions/:activityId", (c) => {
    const bundle = c.get("bundle");
    const activityId = c.req.param("activityId");
    const found = exhibitionResults(db, bundle, activityId);
    if (!found) {
      return c.json({ error: "no such Activity in the loaded Event" }, 404);
    }
    const problem = notExhibition(bundle, activityId);
    return problem ? c.json({ error: problem }, 400) : c.json(found);
  });

  routes.put(
    "/exhibitions/:activityId/saves/:id",
    idParam,
    jsonBody(ExhibitionSaveBody),
    (c) => {
      const { rows, replacesId, clientCreatedAt } = c.req.valid("json");
      return reply(
        c,
        recordExhibitionResults(db, c.get("bundle"), {
          id: c.req.valid("param").id,
          officialEmail: normalEmail(c.get("official").email),
          activityId: c.req.param("activityId"),
          rows,
          replacesId,
          clientCreatedAt,
        }),
      );
    },
  );

  // Reset for rehearsals (ADR-0027): backs up first; any Official may (ADR-0019, no Director-only actions).
  routes.post("/reset", jsonBody(ResetBody), (c) => {
    const result = resetBox(db, backup, {
      ...c.req.valid("json"),
      officialEmail: normalEmail(c.get("official").email),
    });
    if (!result.ok) {
      return c.json(
        { error: result.message },
        result.reason === "invalid" ? 400 : 409,
      );
    }
    const { id, reason } = result.epoch;
    return c.json({ backup: result.backup, epoch: { id, reason } });
  });

  routes.get("/activities/:id", (c) => {
    const found = officialActivity(db, c.get("bundle"), c.req.param("id"));
    return found
      ? c.json(found)
      : c.json({ error: "no such Activity in the loaded Event" }, 404);
  });

  routes.put(
    "/actions/:id",
    idParam,
    refusePlacementPoints,
    jsonBody(ActionBody),
    (c) => {
      const { action: given, clientCreatedAt } = c.req.valid("json");
      // Left-out optional fields stay out of the logged action (an overall DQ has no activityId).
      const action = Object.fromEntries(
        Object.entries(given).filter(([, v]) => v !== undefined),
      ) as OfficialAction;
      return reply(
        c,
        recordOfficialAction(db, c.get("bundle"), {
          id: c.req.valid("param").id,
          officialEmail: normalEmail(c.get("official").email),
          action,
          clientCreatedAt,
        }),
      );
    },
  );

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
  backup = null,
}: {
  db: Db;
  /** The built web app (judge page) to serve, or null in development, where Vite serves it. */
  webRoot?: string | null;
  /** Where a reset takes its backup first (ADR-0027); null when no backup folder is set, which refuses resets. */
  backup?: BackupConfig | null;
}) {
  const app = new Hono();

  // Every API answer says which box epoch it came from (#66), so a phone notices a restore or reset on its next call.
  // Read after the handler, so the answer to a reset carries the new epoch.
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("x-box-epoch", currentEpoch(db).id);
  });

  app.get("/api/health", (c) => {
    const event = loadedEvent(db);
    return c.json({ ok: true, event: event?.manifest.event ?? null });
  });

  app.get("/api/event", (c) => {
    const event = loadedEvent(db);
    if (!event) {
      return c.json({ error: "no Event is loaded on this box yet" }, 409);
    }
    const { id, reason } = currentEpoch(db);
    return c.json({ ...judgeEvent(event.bundle), epoch: { id, reason } });
  });

  // What happened to the box since the epoch a phone knew (#66): the phone decides to resend or drop.
  app.get("/api/epochs", (c) => {
    const since = c.req.query("since");
    if (!since) {
      throw new HTTPException(400, { message: "since is required" });
    }
    const found = epochsSince(db, since);
    const brief = ({ id, reason }: { id: string; reason: string }) => ({
      id,
      reason,
    });
    return c.json({
      current: brief(currentEpoch(db)),
      since: Array.isArray(found) ? found.map(brief) : null,
      unknown: !Array.isArray(found),
    });
  });

  // Display names, with what an Official merged away left out; the resend path below keeps what phones sent.
  app.get("/api/roster", (c) => {
    const { groups, teams } = resolvedRoster(db);
    return c.json({ groups, teams });
  });

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

  app.put("/api/closures/:id", idParam, jsonBody(ClosureBody), (c) => {
    const result = recordClosure(db, {
      id: c.req.valid("param").id,
      ...c.req.valid("json"),
    });
    if (!result.ok) return reply(c, result);
    return c.json(
      { status: result.status, have: result.have, missing: result.missing },
      result.status === "created" ? 201 : 200,
    );
  });

  app.route("/api/official", officialRoutes(db, backup));

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
