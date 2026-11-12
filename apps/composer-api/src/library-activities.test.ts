import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { setCurator } from "./library.ts";
import { CIRCUS_2026, documentAudit, testDb } from "./test-support.ts";

/** Activities to and from the library (ADR-0031 rule 5, #102 PR 3): forks with lineage, and normalized tags. */

type ActivityDoc = {
  id: string;
  slug: string;
  title: string;
  tags?: string[];
  lineage?: { parentId?: string };
  legacy?: unknown;
};
type EventDoc = {
  id: string;
  competitions: { id: string }[];
  activities: {
    activityId: string;
    competitionId: string;
    sortOrder: number;
  }[];
};

const bundle = readEventBundle(CIRCUS_2026);
const CIRCUS = bundle.event as EventDoc;
const CLOWN_CAR = (bundle.activities as ActivityDoc[]).find(
  (a) => a.slug === "clown-car",
) as ActivityDoc;
const COMPETITION_ID = "0196cfa2-4c00-7000-8000-0000000000c1";

const CURATOR = "cora@example.com"; // owner of Coyote Creek, curator
const VIEWER = "vic@example.com"; // viewer in Coyote Creek
const OUTSIDER = "olga@example.com"; // owner of Elsewhere

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let elsewhereEvent: string;

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

const row = (id: string) =>
  db.select().from(documents).where(eq(documents.id, id)).get();
const stored = <T>(id: string) => {
  const r = row(id);
  return r ? (JSON.parse(r.json) as T) : undefined;
};
const readEvent = async (who: string, id: string) =>
  (await call(who, "GET", `/api/events/${id}`)).json as {
    event: EventDoc;
    updatedAt: number;
  };

const saveToLibrary = (who: string, activityId: string) =>
  call(who, "POST", `/api/activities/${activityId}/save-to-library`);

async function addFromLibrary(
  who: string,
  eventId: string,
  activityId: string,
  competitionId = COMPETITION_ID,
) {
  const { updatedAt } = await readEvent(who, eventId);
  return call(who, "POST", `/api/events/${eventId}/activities/from-library`, {
    body: { competitionId, activityId },
    ifMatch: updatedAt,
  });
}

beforeEach(async () => {
  db = testDb();
  clock = Date.parse("2026-11-12T10:00:00Z");
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date((clock += 1000)),
  });
  const coyote = await call(CURATOR, "POST", "/api/organizations", {
    body: { name: "Coyote Creek", slug: "coyote-creek" },
  });
  const org = coyote.json["id"] as string;
  importEvent(db, org, bundle, new Date("2026-11-12T09:00:00Z"));
  await call(VIEWER, "GET", "/api/me");
  await call(CURATOR, "POST", `/api/organizations/${org}/members`, {
    body: { email: VIEWER, role: "viewer" },
  });
  setCurator(db, CURATOR, true);

  // Elsewhere: a new Event with one Competition.
  const other = await call(OUTSIDER, "POST", "/api/organizations", {
    body: { name: "Elsewhere", slug: "elsewhere" },
  });
  const created = await call(
    OUTSIDER,
    "POST",
    `/api/organizations/${other.json["id"] as string}/events`,
    { body: { title: "Spring Games" } },
  );
  elsewhereEvent = created.json["eventId"] as string;
  const { event, updatedAt } = await readEvent(OUTSIDER, elsewhereEvent);
  const saved = await call(OUTSIDER, "PUT", `/api/events/${elsewhereEvent}`, {
    body: {
      ...event,
      competitions: [
        {
          id: COMPETITION_ID,
          slug: "games",
          label: "Games",
          level: "team",
          registration: "registered",
          divisions: [],
        },
      ],
    },
    ifMatch: updatedAt,
  });
  expect(saved.status).toBe(200);
});

describe("POST /api/activities/:id/save-to-library", () => {
  it("forks the Activity as a saved, private Activity with lineage", async () => {
    const res = await saveToLibrary(CURATOR, CLOWN_CAR.id);
    expect(res.status).toBe(201);
    const id = res.json["activityId"] as string;
    expect(id).not.toBe(CLOWN_CAR.id);

    const copy = stored<ActivityDoc>(id);
    expect(copy).toMatchObject({
      id,
      title: CLOWN_CAR.title,
      slug: `${CLOWN_CAR.slug}-2`,
      lineage: { parentId: CLOWN_CAR.id },
    });
    expect(copy?.legacy).toBeUndefined();
    expect(row(id)?.visibility).toBe("private");
    // The Event still lists the original, and nothing lists the copy.
    const { event } = await readEvent(CURATOR, CIRCUS.id);
    expect(event.activities.map((a) => a.activityId)).toContain(CLOWN_CAR.id);
    expect(event.activities.map((a) => a.activityId)).not.toContain(id);
    // It's in the catalog, as the Organization's own.
    const catalog = (await call(CURATOR, "GET", "/api/library"))
      .json as unknown as {
      id: string;
      visibility: string;
    }[];
    expect(catalog).toEqual([
      expect.objectContaining({ id, visibility: "private" }),
    ]);

    expect(documentAudit(db).at(-1)).toMatchObject({
      action: "activity.create",
      documentId: id,
      detail: { parentId: CLOWN_CAR.id, change: "save-to-library" },
    });
  });

  it("normalizes the copy's tags", async () => {
    db.update(documents)
      .set({
        json: JSON.stringify({
          ...CLOWN_CAR,
          tags: [" Clowns ", "#Cars", "clowns"],
        }),
      })
      .where(eq(documents.id, CLOWN_CAR.id))
      .run();
    const res = await saveToLibrary(CURATOR, CLOWN_CAR.id);
    expect(stored<ActivityDoc>(res.json["activityId"] as string)?.tags).toEqual(
      ["clowns", "#cars"],
    );
  });

  it("needs an editor of the Activity's Organization", async () => {
    expect((await saveToLibrary(VIEWER, CLOWN_CAR.id)).status).toBe(403);
    expect((await saveToLibrary(OUTSIDER, CLOWN_CAR.id)).status).toBe(404);
    expect((await saveToLibrary(CURATOR, CIRCUS.id)).status).toBe(404);
  });

  it("can then be published by a curator", async () => {
    const id = (await saveToLibrary(CURATOR, CLOWN_CAR.id)).json[
      "activityId"
    ] as string;
    expect(
      (await call(CURATOR, "POST", "/api/library/publish", { body: { id } }))
        .status,
    ).toBe(200);
    const seen = (await call(OUTSIDER, "GET", "/api/library"))
      .json as unknown as {
      id: string;
    }[];
    expect(seen.map((i) => i.id)).toEqual([id]);
  });
});

describe("POST /api/events/:eventId/activities/from-library", () => {
  async function published() {
    const id = (await saveToLibrary(CURATOR, CLOWN_CAR.id)).json[
      "activityId"
    ] as string;
    await call(CURATOR, "POST", "/api/library/publish", { body: { id } });
    return id;
  }

  it("forks a library Activity into the Event's Competition, with lineage", async () => {
    const source = await published();
    const res = await addFromLibrary(OUTSIDER, elsewhereEvent, source);
    expect(res.status).toBe(201);
    const id = res.json["activityId"] as string;
    expect(id).not.toBe(source);

    const copy = row(id);
    expect(copy?.organizationId).not.toBe(row(source)?.organizationId);
    expect(copy?.visibility).toBe("private");
    expect(stored<ActivityDoc>(id)).toMatchObject({
      title: CLOWN_CAR.title,
      slug: stored<ActivityDoc>(source)?.slug, // "clown-car-2": the library copy's own slug
      lineage: { parentId: source },
    });
    const { event, updatedAt } = await readEvent(OUTSIDER, elsewhereEvent);
    expect(event.activities).toEqual([
      { activityId: id, competitionId: COMPETITION_ID, sortOrder: 1 },
    ]);
    expect(res.json["updatedAt"]).toBe(updatedAt);
    // The source is untouched.
    expect(row(source)?.visibility).toBe("library");
    expect(documentAudit(db).at(-2)).toMatchObject({
      action: "activity.create",
      documentId: id,
      detail: { parentId: source, change: "library" },
    });
  });

  it("adds the Organization's own saved Activity too", async () => {
    const saved = (await saveToLibrary(CURATOR, CLOWN_CAR.id)).json[
      "activityId"
    ] as string;
    const target = CIRCUS.competitions[0]?.id ?? "";
    const res = await addFromLibrary(CURATOR, CIRCUS.id, saved, target);
    expect(res.status).toBe(201);
    expect(
      stored<ActivityDoc>(res.json["activityId"] as string)?.lineage,
    ).toEqual({
      parentId: saved,
    });
  });

  it("is 404 for a private Activity of another Organization, or anything but an Activity", async () => {
    const saved = (await saveToLibrary(CURATOR, CLOWN_CAR.id)).json[
      "activityId"
    ] as string;
    expect((await addFromLibrary(OUTSIDER, elsewhereEvent, saved)).status).toBe(
      404,
    );
    expect(
      (await addFromLibrary(OUTSIDER, elsewhereEvent, CIRCUS.id)).status,
    ).toBe(404);
  });

  it("checks the Event like any Activity change", async () => {
    const source = await published();
    expect(
      (
        await addFromLibrary(
          OUTSIDER,
          elsewhereEvent,
          source,
          "no-such-competition",
        )
      ).status,
    ).toBe(400);
    const noIfMatch = await call(
      OUTSIDER,
      "POST",
      `/api/events/${elsewhereEvent}/activities/from-library`,
      { body: { competitionId: COMPETITION_ID, activityId: source } },
    );
    expect(noIfMatch.status).toBe(428);
    // A viewer of Coyote Creek can't add to its Event.
    expect(
      (
        await addFromLibrary(
          VIEWER,
          CIRCUS.id,
          source,
          CIRCUS.competitions[0]?.id,
        )
      ).status,
    ).toBe(403);
  });
});

describe("importing an Activity (#100 PR 3)", () => {
  it("normalizes its tags too", async () => {
    const { updatedAt } = await readEvent(OUTSIDER, elsewhereEvent);
    const res = await call(
      OUTSIDER,
      "POST",
      `/api/events/${elsewhereEvent}/activities/import`,
      {
        body: {
          competitionId: COMPETITION_ID,
          activity: { ...CLOWN_CAR, tags: ["Clowns", "clowns ", "#Cars"] },
        },
        ifMatch: updatedAt,
      },
    );
    expect(res.status).toBe(201);
    expect(stored<ActivityDoc>(res.json["activityId"] as string)?.tags).toEqual(
      ["clowns", "#cars"],
    );
  });
});
