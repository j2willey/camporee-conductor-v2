import { randomUUID } from "node:crypto";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  CartridgeError,
  CartridgeProfileSchema,
  exportCartridge,
} from "@camporee-conductor/cartridge";
import {
  buildActivityGuide,
  buildGuide,
  buildSuppliesList,
  renderActivityGuidesHtml,
  renderGuideHtml,
  renderSuppliesListHtml,
} from "@camporee-conductor/program-guide";
import { Slug, type Activity, type Event } from "@camporee-conductor/schema";
import { and, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import type { AuthAdapter, AuthUser } from "./auth/index.ts";
import { requireRole } from "./authz.ts";
import type { AuthConfig } from "./config.ts";
import type { Db } from "./db/open.ts";
import { saveDocument, type SavableKind } from "./documents/save.ts";
import { readEventDocuments } from "./export/read-event-documents.ts";
import { recordUser } from "./users.ts";
import {
  documents,
  memberships,
  organizations,
  ROLES,
  users,
} from "./db/schema.ts";

const NewOrganization = z.strictObject({
  name: z.string().trim().min(1),
  slug: Slug,
});

const NewMember = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(ROLES),
});

/** Validates the JSON body with `schema` (400 if it doesn't match); its type reaches the web client. */
const jsonBody = <S extends z.ZodType>(schema: S) =>
  validator("json", (value): z.infer<S> => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new HTTPException(400, { message: z.prettifyError(result.error) });
    }
    return result.data;
  });

/** Any JSON body (400 if it isn't JSON): a whole document, checked by `saveDocument` (ADR-0029). */
const anyJson = validator("json", (value): unknown => value);

/** Validates the query string: `ids` is a comma-separated list of Activity ids (400 if missing or empty). */
const activityIdsQuery = validator("query", (value) => {
  const result = z
    .object({
      twoSided: z
        .enum(["1", "true", "0", "false"])
        .optional()
        .transform((v) => v === "1" || v === "true"),
      perPage: z
        .enum(["1", "true", "0", "false"])
        .optional()
        .transform((v) => v === "1" || v === "true"),
      ids: z
        .string()
        .transform((ids) =>
          ids
            .split(",")
            .map((id) => id.trim())
            .filter((id) => id !== ""),
        )
        .pipe(
          z.array(z.string()).min(1, "ids must name at least one Activity."),
        ),
    })
    .safeParse(value);
  if (!result.success) {
    throw new HTTPException(400, { message: z.prettifyError(result.error) });
  }
  const out: { ids: string[]; twoSided?: "1"; perPage?: "1" } = {
    ids: result.data.ids,
  };
  if (result.data.twoSided) out.twoSided = "1";
  if (result.data.perPage) out.perPage = "1";
  return out;
});

/**
 * The Composer API (issue #4). `auth` is the swappable auth module (ADR-0014); `authConfig` tells the
 * web app which sign-in to show (never the secret key). `webRoot`, when given, is the built web app,
 * served from the same server so one image holds both (D5).
 */
export function createApp({
  db,
  auth,
  authConfig,
  webRoot = null,
  now = () => new Date(),
}: {
  db: Db;
  auth: AuthAdapter;
  authConfig: AuthConfig;
  webRoot?: string | null;
  /** The clock for saves (tests pass a fixed one). */
  now?: () => Date;
}) {
  const myOrganizations = (userId: string) =>
    db
      .select({
        id: organizations.id,
        slug: organizations.slug,
        name: organizations.name,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(eq(memberships.userId, userId))
      .orderBy(organizations.name)
      .all();

  /**
   * An Event the user can view, plus its Activities' ids, slugs and titles. 404 if there's no such
   * Event or the user isn't a member of its Organization (`requireRole`).
   */
  const readEvent = (eventId: string, userId: string) => {
    const row = db
      .select()
      .from(documents)
      .where(and(eq(documents.id, eventId), eq(documents.kind, "event")))
      .get();
    if (!row) throw new HTTPException(404, { message: "Not found." });
    requireRole(db, row.organizationId, userId, "viewer");
    // Validated on import (ADR-0012); stored exactly as given.
    const event = JSON.parse(row.json) as Event;
    const ids = new Set(event.activities.map((a) => a.activityId));
    const activities = db
      .select({
        id: documents.id,
        slug: documents.slug,
        title: documents.title,
      })
      .from(documents)
      .where(
        and(
          eq(documents.organizationId, row.organizationId),
          eq(documents.kind, "activity"),
        ),
      )
      .all()
      .filter((a) => ids.has(a.id));
    return { event, activities, updatedAt: row.updatedAt.getTime() };
  };

  /** One Activity document and its `updatedAt`, for editing (ADR-0029). 404 like `readEvent`. */
  const readActivity = (activityId: string, userId: string) => {
    const row = db
      .select()
      .from(documents)
      .where(and(eq(documents.id, activityId), eq(documents.kind, "activity")))
      .get();
    if (!row) throw new HTTPException(404, { message: "Not found." });
    requireRole(db, row.organizationId, userId, "viewer");
    return {
      activity: JSON.parse(row.json) as Activity,
      updatedAt: row.updatedAt.getTime(),
    };
  };

  /** PUT a whole document with If-Match (ADR-0029); the answer is its new `updatedAt`. */
  const save = (
    c: Context<{ Variables: { user: AuthUser } }>,
    kind: SavableKind,
    id: string,
    raw: unknown,
  ) =>
    c.json({
      updatedAt: saveDocument(db, {
        kind,
        id,
        raw,
        userId: c.var.user.userId,
        ifMatch: c.req.header("if-match"),
        now: now(),
      }),
    });

  /**
   * The Event and the full Activity documents for `ids`, in that order. 404 if any isn't an Activity of this Event
   * in its own Organization (readEvent filters by both), so no other Org's document is read.
   */
  const readPicked = (eventId: string, userId: string, ids: string[]) => {
    const { event, activities } = readEvent(eventId, userId);
    const inEvent = new Set(activities.map((a) => a.id));
    if (!ids.every((id) => inEvent.has(id))) {
      throw new HTTPException(404, { message: "Not found." });
    }
    const rows = db
      .select({ id: documents.id, json: documents.json })
      .from(documents)
      .where(and(inArray(documents.id, ids), eq(documents.kind, "activity")))
      .all();
    // Validated on import (ADR-0012); stored exactly as given.
    const byId = new Map(
      rows.map((row) => [row.id, JSON.parse(row.json) as Activity]),
    );
    const picked = ids.map((id) => {
      const activity = byId.get(id);
      if (!activity) throw new HTTPException(404, { message: "Not found." });
      return activity;
    });
    return { event, picked };
  };

  const api = new Hono<{ Variables: { user: AuthUser } }>()
    .use(async (c, next) => {
      const user = await auth.currentUser(c.req.raw);
      if (!user) throw new HTTPException(401, { message: "Sign in first." });
      // Second layer behind the provider's own verification: an unverified email is never stored, so
      // it can't be matched when an owner adds a member by email.
      if (!user.emailVerified) {
        throw new HTTPException(403, {
          message: "Verify your email address first.",
        });
      }
      // Record the user on first sight, so an owner can add them by email.
      recordUser(db, user, new Date());
      c.set("user", user);
      await next();
    })

    .get("/me", (c) => {
      const { userId, email } = c.var.user;
      return c.json({
        id: userId,
        email,
        organizations: myOrganizations(userId),
      });
    })

    .get("/organizations", (c) => c.json(myOrganizations(c.var.user.userId)))

    .post("/organizations", jsonBody(NewOrganization), (c) => {
      const { name, slug } = c.req.valid("json");
      const taken = db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .get();
      if (taken) {
        throw new HTTPException(409, { message: "That slug is taken." });
      }
      const id = randomUUID();
      db.transaction((tx) => {
        tx.insert(organizations)
          .values({ id, slug, name, createdAt: new Date() })
          .run();
        tx.insert(memberships)
          .values({
            organizationId: id,
            userId: c.var.user.userId,
            role: "owner",
          })
          .run();
      });
      return c.json({ id, slug, name, role: "owner" as const }, 201);
    })

    .post("/organizations/:orgId/members", jsonBody(NewMember), (c) => {
      const orgId = c.req.param("orgId");
      requireRole(db, orgId, c.var.user.userId, "owner");
      const { email, role } = c.req.valid("json");
      const user = db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .get();
      if (!user) {
        throw new HTTPException(404, {
          message: "No one with that email has signed in yet.",
        });
      }
      const status = db.transaction((tx) => {
        const current = tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, orgId),
              eq(memberships.userId, user.id),
            ),
          )
          .get();
        if (current?.role === "owner" && role !== "owner") {
          const owners = tx
            .select({ userId: memberships.userId })
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, orgId),
                eq(memberships.role, "owner"),
              ),
            )
            .all();
          if (owners.length === 1) {
            throw new HTTPException(409, {
              message: "An Organization needs at least one owner.",
            });
          }
        }
        tx.insert(memberships)
          .values({ organizationId: orgId, userId: user.id, role })
          .onConflictDoUpdate({
            target: [memberships.organizationId, memberships.userId],
            set: { role },
          })
          .run();
        return current ? 200 : 201;
      });
      return c.json({ userId: user.id, email, role }, status);
    })

    .get("/organizations/:orgId/events", (c) => {
      const orgId = c.req.param("orgId");
      requireRole(db, orgId, c.var.user.userId, "viewer");
      return c.json(
        db
          .select({
            id: documents.id,
            slug: documents.slug,
            title: documents.title,
            updatedAt: documents.updatedAt,
          })
          .from(documents)
          .where(
            and(
              eq(documents.organizationId, orgId),
              eq(documents.kind, "event"),
            ),
          )
          .orderBy(documents.title)
          .all(),
      );
    })

    .get("/events/:eventId", (c) =>
      c.json(readEvent(c.req.param("eventId"), c.var.user.userId)),
    )

    /** Saves the whole Event (ADR-0029): editors and owners, with If-Match. */
    .put("/events/:eventId", anyJson, (c) =>
      save(c, "event", c.req.param("eventId"), c.req.valid("json")),
    )

    .get("/activities/:activityId", (c) =>
      c.json(readActivity(c.req.param("activityId"), c.var.user.userId)),
    )

    /** Saves the whole Activity (ADR-0029): editors and owners, with If-Match. */
    .put("/activities/:activityId", anyJson, (c) =>
      save(c, "activity", c.req.param("activityId"), c.req.valid("json")),
    )

    /** The Event's Program Guide as one print-ready HTML page (issue #5). */
    .get("/events/:eventId/program-guide", (c) => {
      const { event, activities } = readEvent(
        c.req.param("eventId"),
        c.var.user.userId,
      );
      return c.html(renderGuideHtml(buildGuide(event, activities)));
    })

    /**
     * Activity guides (ADR-0028, issue #44): one print-ready HTML page with a guide for each Activity in
     * `ids` (comma-separated), in that order; `twoSided=1` starts each on a right-hand page. 400 without ids; 404 if any isn't an Activity of this Event.
     */
    .get("/events/:eventId/activity-guides", activityIdsQuery, (c) => {
      const { ids, twoSided } = c.req.valid("query");
      const { event, picked } = readPicked(
        c.req.param("eventId"),
        c.var.user.userId,
        ids,
      );
      return c.html(
        renderActivityGuidesHtml(
          event,
          picked.map((activity) => buildActivityGuide(event, activity)),
          { twoSided: twoSided === "1" },
        ),
      );
    })

    /** The supplies list for the Activities in `ids`, in that order (ADR-0028 item 10, #44). */
    .get("/events/:eventId/supplies-list", activityIdsQuery, (c) => {
      const { ids, perPage } = c.req.valid("query");
      const { event, picked } = readPicked(
        c.req.param("eventId"),
        c.var.user.userId,
        ids,
      );
      return c.html(
        renderSuppliesListHtml(buildSuppliesList(event, picked), {
          perPage: perPage === "1",
        }),
      );
    })

    /**
     * The Event's cartridge (issue #8). `design` (default) for any viewer; `event-day`, which holds the
     * Officials' emails (ADR-0027 item 5), for editors and owners only.
     */
    .get("/events/:eventId/cartridge", (c) => {
      const profile = CartridgeProfileSchema.safeParse(
        c.req.query("profile") ?? "design",
      );
      if (!profile.success) {
        throw new HTTPException(400, {
          message: 'profile must be "design" or "event-day".',
        });
      }
      const found = readEventDocuments(db, c.req.param("eventId"));
      if (!found) throw new HTTPException(404, { message: "Not found." });
      requireRole(
        db,
        found.organizationId,
        c.var.user.userId,
        profile.data === "event-day" ? "editor" : "viewer",
      );
      let zip: Uint8Array;
      try {
        zip = exportCartridge(found.bundle, profile.data, {
          exportedAt: new Date(),
        });
      } catch (error) {
        if (error instanceof CartridgeError) {
          throw new HTTPException(422, { message: error.issues.join("\n") });
        }
        throw error;
      }
      const slug = (found.bundle.event as { slug: string }).slug;
      return c.body(zip as Uint8Array<ArrayBuffer>, 200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${slug}-${profile.data}.zip"`,
      });
    });

  const notFound = (c: Context) => c.json({ error: "Not found." }, 404);
  const app = new Hono()
    .get("/health", (c) => c.json({ ok: true }))
    .get("/auth-config", (c) =>
      c.json(
        authConfig.adapter === "clerk"
          ? {
              adapter: "clerk" as const,
              publishableKey: authConfig.publishableKey,
            }
          : { adapter: "dev" as const },
      ),
    )
    .route("/api", api)
    .onError((error, c) => {
      if (error instanceof HTTPException) {
        return c.json({ error: error.message }, error.status);
      }
      // The details stay in the server log; the client gets a plain message, never a stack or DB error.
      console.error(`${c.req.method} ${c.req.path} failed:`, error);
      return c.json({ error: "Something went wrong." }, 500);
    })
    .notFound(notFound);
  if (webRoot) {
    // Added after the typed routes, so the web client's types stay the API's alone.
    app
      .all("/api/*", notFound)
      .get("*", serveStatic({ root: webRoot }))
      // Any other path is one of the app's own routes (React Router): send the page and let it route.
      .get("*", serveStatic({ root: webRoot, path: "index.html" }));
  }
  return app;
}

/** For the web app's typed client (PR B). */
export type AppType = ReturnType<typeof createApp>;
