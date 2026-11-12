import { strFromU8, unzipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, documentAudit, testDb } from "./test-support.ts";

/** The Event's Officials (ADR-0027 item 5, #100 PR 4): editors and owners only; no accounts. */

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as { id: string; slug: string; title: string };

const OWNER = "ann@example.com";
const EDITOR = "ed@example.com";
const VIEWER = "bob@example.com";

const DIRECTOR = {
  email: "director.person@example.com",
  name: "Dana Director",
  role: "director",
};
const HELPER = { email: "helper.person@example.com", role: "official" };

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;

type Doc = {
  id: string;
  kind: string;
  eventId: string;
  officials: { email: string; role: string }[];
};
type Read = { officials: Doc | null; updatedAt: number | null; role: string };

async function call(
  who: string,
  method: string,
  path: string,
  { body, ifMatch }: { body?: unknown; ifMatch?: number } = {},
) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (ifMatch !== undefined) headers["if-match"] = String(ifMatch);
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
const json = async <T>(response: Response) => (await response.json()) as T;
const read = (who = OWNER) =>
  call(who, "GET", `/api/events/${EVENT.id}/officials`);
const create = (who: string, officials: unknown[]) =>
  call(who, "POST", `/api/events/${EVENT.id}/officials`, {
    body: { officials },
  });
const save = (who: string, doc: unknown, ifMatch?: number) =>
  call(who, "PUT", `/api/officials/${(doc as Doc).id}`, {
    body: doc,
    ...(ifMatch !== undefined && { ifMatch }),
  });
const actions = () => documentAudit(db).map((r) => r.action);

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
  const org = (await json<{ id: string }>(res)).id;
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
});

describe("the Event's Officials", () => {
  it("starts with none, and a viewer can't see them", async () => {
    const res = await read(EDITOR);
    expect(res.status).toBe(200);
    expect(await json<Read>(res)).toEqual({
      officials: null,
      updatedAt: null,
      role: "editor",
    });
    expect((await read(VIEWER)).status).toBe(403);
  });

  it("creates the document for an editor, then saves it whole with If-Match", async () => {
    const created = await create(EDITOR, [DIRECTOR]);
    expect(created.status).toBe(201);
    const first = await json<Read>(await read());
    expect(first.officials).toMatchObject({
      kind: "officials",
      eventId: EVENT.id,
      slug: `${EVENT.slug}-officials`,
      officials: [DIRECTOR],
    });
    const doc = first.officials as Doc;
    clock += 1000;
    const saved = await save(
      EDITOR,
      { ...doc, officials: [DIRECTOR, HELPER] },
      first.updatedAt ?? 0,
    );
    expect(saved.status).toBe(200);
    expect((await json<Read>(await read())).officials?.officials).toEqual([
      DIRECTOR,
      HELPER,
    ]);
    expect(actions()).toEqual(["officials.create", "officials.update"]);
    // Once there's a document, it's saved, not created again.
    expect((await create(EDITOR, [HELPER])).status).toBe(409);
  });

  it("refuses a viewer, a stale save, a duplicate email and a move to another Event", async () => {
    await create(OWNER, [DIRECTOR]);
    const { officials, updatedAt } = await json<Read>(await read());
    const doc = officials as Doc;
    const at = updatedAt ?? 0;
    expect((await create(VIEWER, [HELPER])).status).toBe(403);
    expect((await save(VIEWER, doc, at)).status).toBe(403);
    expect((await save(EDITOR, doc, at - 1)).status).toBe(409);
    const dup = await save(
      EDITOR,
      { ...doc, officials: [DIRECTOR, { ...HELPER, email: DIRECTOR.email }] },
      at,
    );
    expect(dup.status).toBe(422);
    expect((await json<{ error: string }>(dup)).error).toContain(
      "duplicate email",
    );
    const moved = await save(
      EDITOR,
      { ...doc, eventId: "0196cfa2-4c00-7000-8000-00000000ffff" },
      at,
    );
    expect(moved.status).toBe(422);
    expect((await json<{ error: string }>(moved)).error).toContain(
      "eventId: Officials stay with their Event",
    );
  });

  it("puts Officials' emails only in the event-day cartridge (#100 acceptance)", async () => {
    await create(OWNER, [DIRECTOR, HELPER]);
    const files = async (profile: string) => {
      const res = await call(
        OWNER,
        "GET",
        `/api/events/${EVENT.id}/cartridge?profile=${profile}`,
      );
      expect(res.status).toBe(200);
      const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
      return Object.values(zip)
        .map((bytes) => strFromU8(bytes))
        .join("\n");
    };
    const design = await files("design");
    expect(design).not.toContain(DIRECTOR.email);
    expect(design).not.toContain(HELPER.email);
    const eventDay = await files("event-day");
    expect(eventDay).toContain(DIRECTOR.email);
    expect(eventDay).toContain(HELPER.email);
  });
});
