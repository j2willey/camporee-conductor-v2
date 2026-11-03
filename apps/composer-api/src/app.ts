import { randomUUID } from "node:crypto";
import { Slug, type Event } from "@camporee-conductor/schema";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { validator } from "hono/validator";
import { z } from "zod";
import type { AuthAdapter, AuthUser } from "./auth/index.ts";
import { requireRole } from "./authz.ts";
import type { AuthConfig } from "./config.ts";
import type { Db } from "./db/open.ts";
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

/**
 * The Composer API (issue #4). `auth` is the swappable auth module (ADR-0014); `authConfig` tells the
 * web app which sign-in to show (never the secret key).
 */
export function createApp({
  db,
  auth,
  authConfig,
}: {
  db: Db;
  auth: AuthAdapter;
  authConfig: AuthConfig;
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

  const api = new Hono<{ Variables: { user: AuthUser } }>()
    .use(async (c, next) => {
      const user = await auth.currentUser(c.req.raw);
      if (!user) throw new HTTPException(401, { message: "Sign in first." });
      // Record the user on first sight, so an owner can add them by email.
      db.insert(users)
        .values({ id: user.userId, email: user.email, createdAt: new Date() })
        .onConflictDoUpdate({ target: users.id, set: { email: user.email } })
        .run();
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

    .get("/events/:eventId", (c) => {
      const row = db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.id, c.req.param("eventId")),
            eq(documents.kind, "event"),
          ),
        )
        .get();
      if (!row) throw new HTTPException(404, { message: "Not found." });
      requireRole(db, row.organizationId, c.var.user.userId, "viewer");
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
      return c.json({ event, activities });
    });

  return new Hono()
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
      console.error(error);
      return c.json({ error: "Something went wrong." }, 500);
    });
}

/** For the web app's typed client (PR B). */
export type AppType = ReturnType<typeof createApp>;
