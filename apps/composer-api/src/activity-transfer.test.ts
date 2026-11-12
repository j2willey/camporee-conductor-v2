import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog, documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/** One Activity out as JSON, and in again as a new Activity with lineage (ADR-0031 rule 4, #100 PR 3). */

type ActivityDoc = {
  id: string;
  slug: string;
  title: string;
  scoring: { fields: { id: string }[] };
  lineage?: { parentId?: string };
  legacy?: unknown;
};
type EventDoc = {
  id: string;
  competitions: { id: string; slug: string }[];
  activities: { activityId: string; competitionId: string; sortOrder: number }[];
};

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = {
  ...(bundle.event as EventDoc),
  contacts: [
    {
      role: "Director",
      name: "Ann Example",
      email: "ann.director@example.com",
      phone: "555-0100",
    },
  ],
};
const OFFICIALS = {
  schemaVersion: "4.0",
  kind: "officials",
  id: "0196cfa2-4c00-7000-8000-000000000200",
  slug: "circus-officials",
  title: "Circus Officials",
  eventId: EVENT.id,
  officials: [{ email: "official.one@example.com", role: "director" }],
};
const CLOWN_CAR = (bundle.activities as ActivityDoc[]).find(
  (a) => a.slug === "clown-car",
) as ActivityDoc;
const competition = (slug: string) =>
  EVENT.competitions.find((c) => c.slug === slug)?.id ?? "";

const OWNER = "ann@example.com";
const VIEWER = "bob@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;

async function call(
  who: string,
  method: string,
  path: string,
  { body, ifMatch }: { body?: unknown; ifMatch?: number } = {},
) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (ifMatch !== undefined) headers["if-match"] = String(ifMatch);
  const response = await app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  return response;
}
const eventUpdatedAt = async () =>
  (
    (await (await call(OWNER, "GET", `/api/events/${EVENT.id}`)).json()) as {
      updatedAt: number;
    }
  ).updatedAt;
const stored = <T>(id: string) => {
  const row = db
    .select({ json: documents.json })
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  return row ? (JSON.parse(row.json) as T) : undefined;
};

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
  const org = ((await res.json()) as { id: string }).id;
  importEvent(
    db,
    org,
    { ...bundle, event: EVENT, officials: OFFICIALS },
    new Date(clock - 60_000),
  );
  await call(VIEWER, "GET", "/api/me");
  await call(OWNER, "POST", `/api/organizations/${org}/members`, {
    body: { email: VIEWER, role: "viewer" },
  });
  clock += 5_000;
});

describe("GET /api/activities/:id/export", () => {
  it("downloads the Activity as JSON for any member, with no personal data", async () => {
    const res = await call(VIEWER, "GET", `/api/activities/${CLOWN_CAR.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="clown-car.activity.json"',
    );
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(CLOWN_CAR);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("555-0100");
  });

  it("is 404 for someone outside the Organization", async () => {
    await call("eve@example.com", "GET", "/api/me");
    const res = await call(
      "eve@example.com",
      "GET",
      `/api/activities/${CLOWN_CAR.id}/export`,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/events/:id/activities/import", () => {
  const importInto = async (
    who: string,
    body: unknown,
    ifMatch?: number,
  ) => {
    const res = await call(
      who,
      "POST",
      `/api/events/${EVENT.id}/activities/import`,
      { body, ...(ifMatch !== undefined && { ifMatch }) },
    );
    const text = await res.text();
    return {
      status: res.status,
      json: (text ? JSON.parse(text) : null) as {
        activityId: string;
        updatedAt: number;
        error: string;
      },
    };
  };

  it("adds a copy as a new Activity, last in the Competition, naming its source", async () => {
    const at = await eventUpdatedAt();
    const res = await importInto(
      OWNER,
      { competitionId: competition("exhibition"), activity: CLOWN_CAR },
      at,
    );
    expect(res.status).toBe(201);
    const copy = stored<ActivityDoc>(res.json.activityId);
    expect(copy).toMatchObject({
      title: CLOWN_CAR.title,
      slug: "clown-car-2",
      lineage: { parentId: CLOWN_CAR.id },
    });
    expect(copy?.id).not.toBe(CLOWN_CAR.id);
    expect(copy?.legacy).toBeUndefined();
    const event = stored<EventDoc>(EVENT.id);
    const exhibition = event?.activities.filter(
      (a) => a.competitionId === competition("exhibition"),
    );
    expect(exhibition?.at(-1)?.activityId).toBe(res.json.activityId);
    expect(
      db
        .select()
        .from(auditLog)
        .all()
        .map((r) => r.action),
    ).toEqual(["activity.create", "event.update"]);
  });

  it("refuses an invalid Activity, naming the problem, and changes nothing", async () => {
    const at = await eventUpdatedAt();
    const res = await importInto(
      OWNER,
      {
        competitionId: competition("exhibition"),
        activity: { ...CLOWN_CAR, title: "" },
      },
      at,
    );
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("activity clown-car: title");
    expect(db.select().from(auditLog).all()).toHaveLength(0);
  });

  it("refuses an Activity holding a Common Field the Competition applies", async () => {
    const at = await eventUpdatedAt();
    const [first] = CLOWN_CAR.scoring.fields;
    const res = await importInto(
      OWNER,
      {
        competitionId: competition("patrol-games"),
        activity: {
          ...CLOWN_CAR,
          scoring: {
            ...CLOWN_CAR.scoring,
            fields: [...CLOWN_CAR.scoring.fields, { ...first, id: "p_flag" }],
          },
        },
      },
      at,
    );
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("p_flag is a Common Field of patrol-games");
  });

  it("refuses a viewer, a stale Event and an unknown Competition", async () => {
    const at = await eventUpdatedAt();
    const body = { competitionId: competition("exhibition"), activity: CLOWN_CAR };
    expect((await importInto(VIEWER, body, at)).status).toBe(403);
    expect((await importInto(OWNER, body, at - 1)).status).toBe(409);
    expect(
      (
        await importInto(
          OWNER,
          { ...body, competitionId: "0196cfa2-4c00-7000-8000-00000000ffff" },
          at,
        )
      ).status,
    ).toBe(400);
  });
});
