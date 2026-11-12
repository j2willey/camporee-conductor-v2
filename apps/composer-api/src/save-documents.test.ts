import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/** Saving documents (ADR-0029, #6 PR 1): whole-document PUT, If-Match, audit log. */

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as {
  id: string;
  title: string;
  activities: {
    activityId: string;
    competitionId: string;
    sortOrder: number;
  }[];
};
const ACTIVITY = bundle.activities[0] as {
  id: string;
  title: string;
  slug: string;
};

const OWNER = "ann@example.com";
const EDITOR = "ed@example.com";
const VIEWER = "bob@example.com";
const STRANGER = "eve@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let org: string;

/** A JSON answer: an error message, a save's updatedAt, or a document read (cast through `unknown`). */
type Reply = { error: string; updatedAt: number };

async function call(
  who: string | null,
  method: string,
  path: string,
  { body, ifMatch }: { body?: unknown; ifMatch?: string | number } = {},
): Promise<{ status: number; json: Reply }> {
  const headers: Record<string, string> = {};
  if (who) headers[DEV_USER_HEADER] = who;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (ifMatch !== undefined) headers["if-match"] = String(ifMatch);
  const response = await app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const clone = <T>(value: T): T => structuredClone(value);

async function readEvent(who = OWNER) {
  const res = await call(who, "GET", `/api/events/${EVENT.id}`);
  expect(res.status).toBe(200);
  return res.json as unknown as {
    event: typeof EVENT & Record<string, unknown>;
    updatedAt: number;
  };
}

async function readActivity(who = OWNER) {
  const res = await call(who, "GET", `/api/activities/${ACTIVITY.id}`);
  expect(res.status).toBe(200);
  return res.json as unknown as {
    activity: typeof ACTIVITY & Record<string, unknown>;
    updatedAt: number;
    role: string;
  };
}

const auditRows = () => db.select().from(auditLog).all();

beforeEach(async () => {
  db = testDb();
  clock = Date.parse("2026-11-12T10:00:00Z");
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date(clock),
  });
  const res = await call(OWNER, "POST", "/api/organizations", {
    body: { name: "Coyote Creek", slug: "coyote-creek" },
  });
  org = (res.json as unknown as { id: string }).id;
  importEvent(db, org, bundle, new Date(clock - 60_000));
  for (const [who, role] of [
    [EDITOR, "editor"],
    [VIEWER, "viewer"],
  ] as const) {
    await call(who, "GET", "/api/me");
    await call(OWNER, "POST", `/api/organizations/${org}/members`, {
      body: { email: who, role },
    });
  }
  await call(STRANGER, "GET", "/api/me");
});

describe("reading for editing", () => {
  it("gives the Event with its updatedAt", async () => {
    const { event, updatedAt } = await readEvent(VIEWER);
    expect(event.id).toBe(EVENT.id);
    expect(updatedAt).toBe(clock - 60_000);
  });

  it("gives one Activity document with its updatedAt and the caller's role, to a viewer", async () => {
    const { activity, updatedAt, role } = await readActivity(VIEWER);
    expect(activity).toEqual(ACTIVITY);
    expect(updatedAt).toBe(clock - 60_000);
    expect(role).toBe("viewer");
  });

  it("is 404 for an Activity to a non-member, or for an id that isn't an Activity", async () => {
    expect(
      (await call(STRANGER, "GET", `/api/activities/${ACTIVITY.id}`)).status,
    ).toBe(404);
    expect(
      (await call(OWNER, "GET", `/api/activities/${EVENT.id}`)).status,
    ).toBe(404);
  });
});

describe("saving an Event", () => {
  it("lets an editor save the whole document; the list and the stored JSON follow", async () => {
    const { event, updatedAt } = await readEvent(EDITOR);
    const changed = { ...clone(event), title: "Coyote Creek Camporee 2027" };
    clock += 5_000;
    const res = await call(EDITOR, "PUT", `/api/events/${EVENT.id}`, {
      body: changed,
      ifMatch: updatedAt,
    });
    expect(res).toEqual({ status: 200, json: { updatedAt: clock } });

    const after = await readEvent();
    expect(after.event).toEqual(changed);
    expect(after.updatedAt).toBe(clock);
    const list = await call(OWNER, "GET", `/api/organizations/${org}/events`);
    expect(list.json).toMatchObject([
      { id: EVENT.id, title: "Coyote Creek Camporee 2027" },
    ]);
  });

  it("stores the document exactly as sent, with no defaults added (ADR-0012)", async () => {
    const { event, updatedAt } = await readEvent();
    const sent = clone(event) as Record<string, unknown>;
    delete sent["tieNumbering"]; // has a schema default
    await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
      body: sent,
      ifMatch: updatedAt,
    });
    expect((await readEvent()).event).toEqual(sent);
  });

  it("refuses a stale save with 409 and keeps the newer document", async () => {
    const { event, updatedAt } = await readEvent();
    clock += 1_000;
    await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
      body: { ...clone(event), title: "First" },
      ifMatch: updatedAt,
    });
    clock += 1_000;
    const res = await call(EDITOR, "PUT", `/api/events/${EVENT.id}`, {
      body: { ...clone(event), title: "Second" },
      ifMatch: updatedAt,
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toMatch(/someone else saved/i);
    expect((await readEvent()).event.title).toBe("First");
  });

  it("needs If-Match (428), and accepts it quoted", async () => {
    const { event, updatedAt } = await readEvent();
    expect(
      (await call(OWNER, "PUT", `/api/events/${EVENT.id}`, { body: event }))
        .status,
    ).toBe(428);
    expect(
      (
        await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
          body: event,
          ifMatch: `"${updatedAt}"`,
        })
      ).status,
    ).toBe(200);
  });

  it("moves updatedAt forward even for two saves in the same millisecond", async () => {
    const { event, updatedAt } = await readEvent();
    clock = updatedAt; // the clock hasn't moved
    const first = await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
      body: event,
      ifMatch: updatedAt,
    });
    const second = await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
      body: event,
      ifMatch: first.json.updatedAt as number,
    });
    expect(first.json.updatedAt).toBe(updatedAt + 1);
    expect(second.json.updatedAt).toBe(updatedAt + 2);
  });

  it("refuses an invalid document with 422, naming each problem, and changes nothing", async () => {
    const { event, updatedAt } = await readEvent();
    const put = (body: unknown) =>
      call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
        body,
        ifMatch: updatedAt,
      });

    // The document itself: every schema problem, one line each.
    const badSchema = { ...clone(event), title: "", year: "2027" };
    const schema = await put(badSchema);
    expect(schema.status).toBe(422);
    expect(schema.json.error).toMatch(
      /^event coyote-creek-camporee-2026: title: /m,
    );
    expect(schema.json.error).toMatch(
      /^event coyote-creek-camporee-2026: year: /m,
    );

    // Against the Organization's documents: an Activity that isn't there.
    const missing = clone(event);
    missing.activities = [
      ...missing.activities,
      {
        competitionId: EVENT.activities[0]?.competitionId ?? "",
        activityId: "0196cfa2-4c00-7000-8000-00000000ffff",
        sortOrder: 999,
      },
    ];
    const bundle = await put(missing);
    expect(bundle.status).toBe(422);
    expect(bundle.json.error).toContain(
      "no Activity 0196cfa2-4c00-7000-8000-00000000ffff",
    );

    expect(await readEvent()).toEqual({
      event: EVENT,
      updatedAt,
      activities: expect.anything(),
      role: "owner",
    });
  });

  it("refuses a body whose id or kind doesn't match the path (400)", async () => {
    const { event, updatedAt } = await readEvent();
    const otherId = {
      ...clone(event),
      id: "0196cfa2-4c00-7000-8000-00000000ffff",
    };
    expect(
      (
        await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
          body: otherId,
          ifMatch: updatedAt,
        })
      ).status,
    ).toBe(400);
    const activity = (await readActivity()).activity;
    expect(
      (
        await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
          body: { ...activity, id: EVENT.id },
          ifMatch: updatedAt,
        })
      ).status,
    ).toBe(400);
  });

  it("is 403 to a viewer, 404 to a non-member or an unknown Event, 401 signed out", async () => {
    const { event, updatedAt } = await readEvent();
    const put = (who: string | null, id = EVENT.id) =>
      call(who, "PUT", `/api/events/${id}`, {
        body: event,
        ifMatch: updatedAt,
      });
    expect((await put(VIEWER)).status).toBe(403);
    expect((await put(STRANGER)).status).toBe(404);
    expect((await put(OWNER, ACTIVITY.id)).status).toBe(404);
    expect((await put(null)).status).toBe(401);
  });
});

describe("saving an Activity", () => {
  it("lets an editor save it; the guide's titles follow", async () => {
    const { activity, updatedAt } = await readActivity(EDITOR);
    const changed = { ...clone(activity), title: "Juggling Jamboree" };
    clock += 5_000;
    const res = await call(EDITOR, "PUT", `/api/activities/${ACTIVITY.id}`, {
      body: changed,
      ifMatch: updatedAt,
    });
    expect(res).toEqual({ status: 200, json: { updatedAt: clock } });
    expect((await readActivity()).activity).toEqual(changed);
    const { activities } = (await call(OWNER, "GET", `/api/events/${EVENT.id}`))
      .json as unknown as {
      activities: { id: string; title: string }[];
    };
    expect(activities.find((a) => a.id === ACTIVITY.id)?.title).toBe(
      "Juggling Jamboree",
    );
  });

  it("refuses a stale save (409), a missing If-Match (428) and an invalid document (422)", async () => {
    const { activity, updatedAt } = await readActivity();
    expect(
      (
        await call(OWNER, "PUT", `/api/activities/${ACTIVITY.id}`, {
          body: activity,
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await call(OWNER, "PUT", `/api/activities/${ACTIVITY.id}`, {
          body: activity,
          ifMatch: updatedAt - 1,
        })
      ).status,
    ).toBe(409);
    const res = await call(OWNER, "PUT", `/api/activities/${ACTIVITY.id}`, {
      body: { ...clone(activity), slug: "Not A Slug" },
      ifMatch: updatedAt,
    });
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("slug");
    expect((await readActivity()).activity).toEqual(ACTIVITY);
  });

  it("refuses an id that doesn't match the path (400), and is 403 to a viewer, 404 to a non-member", async () => {
    const { activity, updatedAt } = await readActivity();
    const put = (who: string, body: unknown) =>
      call(who, "PUT", `/api/activities/${ACTIVITY.id}`, {
        body,
        ifMatch: updatedAt,
      });
    expect(
      (
        await put(OWNER, {
          ...activity,
          id: "0196cfa2-4c00-7000-8000-00000000ffff",
        })
      ).status,
    ).toBe(400);
    expect((await put(VIEWER, activity)).status).toBe(403);
    expect((await put(STRANGER, activity)).status).toBe(404);
  });
});

describe("the audit log (ADR-0029 item 5)", () => {
  it("writes one row per save: when, who, Organization, action, document; no body", async () => {
    const { event, updatedAt } = await readEvent();
    clock += 1_000;
    await call(EDITOR, "PUT", `/api/events/${EVENT.id}`, {
      body: event,
      ifMatch: updatedAt,
    });
    const a = await readActivity();
    clock += 1_000;
    await call(OWNER, "PUT", `/api/activities/${ACTIVITY.id}`, {
      body: a.activity,
      ifMatch: a.updatedAt,
    });
    expect(auditRows().map((row) => ({ ...row, id: undefined }))).toEqual([
      {
        at: new Date(clock - 1_000),
        userId: `dev|${EDITOR}`,
        organizationId: org,
        action: "event.update",
        documentKind: "event",
        documentId: EVENT.id,
        detail: null,
      },
      {
        at: new Date(clock),
        userId: `dev|${OWNER}`,
        organizationId: org,
        action: "activity.update",
        documentKind: "activity",
        documentId: ACTIVITY.id,
        detail: null,
      },
    ]);
  });

  it("writes nothing for a refused save", async () => {
    const { event, updatedAt } = await readEvent();
    await call(VIEWER, "PUT", `/api/events/${EVENT.id}`, {
      body: event,
      ifMatch: updatedAt,
    });
    await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
      body: event,
      ifMatch: updatedAt - 1,
    });
    await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
      body: { ...event, title: "" },
      ifMatch: updatedAt,
    });
    expect(auditRows()).toEqual([]);
  });
});
