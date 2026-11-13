import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setSysadmin } from "./admin.ts";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog, documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/** Stats and the audit-log view (ADR-0032 notes, #104 PR 3): sysadmins only. */

const bundle = readEventBundle(CIRCUS_2026);
const CIRCUS = bundle.event as Record<string, unknown> & {
  id: string;
  title: string;
};

const ADMIN = "ada@example.com";
const OWNER = "cora@example.com";

type Entry = {
  id: number;
  at: number;
  userEmail: string | null;
  organization: { id: string; slug: string; name: string } | null;
  action: string;
  documentKind: string | null;
  documentId: string | null;
  documentTitle: string | null;
  detail: unknown;
};
type Audit = { entries: Entry[]; actions: string[]; next: number | null };

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let coyote: string;

async function call(who: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : null) as Record<string, unknown>,
  };
}

const at = (iso: string) => {
  clock = Date.parse(iso);
};
const createEvent = async (title: string) =>
  (await call(OWNER, "POST", `/api/organizations/${coyote}/events`, { title }))
    .json["eventId"] as string;
const stats = async (who = ADMIN) => call(who, "GET", "/api/admin/stats");
const audit = async (query = "", who = ADMIN) => {
  const res = await call(who, "GET", `/api/admin/audit${query}`);
  return { status: res.status, ...(res.json as unknown as Audit) };
};

beforeEach(async () => {
  db = testDb();
  at("2026-10-20T10:00:00Z");
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date(clock),
  });
  await call(ADMIN, "GET", "/api/me");
  setSysadmin(db, ADMIN, true);
  coyote = (
    await call(OWNER, "POST", "/api/organizations", {
      name: "Coyote Creek",
      slug: "coyote-creek",
    })
  ).json["id"] as string;
});

describe("GET /api/admin/stats", () => {
  it("counts users, Events, and Events created this month (UTC)", async () => {
    importEvent(db, coyote, bundle, new Date("2026-10-01T09:00:00Z"));
    const october = await createEvent("October Event");
    at("2026-10-31T23:59:59Z");
    await createEvent("Halloween Event");

    at("2026-11-01T00:00:00Z");
    await createEvent("November Event");
    // A Template isn't an Event.
    const template = await call(
      OWNER,
      "POST",
      `/api/events/${october}/save-as-template`,
      { title: "A Template", slug: "a-template" },
    );
    expect(template.status).toBe(201);
    at("2026-11-12T10:00:00Z");
    // Importing it again updates the Circus; it was still created in October.
    importEvent(db, coyote, bundle, new Date(clock));

    const res = await stats();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ users: 2, events: 4, eventsThisMonth: 1 });
  });

  it("a document keeps its created date when imported again", async () => {
    importEvent(db, coyote, bundle, new Date("2026-10-01T09:00:00Z"));
    importEvent(db, coyote, bundle, new Date("2026-11-05T09:00:00Z"));
    const row = db
      .select()
      .from(documents)
      .where(eq(documents.id, CIRCUS.id))
      .get();
    expect(row?.createdAt?.toISOString()).toBe("2026-10-01T09:00:00.000Z");
    expect(row?.updatedAt.toISOString()).toBe("2026-11-05T09:00:00.000Z");
  });

  it("is not found for anyone but a sysadmin", async () => {
    expect((await stats(OWNER)).status).toBe(404);
  });
});

describe("GET /api/admin/audit", () => {
  let event: string;

  beforeEach(async () => {
    event = await createEvent("Spring Event");
    at("2026-10-21T10:00:00Z");
    await call(OWNER, "POST", `/api/organizations/${coyote}/members`, {
      email: "vic@example.com",
      role: "viewer",
    });
    at("2026-10-22T10:00:00Z");
    const owner = (await call(ADMIN, "GET", "/api/admin/users?q=cora")).json[
      "users"
    ] as { id: string }[];
    await call(ADMIN, "PATCH", `/api/admin/users/${owner[0]?.id}`, {
      curator: true,
    });
  });

  it("lists the log newest first, with who, where, what and the document's title", async () => {
    const res = await audit();
    expect(res.status).toBe(200);
    expect(res.entries.map((e) => e.action)).toEqual([
      "user.update",
      "member.invite",
      "event.create",
    ]);
    expect(res.entries[0]).toMatchObject({
      userEmail: ADMIN,
      organization: null,
      documentTitle: null,
      at: Date.parse("2026-10-22T10:00:00Z"),
      detail: { curator: true },
    });
    expect(res.entries[2]).toMatchObject({
      userEmail: OWNER,
      organization: { id: coyote, slug: "coyote-creek", name: "Coyote Creek" },
      documentKind: "event",
      documentId: event,
      documentTitle: "Spring Event",
    });
    expect(res.actions).toEqual([
      "event.create",
      "member.invite",
      "user.update",
    ]);
    expect(res.next).toBeNull();
  });

  it("filters by a user's email (any case) and by action", async () => {
    expect(
      (await audit("?user=CORA%40example.com")).entries.map((e) => e.action),
    ).toEqual(["member.invite", "event.create"]);
    expect(
      (await audit("?action=user.update")).entries.map((e) => e.userEmail),
    ).toEqual([ADMIN]);
    expect(
      (await audit(`?user=${OWNER}&action=event.create`)).entries,
    ).toHaveLength(1);
    expect((await audit("?user=nobody%40example.com")).entries).toEqual([]);
  });

  it("shows a CLI action with no user", async () => {
    db.insert(auditLog)
      .values({ at: new Date(clock), userId: null, action: "cli.thing" })
      .run();
    expect((await audit()).entries[0]).toMatchObject({
      action: "cli.thing",
      userEmail: null,
    });
  });

  it("pages 50 at a time with `before`", async () => {
    db.insert(auditLog)
      .values(
        Array.from({ length: 60 }, (_, i) => ({
          at: new Date(clock + i),
          userId: null,
          action: "cli.thing",
        })),
      )
      .run();
    const first = await audit();
    expect(first.entries).toHaveLength(50);
    expect(first.next).toBe(first.entries.at(-1)?.id);
    const second = await audit(`?before=${first.next}`);
    expect(second.entries).toHaveLength(13);
    expect(second.entries[0]?.id).toBeLessThan(first.next ?? 0);
    expect(second.next).toBeNull();
    expect((await audit("?before=soon")).status).toBe(400);
  });

  it("is not found for anyone but a sysadmin", async () => {
    expect((await audit("", OWNER)).status).toBe(404);
  });
});
