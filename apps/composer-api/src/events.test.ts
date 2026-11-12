import { checkEventBundle } from "@camporee-conductor/cartridge";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog, documents } from "./db/schema.ts";
import { readEventDocuments } from "./export/read-event-documents.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/** New Event and Duplicate Event (ADR-0029, #100 PR 1). */

type EventDoc = {
  id: string;
  slug: string;
  title: string;
  terminology: unknown;
  presentation: { themeColors: Record<string, string> };
  competitions: { id: string; commonFields?: { setId: string } }[];
  activities: { activityId: string; competitionId: string }[];
  contacts?: unknown[];
  lineage?: { parentId?: string };
  legacy?: unknown;
};
type ActivityDoc = {
  id: string;
  slug: string;
  title: string;
  lineage?: { parentId?: string };
  legacy?: unknown;
};

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as EventDoc;

const OWNER = "ann@example.com";
const EDITOR = "ed@example.com";
const VIEWER = "bob@example.com";
const STRANGER = "eve@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let org: string;

type Reply = { error: string; eventId: string };

async function call(
  who: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Reply }> {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const storedDoc = <T>(id: string): T | undefined => {
  const row = db
    .select({ json: documents.json })
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  return row ? (JSON.parse(row.json) as T) : undefined;
};
const actions = () =>
  db
    .select()
    .from(auditLog)
    .all()
    .map((r) => r.action);
const create = (who: string, body: unknown, orgId = org) =>
  call(who, "POST", `/api/organizations/${orgId}/events`, body);
const duplicate = (who: string, body: unknown = {}) =>
  call(who, "POST", `/api/events/${EVENT.id}/duplicate`, body);

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
    name: "Coyote Creek",
    slug: "coyote-creek",
  });
  org = (res.json as unknown as { id: string }).id;
  for (const [who, role] of [
    [EDITOR, "editor"],
    [VIEWER, "viewer"],
  ] as const) {
    await call(who, "GET", "/api/me");
    await call(OWNER, "POST", `/api/organizations/${org}/members`, {
      email: who,
      role,
    });
  }
  await call(STRANGER, "GET", "/api/me");
});

describe("POST /api/organizations/:orgId/events", () => {
  it("makes a valid, empty Event for an editor, with the Scouting pack and default colors when it's the first", async () => {
    const res = await create(EDITOR, { title: "Coyote Creek 2027" });
    expect(res.status).toBe(201);
    const event = storedDoc<EventDoc>(res.json.eventId);
    expect(event).toMatchObject({
      kind: "event",
      title: "Coyote Creek 2027",
      slug: "coyote-creek-2027",
      competitions: [],
      activities: [],
      terminology: {
        pack: "scouting",
        labels: {
          group: "Troop",
          team: "Patrol",
          participant: "Scout",
          event: "Camporee",
        },
      },
      presentation: {
        themeColors: { main: "#0d6efd", header: "#34495e", accent: "#3498db" },
      },
    });
    const found = readEventDocuments(db, res.json.eventId);
    expect(found && checkEventBundle(found.bundle).ok).toBe(true);
    expect(actions()).toEqual(["event.create"]);
    const list = await call(VIEWER, "GET", `/api/organizations/${org}/events`);
    expect(
      (list.json as unknown as { title: string }[]).map((e) => e.title),
    ).toEqual(["Coyote Creek 2027"]);
  });

  it("copies the terminology of the Organization's newest Event", async () => {
    const terminology = {
      pack: "school",
      labels: { group: "School", team: "Team" },
    };
    importEvent(
      db,
      org,
      { ...bundle, event: { ...EVENT, terminology } },
      new Date(clock - 60_000),
    );
    const res = await create(OWNER, { title: "Spring Games" });
    expect(storedDoc<EventDoc>(res.json.eventId)?.terminology).toEqual(
      terminology,
    );
  });

  it("takes a given slug, and refuses one another Event has, naming it", async () => {
    importEvent(db, org, bundle, new Date(clock - 60_000));
    const res = await create(EDITOR, {
      title: "Again",
      slug: EVENT.slug,
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe(
      `${EVENT.title} already uses the slug ${EVENT.slug}. Choose another.`,
    );
    const own = await create(EDITOR, { title: "Again", slug: "again-2027" });
    expect(storedDoc<EventDoc>(own.json.eventId)?.slug).toBe("again-2027");
  });

  it("refuses a viewer, a stranger, a blank title and a malformed slug", async () => {
    expect((await create(VIEWER, { title: "X" })).status).toBe(403);
    expect((await create(STRANGER, { title: "X" })).status).toBe(404);
    expect((await create(EDITOR, { title: "  " })).status).toBe(400);
    expect((await create(EDITOR, { title: "X", slug: "Not A Slug" })).status).toBe(
      400,
    );
    expect(actions()).toEqual([]);
  });
});

describe("POST /api/events/:id/duplicate", () => {
  beforeEach(() => {
    const officials = {
      schemaVersion: "4.0",
      kind: "officials",
      id: "0196cfa2-4c00-7000-8000-000000000200",
      slug: "circus-officials",
      title: "Circus Officials",
      eventId: EVENT.id,
      officials: [{ email: "director@example.com", role: "director" }],
    };
    importEvent(db, org, { ...bundle, officials }, new Date(clock - 60_000));
  });

  it("copies the Event, its Activities and its Common Field set with new ids and lineage, but not its Officials", async () => {
    const res = await duplicate(EDITOR);
    expect(res.status).toBe(201);
    const copyId = res.json.eventId;
    expect(copyId).not.toBe(EVENT.id);
    const found = readEventDocuments(db, copyId);
    if (!found) throw new Error("no copy");
    expect(checkEventBundle(found.bundle).ok).toBe(true);
    expect(found.bundle.officials).toBeUndefined();

    const copy = found.bundle.event as EventDoc;
    expect(copy).toMatchObject({
      title: `${EVENT.title} (copy)`,
      slug: `${EVENT.slug}-copy`,
      lineage: { parentId: EVENT.id },
    });
    expect(copy.legacy).toBeUndefined();

    const sourceIds = new Set(EVENT.activities.map((a) => a.activityId));
    const copies = found.bundle.activities as ActivityDoc[];
    expect(copies).toHaveLength(EVENT.activities.length);
    for (const activity of copies) {
      expect(sourceIds.has(activity.id)).toBe(false);
      expect(sourceIds.has(activity.lineage?.parentId ?? "")).toBe(true);
      expect(activity.legacy).toBeUndefined();
    }
    const [set] = found.bundle.commonFieldSets as { id: string }[];
    const [sourceSet] = bundle.commonFieldSets as { id: string }[];
    expect(set?.id).not.toBe(sourceSet?.id);
    expect(copy.competitions[0]?.commonFields?.setId).toBe(set?.id);

    // The original is untouched.
    expect(storedDoc<EventDoc>(EVENT.id)).toEqual(EVENT);
    expect(actions().filter((a) => a === "activity.create")).toHaveLength(
      EVENT.activities.length,
    );
    expect(actions()).toContain("event.create");
    expect(actions()).toContain("common-field-set.create");
  });

  it("takes a title and slug, and numbers the default slug when taken", async () => {
    const named = await duplicate(OWNER, {
      title: "Coyote Creek 2027",
      slug: "coyote-creek-2027",
    });
    expect(storedDoc<EventDoc>(named.json.eventId)).toMatchObject({
      title: "Coyote Creek 2027",
      slug: "coyote-creek-2027",
    });
    await duplicate(OWNER);
    const third = await duplicate(OWNER);
    expect(storedDoc<EventDoc>(third.json.eventId)?.slug).toBe(
      `${EVENT.slug}-copy-2`,
    );
    expect((await duplicate(OWNER, { slug: "coyote-creek-2027" })).status).toBe(
      409,
    );
  });

  it("refuses a viewer and a stranger", async () => {
    expect((await duplicate(VIEWER)).status).toBe(403);
    expect((await duplicate(STRANGER)).status).toBe(404);
  });
});
