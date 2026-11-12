import { ActivitySchema, EventSchema } from "@camporee-conductor/schema";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog, documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/** Adding, duplicating and removing an Event's Activities (ADR-0029, #6 PR 2b). */

type Entry = {
  activityId: string;
  competitionId: string;
  sortOrder: number;
  enabled?: boolean;
};
type EventDoc = {
  id: string;
  slug: string;
  competitions: { id: string; slug: string }[];
  activities: Entry[];
};
type ActivityDoc = {
  id: string;
  slug: string;
  title: string;
  scoringType: string;
  content: Record<string, unknown>;
  scoring: { fields: { id: string; kind: string }[] };
  lineage?: { parentId?: string };
  legacy?: unknown;
};

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as EventDoc;
const competition = (slug: string) => {
  const found = EVENT.competitions.find((c) => c.slug === slug);
  if (!found) throw new Error(`no Competition ${slug}`);
  return found.id;
};
const GAMES = competition("patrol-games");
const EXHIBITION = competition("exhibition");
const activityBySlug = (slug: string) => {
  const found = (bundle.activities as ActivityDoc[]).find(
    (a) => a.slug === slug,
  );
  if (!found) throw new Error(`no Activity ${slug}`);
  return found;
};
const CLOWN_CAR = activityBySlug("clown-car");

const OWNER = "ann@example.com";
const EDITOR = "ed@example.com";
const VIEWER = "bob@example.com";
const STRANGER = "eve@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let org: string;

/** A JSON answer, cast through `unknown` by each test to what it expects. */
type Reply = {
  error: string;
  updatedAt: number;
  activityId: string;
  deleted: boolean;
};

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

async function readEvent() {
  const res = await call(OWNER, "GET", `/api/events/${EVENT.id}`);
  expect(res.status).toBe(200);
  return res.json as unknown as {
    event: EventDoc;
    updatedAt: number;
    role: string;
  };
}

const storedActivity = (id: string): ActivityDoc | undefined => {
  const row = db
    .select({ json: documents.json })
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  return row ? (JSON.parse(row.json) as ActivityDoc) : undefined;
};

/** The Activity ids of one Competition, in list order. */
const order = (event: EventDoc, competitionId: string) =>
  event.activities
    .filter((a) => a.competitionId === competitionId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => a.activityId);

const actions = () =>
  db
    .select()
    .from(auditLog)
    .all()
    .map((r) => `${r.action} ${r.documentId}`);

const add = (
  who: string,
  ifMatch: number | undefined,
  body: unknown = { competitionId: GAMES, title: "Tightrope Walk" },
) =>
  call(who, "POST", `/api/events/${EVENT.id}/activities`, {
    body,
    ...(ifMatch !== undefined && { ifMatch }),
  });

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
  clock += 5_000;
});

describe("reading an Event", () => {
  it("says the caller's role, so the list knows whether to offer changes", async () => {
    expect((await readEvent()).role).toBe("owner");
    const res = await call(VIEWER, "GET", `/api/events/${EVENT.id}`);
    expect((res.json as unknown as { role: string }).role).toBe("viewer");
  });
});

describe("adding an Activity", () => {
  it("creates a valid Activity with placeholder text and one points field, last in its Competition", async () => {
    const { updatedAt } = await readEvent();
    const res = await add(EDITOR, updatedAt);
    expect(res.status).toBe(201);
    expect(res.json.updatedAt).toBe(clock);

    const created = storedActivity(res.json.activityId);
    expect(created).toBeDefined();
    expect(ActivitySchema.safeParse(created).success).toBe(true);
    expect(created).toMatchObject({
      id: res.json.activityId,
      slug: "tightrope-walk",
      title: "Tightrope Walk",
      scoringType: "ranked",
      content: {
        story: "To be written.",
        objective: "To be written.",
        description: "To be written.",
        timeAndScoring: "To be written.",
        rules: [],
        supplies: [],
      },
    });
    expect(created?.scoring.fields).toEqual([
      expect.objectContaining({ id: "points", kind: "points", type: "number" }),
    ]);

    const { event } = await readEvent();
    expect(EventSchema.safeParse(event).success).toBe(true);
    expect(order(event, GAMES).at(-1)).toBe(res.json.activityId);
    expect(order(event, GAMES)).toHaveLength(order(EVENT, GAMES).length + 1);
  });

  it("takes its scoring type from its Competition's other Activities", async () => {
    const { updatedAt } = await readEvent();
    const res = await add(EDITOR, updatedAt, {
      competitionId: EXHIBITION,
      title: "Juggling",
    });
    expect(res.status).toBe(201);
    expect(storedActivity(res.json.activityId)?.scoringType).toBe("exhibition");
  });

  it("gives a slug that no other Activity in the Organization has", async () => {
    const { updatedAt } = await readEvent();
    const res = await add(EDITOR, updatedAt, {
      competitionId: GAMES,
      title: "Clown Car",
    });
    expect(res.status).toBe(201);
    expect(storedActivity(res.json.activityId)?.slug).toBe("clown-car-2");
  });

  it("writes an audit row for the new Activity and for the Event", async () => {
    const { updatedAt } = await readEvent();
    const res = await add(EDITOR, updatedAt);
    expect(actions()).toEqual([
      `activity.create ${res.json.activityId}`,
      `event.update ${EVENT.id}`,
    ]);
  });

  it("refuses a stale Event, a missing If-Match, a viewer and a non-member, and creates nothing", async () => {
    const { updatedAt } = await readEvent();
    expect((await add(EDITOR, updatedAt - 1)).status).toBe(409);
    expect((await add(EDITOR, undefined)).status).toBe(428);
    expect((await add(VIEWER, updatedAt)).status).toBe(403);
    expect((await add(STRANGER, updatedAt)).status).toBe(404);
    expect(
      db.select().from(documents).where(eq(documents.kind, "activity")).all(),
    ).toHaveLength(bundle.activities.length);
    expect(actions()).toEqual([]);
  });

  it("is 400 without a title or for a Competition the Event doesn't have", async () => {
    const { updatedAt } = await readEvent();
    expect(
      (await add(EDITOR, updatedAt, { competitionId: GAMES, title: " " }))
        .status,
    ).toBe(400);
    const res = await add(EDITOR, updatedAt, {
      competitionId: EVENT.id,
      title: "Lost",
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/Competition/);
  });
});

describe("duplicating an Activity", () => {
  const duplicate = (who: string, ifMatch: number, id = CLOWN_CAR.id) =>
    call(who, "POST", `/api/events/${EVENT.id}/activities/${id}/duplicate`, {
      ifMatch,
    });

  it("copies the Activity right after its source, with its parent in lineage and no v1 ids", async () => {
    const { updatedAt } = await readEvent();
    const res = await duplicate(EDITOR, updatedAt);
    expect(res.status).toBe(201);

    const copy = storedActivity(res.json.activityId);
    expect(ActivitySchema.safeParse(copy).success).toBe(true);
    expect(copy).toMatchObject({
      slug: "clown-car-copy",
      title: "Clown Car (copy)",
      content: CLOWN_CAR.content,
      scoring: CLOWN_CAR.scoring,
      lineage: { parentId: CLOWN_CAR.id },
    });
    expect(copy?.legacy).toBeUndefined();

    const { event } = await readEvent();
    expect(EventSchema.safeParse(event).success).toBe(true);
    const games = order(event, GAMES);
    expect(games[games.indexOf(CLOWN_CAR.id) + 1]).toBe(res.json.activityId);
    // Every other Activity keeps its place.
    expect(games.filter((id) => id !== res.json.activityId)).toEqual(
      order(EVENT, GAMES),
    );
    expect(actions()).toEqual([
      `activity.create ${res.json.activityId}`,
      `event.update ${EVENT.id}`,
    ]);
  });

  it("is 404 for an Activity the Event doesn't list, and refuses a viewer", async () => {
    const { updatedAt } = await readEvent();
    expect((await duplicate(EDITOR, updatedAt, EVENT.id)).status).toBe(404);
    expect((await duplicate(VIEWER, updatedAt)).status).toBe(403);
  });
});

describe("removing an Activity", () => {
  const remove = (who: string, ifMatch: number, id = CLOWN_CAR.id) =>
    call(who, "DELETE", `/api/events/${EVENT.id}/activities/${id}`, {
      ifMatch,
    });

  it("takes it off the Event and deletes the document no other Event lists", async () => {
    const { updatedAt } = await readEvent();
    const res = await remove(EDITOR, updatedAt);
    expect(res).toEqual({
      status: 200,
      json: { updatedAt: clock, deleted: true },
    });
    const { event } = await readEvent();
    expect(event.activities.map((a) => a.activityId)).not.toContain(
      CLOWN_CAR.id,
    );
    expect(storedActivity(CLOWN_CAR.id)).toBeUndefined();
    expect(actions()).toEqual([
      `activity.delete ${CLOWN_CAR.id}`,
      `event.update ${EVENT.id}`,
    ]);
  });

  it("keeps the document while another Event still lists it", async () => {
    const other = {
      ...structuredClone(EVENT),
      id: "01a18a1b-3000-7000-8000-000000000001",
      slug: "camporee-2027",
    };
    db.insert(documents)
      .values({
        id: other.id,
        kind: "event",
        organizationId: org,
        slug: other.slug,
        title: "Camporee 2027",
        json: JSON.stringify(other),
        updatedAt: new Date(clock),
      })
      .run();
    const { updatedAt } = await readEvent();
    const res = await remove(EDITOR, updatedAt);
    expect(res.json.deleted).toBe(false);
    expect(storedActivity(CLOWN_CAR.id)).toBeDefined();
    expect(actions()).toEqual([`event.update ${EVENT.id}`]);
  });

  it("refuses a stale Event and a viewer, and is 404 for an Activity the Event doesn't list", async () => {
    const { updatedAt } = await readEvent();
    expect((await remove(EDITOR, updatedAt - 1)).status).toBe(409);
    expect((await remove(VIEWER, updatedAt)).status).toBe(403);
    expect((await remove(EDITOR, updatedAt, EVENT.id)).status).toBe(404);
    expect(storedActivity(CLOWN_CAR.id)).toBeDefined();
    expect(actions()).toEqual([]);
  });
});
