import { unzipSync, strFromU8 } from "fflate";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { setCurator } from "./library.ts";
import { CIRCUS_2026, documentAudit, testDb } from "./test-support.ts";

/** Templates (ADR-0031 rules 4, 5 and item 7, #102 PR 4): save an Event as a Template, new Event from it, zip. */

type Doc = {
  id: string;
  kind: string;
  slug: string;
  title: string;
  contacts?: unknown;
  lineage?: { parentId?: string };
  legacy?: unknown;
  activities: { activityId: string; competitionId: string }[];
  competitions: { commonFields?: { setId: string } }[];
};

const bundle = readEventBundle(CIRCUS_2026);
const CONTACT_EMAIL = "pat.director@example.com";
const OFFICIAL_EMAIL = "official.one@example.com";
const EVENT = {
  ...(bundle.event as Doc),
  contacts: [
    { role: "Director", name: "Pat", email: CONTACT_EMAIL, phone: "555-0100" },
  ],
};
const ACTIVITY_IDS = (bundle.activities as { id: string }[]).map((a) => a.id);

const CURATOR = "cora@example.com"; // owner of Coyote Creek, curator
const VIEWER = "vic@example.com"; // viewer in Coyote Creek
const OUTSIDER = "olga@example.com"; // owner of Elsewhere

let db: Db;
let app: ReturnType<typeof createApp>;
let coyote: string;
let elsewhere: string;

async function call(who: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}
const json = async (res: Response) =>
  (await res.json()) as Record<string, unknown>;

const row = (id: string) =>
  db.select().from(documents).where(eq(documents.id, id)).get();
const doc = (id: string) => {
  const r = row(id);
  return r ? (JSON.parse(r.json) as Doc) : undefined;
};

const saveAsTemplate = (who: string, body: Record<string, unknown> = {}) =>
  call(who, "POST", `/api/events/${EVENT.id}/save-as-template`, body);
async function templateOf(): Promise<string> {
  const res = await saveAsTemplate(CURATOR);
  expect(res.status).toBe(201);
  return (await json(res))["templateId"] as string;
}
const newEvent = (who: string, templateId: string, body: unknown) =>
  call(who, "POST", `/api/templates/${templateId}/new-event`, body);

beforeEach(async () => {
  db = testDb();
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date("2026-11-12T10:00:00Z"),
  });
  coyote = (
    await json(
      await call(CURATOR, "POST", "/api/organizations", {
        name: "Coyote Creek",
        slug: "coyote-creek",
      }),
    )
  )["id"] as string;
  importEvent(
    db,
    coyote,
    { ...bundle, event: EVENT },
    new Date("2026-11-12T09:00:00Z"),
  );
  const officials = await call(
    CURATOR,
    "POST",
    `/api/events/${EVENT.id}/officials`,
    { officials: [{ email: OFFICIAL_EMAIL, role: "director" }] },
  );
  expect(officials.status).toBe(201);
  await call(VIEWER, "GET", "/api/me");
  await call(CURATOR, "POST", `/api/organizations/${coyote}/members`, {
    email: VIEWER,
    role: "viewer",
  });
  setCurator(db, CURATOR, true);
  elsewhere = (
    await json(
      await call(OUTSIDER, "POST", "/api/organizations", {
        name: "Elsewhere",
        slug: "elsewhere",
      }),
    )
  )["id"] as string;
});

describe("POST /api/events/:eventId/save-as-template", () => {
  it("forks the Event into a private Template with its own Activities and set, without personal data", async () => {
    const templateId = await templateOf();
    const r = row(templateId);
    expect(r).toMatchObject({
      kind: "template",
      organizationId: coyote,
      visibility: "private",
    });
    const template = doc(templateId);
    expect(template).toMatchObject({
      kind: "template",
      slug: EVENT.slug,
      title: EVENT.title,
      lineage: { parentId: EVENT.id },
    });
    expect(template).not.toHaveProperty("contacts");
    expect(template).not.toHaveProperty("legacy");

    // New Activities, each naming its source.
    const ids = template?.activities.map((a) => a.activityId) ?? [];
    expect(ids).toHaveLength(ACTIVITY_IDS.length);
    expect(ids.filter((id) => ACTIVITY_IDS.includes(id))).toEqual([]);
    expect(ids.map((id) => doc(id)?.lineage?.parentId).sort()).toEqual(
      [...ACTIVITY_IDS].sort(),
    );
    // Its own Common Field set.
    const setId = template?.competitions.find((c) => c.commonFields)
      ?.commonFields?.setId;
    const eventSetId = EVENT.competitions.find((c) => c.commonFields)
      ?.commonFields?.setId;
    expect(setId).toBeDefined();
    expect(setId).not.toBe(eventSetId);
    expect(row(setId ?? "")?.kind).toBe("common-field-set");

    // No Officials document came with it, and the Event is untouched.
    const officials = db
      .select({ json: documents.json })
      .from(documents)
      .where(eq(documents.kind, "officials"))
      .all();
    expect(officials).toHaveLength(1);
    expect(doc(EVENT.id)?.contacts).toEqual(EVENT.contacts);

    expect(documentAudit(db).at(-1)).toMatchObject({
      action: "template.create",
      documentId: templateId,
      detail: { parentId: EVENT.id },
    });
  });

  it("takes a title and a slug, and numbers the slug when another Template has it", async () => {
    const first = await templateOf();
    const second = await templateOf();
    expect(doc(second)?.slug).toBe(`${EVENT.slug}-2`);
    expect(doc(first)?.slug).toBe(EVENT.slug);
    const named = await saveAsTemplate(CURATOR, {
      title: "Circus Template",
      slug: "circus",
    });
    expect(named.status).toBe(201);
    const id = (await json(named))["templateId"] as string;
    expect(doc(id)).toMatchObject({ title: "Circus Template", slug: "circus" });
    expect((await saveAsTemplate(CURATOR, { slug: "circus" })).status).toBe(
      409,
    );
  });

  it("is in the catalog as the Organization's own Template; its Activities aren't listed alone", async () => {
    const templateId = await templateOf();
    const items = (await (
      await call(CURATOR, "GET", "/api/library")
    ).json()) as { id: string; kind: string }[];
    expect(items.map((i) => i.id)).toEqual([templateId]);
  });

  it("needs an editor of the Event's Organization", async () => {
    expect((await saveAsTemplate(VIEWER)).status).toBe(403);
    expect((await saveAsTemplate(OUTSIDER)).status).toBe(404);
  });
});

describe("POST /api/templates/:templateId/new-event", () => {
  it("forks a library Template into the caller's Organization, with lineage", async () => {
    const templateId = await templateOf();
    expect(
      (await newEvent(OUTSIDER, templateId, { organizationId: elsewhere }))
        .status,
    ).toBe(404);
    await call(CURATOR, "POST", "/api/library/publish", { id: templateId });

    const res = await newEvent(OUTSIDER, templateId, {
      organizationId: elsewhere,
      title: "Spring Camporee 2027",
    });
    expect(res.status).toBe(201);
    const eventId = (await json(res))["eventId"] as string;
    expect(row(eventId)).toMatchObject({
      kind: "event",
      organizationId: elsewhere,
      visibility: "private",
    });
    const event = doc(eventId);
    expect(event).toMatchObject({
      kind: "event",
      title: "Spring Camporee 2027",
      slug: EVENT.slug,
      lineage: { parentId: templateId },
    });
    const template = doc(templateId);
    expect(
      event?.activities.map((a) => doc(a.activityId)?.lineage?.parentId).sort(),
    ).toEqual(template?.activities.map((a) => a.activityId).sort());
    // A whole, valid Event: it reads and exports.
    expect((await call(OUTSIDER, "GET", `/api/events/${eventId}`)).status).toBe(
      200,
    );
    expect(
      (await call(OUTSIDER, "GET", `/api/events/${eventId}/cartridge`)).status,
    ).toBe(200);
  });

  it("forks the Organization's own private Template too, titled like the Template by default", async () => {
    const templateId = await templateOf();
    const res = await newEvent(CURATOR, templateId, { organizationId: coyote });
    expect(res.status).toBe(201);
    const eventId = (await json(res))["eventId"] as string;
    // The source Event has the Template's slug, so the new Event's is numbered.
    expect(doc(eventId)).toMatchObject({
      title: EVENT.title,
      slug: `${EVENT.slug}-2`,
    });
  });

  it("needs an editor of the target Organization", async () => {
    const templateId = await templateOf();
    await call(CURATOR, "POST", "/api/library/publish", { id: templateId });
    expect(
      (await newEvent(OUTSIDER, templateId, { organizationId: coyote })).status,
    ).toBe(404);
    expect(
      (await newEvent(VIEWER, templateId, { organizationId: coyote })).status,
    ).toBe(403);
  });

  it("is 404 for anything but a Template", async () => {
    expect(
      (await newEvent(CURATOR, EVENT.id, { organizationId: coyote })).status,
    ).toBe(404);
  });
});

describe("GET /api/templates/:templateId/cartridge", () => {
  it("is the Template's design cartridge, for anyone who can read it", async () => {
    const templateId = await templateOf();
    expect(
      (await call(OUTSIDER, "GET", `/api/templates/${templateId}/cartridge`))
        .status,
    ).toBe(404);
    const res = await call(
      CURATOR,
      "GET",
      `/api/templates/${templateId}/cartridge`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="${EVENT.slug}-template.zip"`,
    );
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const manifest = JSON.parse(
      strFromU8(files["manifest.json"] ?? new Uint8Array()),
    ) as {
      profile: string;
      event: { id: string };
    };
    expect(manifest).toMatchObject({
      profile: "design",
      event: { id: templateId },
    });
    expect(Object.keys(files)).not.toContain("officials.json");
  });
});

describe("#102 acceptance", () => {
  it("Circus 2026 goes in the library as a Template, and a new Event is made from it", async () => {
    const templateId = await templateOf();
    const published = await call(CURATOR, "POST", "/api/library/publish", {
      id: templateId,
    });
    expect(published.status).toBe(200);
    const catalog = (await (
      await call(OUTSIDER, "GET", "/api/library?kind=template")
    ).json()) as { id: string; visibility: string }[];
    expect(catalog).toEqual([
      expect.objectContaining({ id: templateId, visibility: "library" }),
    ]);
    const made = await newEvent(OUTSIDER, templateId, {
      organizationId: elsewhere,
    });
    expect(made.status).toBe(201);
  });

  it("no library document holds contact, Official or roster data", async () => {
    const templateId = await templateOf();
    await call(CURATOR, "POST", "/api/library/publish", { id: templateId });
    const library = db
      .select()
      .from(documents)
      .where(and(eq(documents.visibility, "library")))
      .all();
    expect(library.length).toBe(ACTIVITY_IDS.length + 2);
    for (const r of library) {
      expect(["template", "activity", "common-field-set"]).toContain(r.kind);
      const parsed = JSON.parse(r.json) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty("contacts");
      expect(parsed).not.toHaveProperty("officials");
      // The Event's contact and Official emails appear nowhere; the Composer holds no roster (ADR-0026).
      expect(r.json).not.toContain(CONTACT_EMAIL);
      expect(r.json).not.toContain(OFFICIAL_EMAIL);
    }
  });
});
