import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

const EVENT_ID = (readEventBundle(CIRCUS_2026).event as { id: string }).id;

let db: Db;
let app: ReturnType<typeof createApp>;

/** A request as `who` (an email), or signed out when `who` is null. */
async function call(
  who: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (who) headers[DEV_USER_HEADER] = who;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

/** `owner` creates an Organization and returns its id. */
async function createOrg(owner: string, slug: string): Promise<string> {
  const { status, json } = await call(owner, "POST", "/api/organizations", {
    name: `Org ${slug}`,
    slug,
  });
  expect(status).toBe(201);
  return (json as { id: string }).id;
}

beforeEach(() => {
  db = testDb();
  app = createApp({ db, auth: devAuth(), authConfig: { adapter: "dev" } });
});

describe("signing in", () => {
  it("answers /health signed out", async () => {
    expect(await call(null, "GET", "/health")).toEqual({
      status: 200,
      json: { ok: true },
    });
  });

  it("tells the web app which sign-in to show, signed out", async () => {
    expect(await call(null, "GET", "/auth-config")).toEqual({
      status: 200,
      json: { adapter: "dev" },
    });
    const clerkApp = createApp({
      db,
      auth: devAuth(),
      authConfig: {
        adapter: "clerk",
        secretKey: "sk_secret",
        publishableKey: "pk_test_x",
      },
    });
    expect(await (await clerkApp.request("/auth-config")).json()).toEqual({
      adapter: "clerk",
      publishableKey: "pk_test_x",
    });
  });

  it("needs a signed-in user for the API", async () => {
    expect((await call(null, "GET", "/api/me")).status).toBe(401);
    expect((await call(null, "GET", "/api/organizations")).status).toBe(401);
  });

  it("records the user on first sight; /api/me lists no Organizations yet", async () => {
    expect(await call("ann@example.com", "GET", "/api/me")).toEqual({
      status: 200,
      json: {
        id: "dev|ann@example.com",
        email: "ann@example.com",
        organizations: [],
      },
    });
  });
});

describe("Organizations", () => {
  it("makes the creator its owner", async () => {
    const id = await createOrg("ann@example.com", "coyote-creek");
    expect(
      (await call("ann@example.com", "GET", "/api/organizations")).json,
    ).toEqual([
      { id, slug: "coyote-creek", name: "Org coyote-creek", role: "owner" },
    ]);
  });

  it("validates the name and slug, and refuses a slug that's taken", async () => {
    expect(
      (
        await call("ann@example.com", "POST", "/api/organizations", {
          name: " ",
          slug: "Bad Slug",
        })
      ).status,
    ).toBe(400);
    await createOrg("ann@example.com", "coyote-creek");
    expect(
      (
        await call("bob@example.com", "POST", "/api/organizations", {
          name: "Other",
          slug: "coyote-creek",
        })
      ).status,
    ).toBe(409);
  });

  it("lists only the caller's Organizations", async () => {
    await createOrg("ann@example.com", "coyote-creek");
    await createOrg("bob@example.com", "elsewhere");
    expect(
      (
        (await call("bob@example.com", "GET", "/api/organizations")).json as {
          slug: string;
        }[]
      ).map((o) => o.slug),
    ).toEqual(["elsewhere"]);
  });
});

describe("members", () => {
  let org: string;
  beforeEach(async () => {
    org = await createOrg("ann@example.com", "coyote-creek");
    await call("bob@example.com", "GET", "/api/me"); // Bob has signed in once
  });

  const addBob = (as: string, role: string) =>
    call(as, "POST", `/api/organizations/${org}/members`, {
      email: "bob@example.com",
      role,
    });

  it("lets the owner add a member who has signed in, with a role", async () => {
    expect(await addBob("ann@example.com", "editor")).toEqual({
      status: 201,
      json: {
        userId: "dev|bob@example.com",
        email: "bob@example.com",
        role: "editor",
      },
    });
    expect(
      (await call("bob@example.com", "GET", "/api/organizations")).json,
    ).toEqual([
      {
        id: org,
        slug: "coyote-creek",
        name: "Org coyote-creek",
        role: "editor",
      },
    ]);
  });

  it("changes the role of an existing member", async () => {
    await addBob("ann@example.com", "editor");
    expect((await addBob("ann@example.com", "viewer")).status).toBe(200);
    expect(
      (
        (await call("bob@example.com", "GET", "/api/me")).json as {
          organizations: { role: string }[];
        }
      ).organizations[0]?.role,
    ).toBe("viewer");
  });

  it("only lets an owner add members", async () => {
    await addBob("ann@example.com", "editor");
    const cy = await call(
      "bob@example.com",
      "POST",
      `/api/organizations/${org}/members`,
      {
        email: "ann@example.com",
        role: "viewer",
      },
    );
    expect(cy.status).toBe(403);
  });

  it("is 404 to someone who isn't a member", async () => {
    expect((await addBob("eve@example.com", "editor")).status).toBe(404);
  });

  it("can't add someone who hasn't signed in yet (no invitations in #4)", async () => {
    const res = await call(
      "ann@example.com",
      "POST",
      `/api/organizations/${org}/members`,
      {
        email: "new@example.com",
        role: "viewer",
      },
    );
    expect(res.status).toBe(404);
    expect(res.json).toEqual({
      error: "No one with that email has signed in yet.",
    });
  });

  it("won't demote the last owner", async () => {
    const res = await call(
      "ann@example.com",
      "POST",
      `/api/organizations/${org}/members`,
      {
        email: "ann@example.com",
        role: "editor",
      },
    );
    expect(res.status).toBe(409);
  });

  it("rejects an unknown role", async () => {
    expect((await addBob("ann@example.com", "admin")).status).toBe(400);
  });
});

describe("Events", () => {
  let org: string;
  beforeEach(async () => {
    org = await createOrg("ann@example.com", "coyote-creek");
    importEvent(db, org, readEventBundle(CIRCUS_2026));
    await call("bob@example.com", "GET", "/api/me");
    await call("ann@example.com", "POST", `/api/organizations/${org}/members`, {
      email: "bob@example.com",
      role: "viewer",
    });
  });

  it("lists the Organization's Events to a viewer", async () => {
    const res = await call(
      "bob@example.com",
      "GET",
      `/api/organizations/${org}/events`,
    );
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject([
      { id: EVENT_ID, slug: "coyote-creek-camporee-2026" },
    ]);
  });

  it("opens an Event read-only: the document plus its Activities' titles", async () => {
    const res = await call("bob@example.com", "GET", `/api/events/${EVENT_ID}`);
    expect(res.status).toBe(200);
    const { event, activities } = res.json as {
      event: { id: string; kind: string };
      activities: { id: string; slug: string; title: string }[];
    };
    expect(event).toMatchObject({ id: EVENT_ID, kind: "event" });
    expect(activities).toHaveLength(33);
    expect(Object.keys(activities[0] ?? {}).sort()).toEqual([
      "id",
      "slug",
      "title",
    ]);
  });

  it("is 404 to someone who isn't a member, for the list and the Event", async () => {
    await call("eve@example.com", "GET", "/api/me");
    expect(
      (await call("eve@example.com", "GET", `/api/organizations/${org}/events`))
        .status,
    ).toBe(404);
    expect(
      (await call("eve@example.com", "GET", `/api/events/${EVENT_ID}`)).status,
    ).toBe(404);
  });

  it("is 404 for an Event that doesn't exist, or an id that isn't an Event", async () => {
    expect(
      (
        await call(
          "ann@example.com",
          "GET",
          "/api/events/0196cfa2-4c00-7000-8000-00000000ffff",
        )
      ).status,
    ).toBe(404);
    const activityId = (
      readEventBundle(CIRCUS_2026).activities[0] as { id: string }
    ).id;
    expect(
      (await call("ann@example.com", "GET", `/api/events/${activityId}`))
        .status,
    ).toBe(404);
  });
});
