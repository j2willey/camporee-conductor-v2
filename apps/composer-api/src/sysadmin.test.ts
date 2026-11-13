import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { setSysadmin } from "./admin.ts";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog, users } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { setCurator } from "./library.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/**
 * Sysadmins (ADR-0032, #104 PR 1): the users list and its flags, suspension, and a sysadmin acting as an owner of
 * every Organization for the rollout.
 */

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as Record<string, unknown> & { id: string };

const ADMIN = "ada@example.com"; // sysadmin, in no Organization
const OWNER = "cora@example.com"; // owner of Coyote Creek
const OTHER = "olga@example.com"; // owner of Elsewhere

type UserRow = {
  id: string;
  email: string;
  curator: boolean;
  sysadmin: boolean;
  suspended: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  organizations: { id: string; name: string; role: string }[];
};

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let coyote: string;

async function call(
  who: string,
  method: string,
  path: string,
  { body, ifMatch }: { body?: unknown; ifMatch?: number } = {},
) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (ifMatch !== undefined) headers["if-match"] = String(ifMatch);
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

const idOf = (email: string) =>
  db.select().from(users).where(eq(users.email, email)).get()?.id ?? "";
const listUsers = async (who = ADMIN, q = "") =>
  call(who, "GET", `/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
const patch = (who: string, email: string, body: unknown) =>
  call(who, "PATCH", `/api/admin/users/${idOf(email)}`, { body });

beforeEach(async () => {
  db = testDb();
  clock = Date.parse("2026-11-12T10:00:00Z");
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date(clock),
  });
  coyote = (
    await call(OWNER, "POST", "/api/organizations", {
      body: { name: "Coyote Creek", slug: "coyote-creek" },
    })
  ).json["id"] as string;
  importEvent(db, coyote, bundle, new Date("2026-11-12T09:00:00Z"));
  await call(OTHER, "POST", "/api/organizations", {
    body: { name: "Elsewhere", slug: "elsewhere" },
  });
  await call(ADMIN, "GET", "/api/me");
  expect(setSysadmin(db, ADMIN, true)).toBe(true);
});

describe("GET /api/admin/users", () => {
  it("lists every user with their flags and Organizations, most recently seen first", async () => {
    clock += 60_000;
    await call(OTHER, "GET", "/api/me");
    // Listing is a request too: the sysadmin is seen at the same time as Olga, and ties go by email.
    const res = await listUsers();
    expect(res.status).toBe(200);
    const list = res.json as unknown as { users: UserRow[]; total: number };
    expect(list.total).toBe(3);
    expect(list.users.map((u) => u.email)).toEqual([ADMIN, OTHER, OWNER]);
    expect(list.users[0]?.lastSeenAt).toBe(clock);
    expect(list.users.find((u) => u.email === OWNER)).toMatchObject({
      curator: false,
      sysadmin: false,
      suspended: false,
      organizations: [{ id: coyote, name: "Coyote Creek", role: "owner" }],
    });
    expect(list.users.find((u) => u.email === ADMIN)).toMatchObject({
      sysadmin: true,
      organizations: [],
    });
  });

  it("searches by email", async () => {
    const res = await listUsers(ADMIN, "CORA");
    expect(
      (res.json as unknown as { users: UserRow[] }).users.map((u) => u.email),
    ).toEqual([OWNER]);
  });

  it("is not found for anyone but a sysadmin", async () => {
    expect((await listUsers(OWNER)).status).toBe(404);
    expect((await patch(OWNER, OTHER, { curator: true })).status).toBe(404);
  });
});

describe("PATCH /api/admin/users/:userId", () => {
  it("sets curator, sysadmin and suspended, and audits it site-wide", async () => {
    const res = await patch(ADMIN, OWNER, { curator: true, sysadmin: true });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      email: OWNER,
      curator: true,
      sysadmin: true,
      suspended: false,
    });
    const audit = db.select().from(auditLog).all().at(-1);
    expect(audit).toMatchObject({
      userId: idOf(ADMIN),
      organizationId: null,
      action: "user.update",
      detail: { userId: idOf(OWNER), curator: true, sysadmin: true },
    });
    expect((await patch(ADMIN, OWNER, { curator: false })).json).toMatchObject({
      curator: false,
      sysadmin: true,
    });
  });

  it("won't let a sysadmin remove their own flag or suspend themself", async () => {
    const own = await patch(ADMIN, ADMIN, { sysadmin: false });
    expect(own.status).toBe(400);
    expect(own.json["error"]).toBe("You can't remove your own sysadmin flag.");
    const suspend = await patch(ADMIN, ADMIN, { suspended: true });
    expect(suspend.status).toBe(400);
    expect(suspend.json["error"]).toBe("You can't suspend yourself.");
    // Making yourself a curator is fine.
    expect((await patch(ADMIN, ADMIN, { curator: true })).status).toBe(200);
  });

  it("is 404 for an unknown user, and 400 for an empty or unknown change", async () => {
    expect(
      (
        await call(ADMIN, "PATCH", "/api/admin/users/nobody", {
          body: { curator: true },
        })
      ).status,
    ).toBe(404);
    expect((await patch(ADMIN, OWNER, {})).status).toBe(400);
    expect((await patch(ADMIN, OWNER, { owner: true })).status).toBe(400);
  });
});

describe("a suspended user", () => {
  it("gets 403 on everything until unsuspended", async () => {
    expect((await patch(ADMIN, OWNER, { suspended: true })).status).toBe(200);
    for (const [method, path] of [
      ["GET", "/api/me"],
      ["GET", "/api/organizations"],
      ["GET", `/api/events/${EVENT.id}`],
    ] as const) {
      const res = await call(OWNER, method, path);
      expect(res.status).toBe(403);
      expect(res.json["error"]).toBe("Your account is suspended.");
    }
    expect((await patch(ADMIN, OWNER, { suspended: false })).status).toBe(200);
    expect((await call(OWNER, "GET", `/api/events/${EVENT.id}`)).status).toBe(
      200,
    );
  });
});

describe("a sysadmin, for the rollout (ADR-0032 item 2)", () => {
  it("says so in /api/me", async () => {
    expect((await call(ADMIN, "GET", "/api/me")).json).toMatchObject({
      sysadmin: true,
    });
    expect((await call(OWNER, "GET", "/api/me")).json).toMatchObject({
      sysadmin: false,
    });
  });

  it("acts as an owner of an Organization they aren't in", async () => {
    const read = await call(ADMIN, "GET", `/api/events/${EVENT.id}`);
    expect(read.status).toBe(200);
    expect(read.json["role"]).toBe("owner");
    const { event, updatedAt } = read.json as {
      event: Record<string, unknown>;
      updatedAt: number;
    };
    expect(
      (
        await call(ADMIN, "PUT", `/api/events/${EVENT.id}`, {
          body: { ...event, title: "Fixed by support" },
          ifMatch: updatedAt,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(ADMIN, "GET", `/api/organizations/${coyote}/members`)).status,
    ).toBe(200);
    // An Organization that doesn't exist is still not found.
    expect(
      (await call(ADMIN, "GET", "/api/organizations/nope/members")).status,
    ).toBe(404);
    expect((await call(ADMIN, "GET", "/api/events/nope")).status).toBe(404);
    // Others still can't.
    expect((await call(OTHER, "GET", `/api/events/${EVENT.id}`)).status).toBe(
      404,
    );
  });

  it("still needs to be a curator to change a library document", async () => {
    setCurator(db, OWNER, true);
    const templateId = (
      await call(OWNER, "POST", `/api/events/${EVENT.id}/save-as-template`, {
        body: {},
      })
    ).json["templateId"] as string;
    await call(OWNER, "POST", "/api/library/publish", {
      body: { id: templateId },
    });
    expect(
      (await call(ADMIN, "GET", `/api/events/${templateId}`)).json["role"],
    ).toBe("viewer");
    expect((await patch(ADMIN, ADMIN, { curator: true })).status).toBe(200);
    expect(
      (await call(ADMIN, "GET", `/api/events/${templateId}`)).json["role"],
    ).toBe("owner");
  });
});
