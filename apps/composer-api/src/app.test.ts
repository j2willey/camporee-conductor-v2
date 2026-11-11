import { eq, sql } from "drizzle-orm";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import {
  devAuth,
  DEV_EMAIL_VERIFIED_HEADER,
  DEV_USER_HEADER,
} from "./auth/dev.ts";
import type { AuthAdapter } from "./auth/index.ts";
import { memberships, users } from "./db/schema.ts";
import type { Db } from "./db/open.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { loadCartridge } from "@camporee-conductor/cartridge";
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

describe("unverified emails (second layer behind Clerk's own verification)", () => {
  const asUnverified = (
    who: string,
    method: string,
    path: string,
    body?: unknown,
  ) =>
    app.request(path, {
      method,
      headers: {
        [DEV_USER_HEADER]: who,
        [DEV_EMAIL_VERIFIED_HEADER]: "false",
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  it("refuses the API with 403 and doesn't store the user", async () => {
    const res = await asUnverified("mallory@example.com", "GET", "/api/me");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Verify your email address first.",
    });
    expect(db.select().from(users).all()).toEqual([]);
  });

  it("can't be added as a member, since it was never stored", async () => {
    const org = await createOrg("ann@example.com", "coyote-creek");
    await asUnverified("mallory@example.com", "GET", "/api/me");
    const res = await call(
      "ann@example.com",
      "POST",
      `/api/organizations/${org}/members`,
      {
        email: "mallory@example.com",
        role: "editor",
      },
    );
    expect(res.status).toBe(404);
  });

  it("doesn't let an unverified email take over a stored user's email", async () => {
    await call("ann@example.com", "GET", "/api/me");
    // Same user id, now presenting an unverified address.
    const res = await asUnverified(
      "ann@example.com",
      "GET",
      "/api/organizations",
    );
    expect(res.status).toBe(403);
    expect(db.select({ email: users.email }).from(users).all()).toEqual([
      { email: "ann@example.com" },
    ]);
  });
});

describe("an email that comes back under a new auth id (#32)", () => {
  // The dev adapter derives the id from the email, so these tests present the id explicitly, as Clerk
  // does when an account is recreated or an email moves between accounts.
  const asId = (userId: string, email: string, path = "/api/me") =>
    createApp({
      db,
      auth: idAuth(userId, email),
      authConfig: { adapter: "dev" },
    }).request(path);

  function idAuth(userId: string, email: string): AuthAdapter {
    return {
      currentUser: () =>
        Promise.resolve({ userId, email, emailVerified: true }),
    };
  }

  const membershipsOf = (userId: string) =>
    db
      .select({ org: memberships.organizationId, role: memberships.role })
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .orderBy(memberships.organizationId)
      .all();

  it("relinks the stored user to the new id and keeps their memberships", async () => {
    const org = await createOrg("ann@example.com", "coyote-creek");
    const [before] = db.select().from(users).all();

    const res = await asId("user_new", "ann@example.com");

    expect(res.status).toBe(200);
    expect(db.select().from(users).all()).toEqual([
      {
        id: "user_new",
        email: "ann@example.com",
        createdAt: before?.createdAt,
      },
    ]);
    expect(membershipsOf("user_new")).toEqual([{ org, role: "owner" }]);
    expect(membershipsOf("dev|ann@example.com")).toEqual([]);
    expect(
      (
        (await res.json()) as { organizations: { slug: string }[] }
      ).organizations.map((o) => o.slug),
    ).toEqual(["coyote-creek"]);
  });

  it("merges into a new id that's already stored, keeping the higher role per Organization", async () => {
    const shared = await createOrg("ann@example.com", "shared");
    const annOnly = await createOrg("ann@example.com", "ann-only");
    const bobOnly = await createOrg("bob@example.com", "bob-only");
    await call(
      "ann@example.com",
      "POST",
      `/api/organizations/${shared}/members`,
      {
        email: "bob@example.com",
        role: "viewer",
      },
    );

    // Bob's account now holds Ann's verified email.
    const res = await asId("dev|bob@example.com", "ann@example.com");

    expect(res.status).toBe(200);
    expect(
      db.select({ id: users.id, email: users.email }).from(users).all(),
    ).toEqual([{ id: "dev|bob@example.com", email: "ann@example.com" }]);
    expect(membershipsOf("dev|bob@example.com")).toEqual(
      [
        { org: shared, role: "owner" },
        { org: annOnly, role: "owner" },
        { org: bobOnly, role: "owner" },
      ].sort((a, b) => a.org.localeCompare(b.org)),
    );
  });
});

describe("the built web app (one image, issue #4 D5)", () => {
  let web: ReturnType<typeof createApp>;

  beforeEach(() => {
    const webRoot = mkdtempSync(join(tmpdir(), "composer-web-"));
    writeFileSync(
      join(webRoot, "index.html"),
      "<!doctype html><title>Composer</title>",
    );
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "assets", "app.js"), "console.log(1)");
    web = createApp({
      db,
      auth: devAuth(),
      authConfig: { adapter: "dev" },
      webRoot,
    });
  });

  it("serves the app's files", async () => {
    const res = await web.request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
  });

  it("serves index.html for the app's own routes, so a reload or shared link works", async () => {
    for (const path of ["/", "/organizations/x", "/events/y"]) {
      const res = await web.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("<title>Composer</title>");
    }
  });

  it("keeps a JSON 404 for an unknown API path, never the app's page", async () => {
    const res = await web.request("/api/nothing-here", {
      headers: { [DEV_USER_HEADER]: "ann@example.com" },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
  });

  it("still answers the API and /health", async () => {
    expect((await web.request("/health")).status).toBe(200);
    expect(
      (
        await web.request("/api/me", {
          headers: { [DEV_USER_HEADER]: "ann@example.com" },
        })
      ).status,
    ).toBe(200);
  });

  it("serves no page when there's no built app (development uses Vite)", async () => {
    expect((await app.request("/")).status).toBe(404);
  });
});

describe("unexpected errors", () => {
  it("returns a clean 500 JSON response, with no stack trace or database message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.run(sql`DROP TABLE memberships`);
    db.run(sql`DROP TABLE users`); // "no such table: users" must not reach the client

    const res = await call("ann@example.com", "GET", "/api/me");

    expect(res).toEqual({
      status: 500,
      json: { error: "Something went wrong." },
    });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
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

  describe("cartridge download (#8)", () => {
    const download = async (who: string, query = "") => {
      const response = await app.request(
        `/api/events/${EVENT_ID}/cartridge${query}`,
        { headers: { [DEV_USER_HEADER]: who } },
      );
      return {
        status: response.status,
        headers: response.headers,
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    };
    const withOfficials = () =>
      importEvent(db, org, {
        ...readEventBundle(CIRCUS_2026),
        officials: {
          schemaVersion: "4.0",
          kind: "officials",
          id: "0196cfa2-4c00-7000-8000-000000000200",
          slug: "coyote-creek-camporee-2026-officials",
          title: "Coyote Creek District Camporee 2026 Officials",
          eventId: EVENT_ID,
          officials: [{ email: "ann@example.com", role: "director" }],
        },
      });

    it("gives a viewer the design cartridge, by default, with no Officials", async () => {
      withOfficials();
      const res = await download("bob@example.com");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("content-disposition")).toBe(
        'attachment; filename="coyote-creek-camporee-2026-design.zip"',
      );
      const loaded = loadCartridge(res.bytes, { profile: "design" });
      expect(loaded.ok && loaded.bundle.activities).toHaveLength(33);
      expect(loaded.ok && loaded.bundle.officials).toBeUndefined();
    });

    it("gives the event-day cartridge only to an editor or owner: it holds Officials' emails", async () => {
      withOfficials();
      expect(
        (await download("bob@example.com", "?profile=event-day")).status,
      ).toBe(403);
      const res = await download("ann@example.com", "?profile=event-day");
      expect(res.status).toBe(200);
      const loaded = loadCartridge(res.bytes, { profile: "event-day" });
      expect(loaded.ok && loaded.bundle.officials?.officials).toEqual([
        { email: "ann@example.com", role: "director" },
      ]);
    });

    it("refuses an event-day cartridge without a Director, saying why", async () => {
      const response = await app.request(
        `/api/events/${EVENT_ID}/cartridge?profile=event-day`,
        { headers: { [DEV_USER_HEADER]: "ann@example.com" } },
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error:
          "officials: an event-day cartridge needs at least one Director, who signs in on the Collator (ADR-0027 item 5)",
      });
    });

    it("rejects an unknown profile, and is 404 to a non-member", async () => {
      expect(
        (await download("ann@example.com", "?profile=everything")).status,
      ).toBe(400);
      await call("eve@example.com", "GET", "/api/me");
      expect((await download("eve@example.com")).status).toBe(404);
    });
  });

  describe("Program Guide (#5)", () => {
    /** A GET as `who`, read as text: the guide is HTML, not JSON. */
    async function page(who: string, path: string) {
      const response = await app.request(path, {
        headers: { [DEV_USER_HEADER]: who },
      });
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        text: await response.text(),
      };
    }
    const guidePath = (id: string) => `/api/events/${id}/program-guide`;

    it("serves a viewer the Event's guide as one print-ready HTML page", async () => {
      const res = await page("bob@example.com", guidePath(EVENT_ID));
      expect(res.status).toBe(200);
      expect(res.contentType).toMatch(/^text\/html/);
      expect(res.text).toMatch(/^<!doctype html>/);
      expect(res.text).toContain(
        "<title>Coyote Creek District Camporee 2026: Program Guide</title>",
      );
      // From the imported design: Competition settings, Activity titles, the Award rule.
      expect(res.text).toContain(
        "The Patrol Games will be announced closer to the Camporee.",
      );
      expect(res.text).toContain("<li>The Human Fly</li>");
      expect(res.text).toContain(
        "Top Dog: the top 25% of Troops in the Troop Challenges standings.",
      );
      expect(res.text).toMatch(/class="draft">DRAFT<br>\d+ sections/);
    });

    it("is 404 to someone who isn't a member", async () => {
      await call("eve@example.com", "GET", "/api/me");
      expect((await page("eve@example.com", guidePath(EVENT_ID))).status).toBe(
        404,
      );
    });

    it("is 404 for an Event that doesn't exist, or an id that isn't an Event", async () => {
      const activityId = (
        readEventBundle(CIRCUS_2026).activities[0] as { id: string }
      ).id;
      for (const id of ["0196cfa2-4c00-7000-8000-00000000ffff", activityId]) {
        expect((await page("ann@example.com", guidePath(id))).status).toBe(404);
      }
    });

    it("needs a signed-in user", async () => {
      expect((await app.request(guidePath(EVENT_ID))).status).toBe(401);
    });
  });

  describe("Activity guides (#44)", () => {
    const activityIds = (
      readEventBundle(CIRCUS_2026).activities as { id: string; title: string }[]
    ).map((a) => a.id);
    const guidesPath = (ids: string, eventId = EVENT_ID) =>
      `/api/events/${eventId}/activity-guides${ids === "" ? "" : `?ids=${ids}`}`;
    const page = async (who: string | null, path: string) => {
      const response = await app.request(
        path,
        who ? { headers: { [DEV_USER_HEADER]: who } } : {},
      );
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        text: await response.text(),
      };
    };
    const titleOf = (id: string) =>
      (
        readEventBundle(CIRCUS_2026).activities as {
          id: string;
          title: string;
        }[]
      ).find((a) => a.id === id)?.title as string;

    it("serves a viewer one Activity's guide as a print-ready page", async () => {
      const id = activityIds[0] as string;
      const res = await page("bob@example.com", guidesPath(id));
      expect(res.status).toBe(200);
      expect(res.contentType).toMatch(/^text\/html/);
      expect(res.text).toMatch(/^<!doctype html>/);
      expect(res.text).toContain(`<h1>${titleOf(id)}</h1>`);
      expect(res.text).toContain("The Judge&#39;s playbook");
    });

    it("serves several guides in the order of ids", async () => {
      const [a, b] = [activityIds[3], activityIds[1]] as [string, string];
      const res = await page("bob@example.com", guidesPath(`${a},${b}`));
      expect(res.status).toBe(200);
      expect(res.text.match(/<article class="activity-guide"/g)).toHaveLength(
        2,
      );
      expect(res.text.indexOf(`id="guide-${a}"`)).toBeGreaterThan(-1);
      expect(res.text.indexOf(`id="guide-${a}"`)).toBeLessThan(
        res.text.indexOf(`id="guide-${b}"`),
      );
    });

    it("is 400 without ids", async () => {
      expect((await page("bob@example.com", guidesPath(""))).status).toBe(400);
      expect(
        (await page("bob@example.com", `${guidesPath("")}?ids=`)).status,
      ).toBe(400);
    });

    it("is 404 when an id isn't an Activity of this Event", async () => {
      const id = activityIds[0] as string;
      for (const bad of ["0196cfa2-4c00-7000-8000-00000000ffff", EVENT_ID]) {
        expect(
          (await page("bob@example.com", guidesPath(`${id},${bad}`))).status,
        ).toBe(404);
      }
    });

    it("is 404 to someone who isn't a member, 401 to nobody", async () => {
      const path = guidesPath(activityIds[0] as string);
      await call("eve@example.com", "GET", "/api/me");
      expect((await page("eve@example.com", path)).status).toBe(404);
      expect((await page(null, path)).status).toBe(401);
    });
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
