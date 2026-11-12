import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog, documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/** The Event's Common Field set: read, create and save (ADR-0020, ADR-0029, #99 PR 1). */

type Field = { id: string; label: string; [key: string]: unknown };
type SetDoc = { id: string; slug: string; title: string; fields: Field[] };
type CommonRef = { setId: string; before: string[]; after: string[] };
type EventDoc = {
  id: string;
  slug: string;
  title: string;
  competitions: { id: string; slug: string; commonFields?: CommonRef }[];
};

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as EventDoc;
const SET = bundle.commonFieldSets[0] as SetDoc;

const OWNER = "ann@example.com";
const EDITOR = "ed@example.com";
const VIEWER = "bob@example.com";
const STRANGER = "eve@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;

type Reply = { error: string; updatedAt: number; setId: string };

async function call(
  who: string,
  method: string,
  path: string,
  { body, ifMatch }: { body?: unknown; ifMatch?: number } = {},
): Promise<{ status: number; json: Reply }> {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
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

type Read = { set: SetDoc | null; updatedAt: number | null; role: string };
const readCommon = async (who = OWNER) => {
  const res = await call(who, "GET", `/api/events/${EVENT.id}/common-fields`);
  return { status: res.status, json: res.json as unknown as Read };
};
const readEvent = async () =>
  (await call(OWNER, "GET", `/api/events/${EVENT.id}`)).json as unknown as {
    event: EventDoc;
    updatedAt: number;
  };
const putSet = (who: string, set: unknown, ifMatch?: number) =>
  call(who, "PUT", `/api/common-field-sets/${SET.id}`, {
    body: set,
    ...(ifMatch !== undefined && { ifMatch }),
  });
const stored = (id: string) => {
  const row = db
    .select({ json: documents.json, slug: documents.slug })
    .from(documents)
    .where(eq(documents.id, id))
    .get();
  return row && { doc: JSON.parse(row.json) as unknown, slug: row.slug };
};
const actions = () =>
  db
    .select()
    .from(auditLog)
    .all()
    .map((r) => r.action);

/** The Event with no Competition using Common Fields, saved. */
async function dropCommonFields() {
  const { event, updatedAt } = await readEvent();
  const res = await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
    body: {
      ...event,
      competitions: event.competitions.map((c) => {
        const copy = { ...c };
        delete copy.commonFields;
        return copy;
      }),
    },
    ifMatch: updatedAt,
  });
  expect(res.status).toBe(200);
}

const SPIRIT: Field = {
  id: "spirit",
  label: "Spirit",
  type: "number",
  kind: "points",
  audience: "judge",
  sortOrder: 0,
  weight: 1,
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
  const org = (res.json as unknown as { id: string }).id;
  importEvent(db, org, bundle, new Date(clock - 60_000));
  for (const [who, role] of [
    [EDITOR, "editor"],
    [VIEWER, "viewer"],
  ] as const) {
    await call(who, "GET", "/api/me");
    const added = await call(
      OWNER,
      "POST",
      `/api/organizations/${org}/members`,
      { body: { email: who, role } },
    );
    expect(added.status).toBe(201);
  }
  await call(STRANGER, "GET", "/api/me");
});

describe("GET /api/events/:id/common-fields", () => {
  it("returns the set the Event's Competitions use, its updatedAt and the caller's role", async () => {
    const res = await readCommon(VIEWER);
    expect(res.status).toBe(200);
    expect(res.json.set?.id).toBe(SET.id);
    expect(res.json.set?.fields.map((f) => f.id)).toEqual(
      SET.fields.map((f) => f.id),
    );
    expect(res.json.updatedAt).toBe(clock - 60_000);
    expect(res.json.role).toBe("viewer");
  });

  it("returns no set when no Competition uses Common Fields", async () => {
    await dropCommonFields();
    expect((await readCommon()).json).toMatchObject({
      set: null,
      updatedAt: null,
    });
  });

  it("is 404 for someone outside the Organization", async () => {
    expect((await readCommon(STRANGER)).status).toBe(404);
  });
});

describe("PUT /api/common-field-sets/:id", () => {
  const relabeled = () => ({
    ...SET,
    fields: SET.fields.map((f) =>
      f.id === "p_yell" ? { ...f, label: "Patrol Cheer" } : f,
    ),
  });

  it("saves the whole set for an editor, with an audit row", async () => {
    const { json } = await readCommon(EDITOR);
    const res = await putSet(EDITOR, relabeled(), json.updatedAt ?? 0);
    expect(res.status).toBe(200);
    expect(res.json.updatedAt).toBe(clock);
    expect(stored(SET.id)?.doc).toEqual(relabeled());
    expect(actions()).toContain("common-field-set.update");
    expect((await readCommon()).json.updatedAt).toBe(clock);
  });

  it("refuses a viewer, a missing If-Match, a stale save and a body for another document", async () => {
    const at = clock - 60_000;
    expect((await putSet(VIEWER, relabeled(), at)).status).toBe(403);
    expect((await putSet(EDITOR, relabeled())).status).toBe(428);
    expect((await putSet(EDITOR, relabeled(), at - 1)).status).toBe(409);
    expect(
      (await putSet(EDITOR, { ...relabeled(), id: EVENT.id }, at)).status,
    ).toBe(400);
    expect(stored(SET.id)?.doc).toEqual(SET);
  });

  it("refuses to remove a field a Competition uses, naming it", async () => {
    const res = await putSet(
      EDITOR,
      { ...SET, fields: SET.fields.filter((f) => f.id !== "ten_ess") },
      clock - 60_000,
    );
    expect(res.status).toBe(422);
    expect(res.json.error).toContain(
      "competitions.0.commonFields.before.3: the Common Field set has no field ten_ess",
    );
  });

  it("refuses an invalid set: a Common Field can't be primary", async () => {
    const res = await putSet(
      EDITOR,
      {
        ...SET,
        fields: SET.fields.map((f, i) =>
          i === 0 ? { ...f, primary: { direction: "higher-wins" } } : f,
        ),
      },
      clock - 60_000,
    );
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("a Common Field can't be a primary");
  });
});

describe("POST /api/events/:id/common-fields", () => {
  const create = (
    who: string,
    ifMatch: number | undefined,
    fields = [SPIRIT],
  ) =>
    call(who, "POST", `/api/events/${EVENT.id}/common-fields`, {
      body: { fields },
      ...(ifMatch !== undefined && { ifMatch }),
    });

  it("creates the Event's set and links every Competition to it, with no fields picked yet", async () => {
    await dropCommonFields();
    const { updatedAt } = await readEvent();
    clock += 1000;
    const res = await create(EDITOR, updatedAt);
    expect(res.status).toBe(201);
    const { event } = await readEvent();
    expect(event.competitions.map((c) => c.commonFields)).toEqual(
      event.competitions.map(() => ({
        setId: res.json.setId,
        before: [],
        after: [],
      })),
    );
    expect(res.json.updatedAt).toBe((await readEvent()).updatedAt);
    const read = (await readCommon()).json;
    expect(read.set).toMatchObject({
      kind: "common-field-set",
      id: res.json.setId,
      title: `${EVENT.title} Common Fields`,
      fields: [SPIRIT],
    });
    // Named after the Event; a slug taken in the Organization would get -2, -3…
    expect(read.set?.slug).toBe(`${EVENT.slug}-common-fields`);
    expect(actions().slice(-2)).toEqual([
      "common-field-set.create",
      "event.update",
    ]);
  });

  it("refuses when the Event already has a set, and for a viewer or a stale Event", async () => {
    const { updatedAt } = await readEvent();
    expect((await create(EDITOR, updatedAt)).status).toBe(409);
    await dropCommonFields();
    const fresh = (await readEvent()).updatedAt;
    expect((await create(VIEWER, fresh)).status).toBe(403);
    expect((await create(EDITOR, fresh - 1)).status).toBe(409);
    expect((await create(EDITOR, undefined)).status).toBe(428);
  });

  it("refuses invalid fields and changes nothing", async () => {
    await dropCommonFields();
    const { updatedAt } = await readEvent();
    const before = actions().length;
    const res = await create(EDITOR, updatedAt, []);
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("must have at least one field");
    expect(actions()).toHaveLength(before);
    expect((await readCommon()).json.set).toBeNull();
  });
});
