import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { setCurator } from "./library.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/**
 * Editing library documents (ADR-0031 item 6, #102 PR 5): one editor for Events, Templates and Activities. Curators
 * edit library documents; an Organization's editors edit its private ones.
 */

type Doc = Record<string, unknown> & {
  id: string;
  kind: string;
  slug: string;
  title: string;
  activities: { activityId: string; competitionId: string }[];
  competitions: {
    id: string;
    commonFields?: { setId: string; before: string[]; after: string[] };
  }[];
  scoring: { fields: { id: string }[] };
};

const bundle = readEventBundle(CIRCUS_2026);
const EVENT_ID = (bundle.event as Doc).id;

const CURATOR = "cora@example.com"; // owner of Coyote Creek, curator
const EDITOR = "eddie@example.com"; // editor in Coyote Creek, not a curator
const VIEWER = "vic@example.com"; // viewer in Coyote Creek
const OUTSIDER = "olga@example.com"; // owner of Elsewhere
const OTHER_CURATOR = "cal@example.com"; // curator, in no Organization

let db: Db;
let app: ReturnType<typeof createApp>;
let clock: number;
let coyote: string;
let templateId: string;

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
const stored = (id: string) => JSON.parse(row(id)?.json ?? "null") as Doc;

const readTemplate = async (who: string) =>
  (await call(who, "GET", `/api/events/${templateId}`)).json as {
    event: Doc;
    updatedAt: number;
    role: string;
    visibility: string;
  };

/** PUT the Template with `patch` applied, as `who`, with the If-Match they last read. */
async function saveTemplate(who: string, patch: Record<string, unknown>) {
  const { event, updatedAt } = await readTemplate(who);
  return call(who, "PUT", `/api/events/${templateId}`, {
    body: { ...event, ...patch },
    ifMatch: updatedAt,
  });
}

async function saveActivity(
  who: string,
  activityId: string,
  patch: Record<string, unknown>,
) {
  const read = (await call(who, "GET", `/api/activities/${activityId}`))
    .json as { activity: Doc; updatedAt: number };
  return call(who, "PUT", `/api/activities/${activityId}`, {
    body: { ...read.activity, ...patch },
    ifMatch: read.updatedAt,
  });
}

const publish = (id: string) =>
  call(CURATOR, "POST", "/api/library/publish", { body: { id } });

beforeEach(async () => {
  db = testDb();
  clock = Date.parse("2026-11-12T10:00:00Z");
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date((clock += 1000)),
  });
  coyote = (
    await call(CURATOR, "POST", "/api/organizations", {
      body: { name: "Coyote Creek", slug: "coyote-creek" },
    })
  ).json["id"] as string;
  importEvent(db, coyote, bundle, new Date("2026-11-12T09:00:00Z"));
  for (const [email, role] of [
    [EDITOR, "editor"],
    [VIEWER, "viewer"],
  ] as const) {
    await call(email, "GET", "/api/me");
    await call(CURATOR, "POST", `/api/organizations/${coyote}/members`, {
      body: { email, role },
    });
  }
  await call(OUTSIDER, "POST", "/api/organizations", {
    body: { name: "Elsewhere", slug: "elsewhere" },
  });
  await call(OTHER_CURATOR, "GET", "/api/me");
  setCurator(db, CURATOR, true);
  setCurator(db, OTHER_CURATOR, true);
  templateId = (
    await call(CURATOR, "POST", `/api/events/${EVENT_ID}/save-as-template`, {
      body: {},
    })
  ).json["templateId"] as string;
});

describe("a private Template", () => {
  it("opens in the Event editor for its Organization, with its role and visibility", async () => {
    const read = await readTemplate(EDITOR);
    expect(read).toMatchObject({
      event: { id: templateId, kind: "template" },
      kind: "template",
      role: "editor",
      visibility: "private",
    });
    expect((await readTemplate(VIEWER)).role).toBe("viewer");
    expect(
      (await call(OUTSIDER, "GET", `/api/events/${templateId}`)).status,
    ).toBe(404);
    expect(
      (await call(OTHER_CURATOR, "GET", `/api/events/${templateId}`)).status,
    ).toBe(404);
  });

  it("is saved by the Organization's editors, with the Template rules", async () => {
    const saved = await saveTemplate(EDITOR, { title: "Circus Template" });
    expect(saved.status).toBe(200);
    expect(stored(templateId)).toMatchObject({
      kind: "template",
      title: "Circus Template",
    });
    expect(row(templateId)?.title).toBe("Circus Template");

    // A Template never holds contacts (ADR-0031 rule 4).
    const contacts = await saveTemplate(EDITOR, {
      contacts: [{ role: "Director", name: "Pat" }],
    });
    expect(contacts.status).toBe(422);
    // Nor can a save turn it into an Event.
    expect((await saveTemplate(EDITOR, { kind: "event" })).status).toBe(400);

    expect((await saveTemplate(VIEWER, { title: "No" })).status).toBe(403);
  });

  it("takes Event changes: a new Activity, and its Common Fields read", async () => {
    const { event, updatedAt } = await readTemplate(EDITOR);
    const competitionId = event.competitions[0]?.id ?? "";
    const added = await call(
      EDITOR,
      "POST",
      `/api/events/${templateId}/activities`,
      { body: { competitionId, title: "Tightrope" }, ifMatch: updatedAt },
    );
    expect(added.status).toBe(201);
    const activityId = added.json["activityId"] as string;
    expect(row(activityId)).toMatchObject({
      organizationId: coyote,
      visibility: "private",
    });
    expect(
      (await readTemplate(EDITOR)).event.activities.map((a) => a.activityId),
    ).toContain(activityId);

    const common = await call(
      VIEWER,
      "GET",
      `/api/events/${templateId}/common-fields`,
    );
    expect(common.status).toBe(200);
    expect(common.json["set"]).toMatchObject({ kind: "common-field-set" });
    const sets = await call(
      VIEWER,
      "GET",
      `/api/events/${templateId}/common-field-sets`,
    );
    expect(sets.status).toBe(200);
  });

  it("has no Officials", async () => {
    expect(
      (
        await call(CURATOR, "POST", `/api/events/${templateId}/officials`, {
          body: { officials: [{ email: "x@example.com", role: "director" }] },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(CURATOR, "GET", `/api/events/${templateId}/officials`))
        .status,
    ).toBe(404);
  });
});

describe("a library Template", () => {
  beforeEach(async () => {
    expect((await publish(templateId)).status).toBe(200);
  });

  it("is edited by any curator, and read-only for everyone else", async () => {
    expect((await readTemplate(OTHER_CURATOR)).role).toBe("editor");
    expect((await readTemplate(CURATOR)).role).toBe("owner");
    expect((await readTemplate(EDITOR)).role).toBe("viewer");
    expect(await readTemplate(OUTSIDER)).toMatchObject({
      role: "viewer",
      visibility: "library",
    });

    expect(
      (await saveTemplate(OTHER_CURATOR, { title: "Big Top" })).status,
    ).toBe(200);
    expect(stored(templateId).title).toBe("Big Top");
    expect((await saveTemplate(EDITOR, { title: "No" })).status).toBe(403);
    expect((await saveTemplate(OUTSIDER, { title: "No" })).status).toBe(403);
  });

  it("keeps its parts in the library, and only curators edit them", async () => {
    const activityId = stored(templateId).activities[0]?.activityId ?? "";
    const read = await call(OUTSIDER, "GET", `/api/activities/${activityId}`);
    expect(read.json).toMatchObject({ role: "viewer", visibility: "library" });

    expect(
      (await saveActivity(OTHER_CURATOR, activityId, { title: "Lion Tamer" }))
        .status,
    ).toBe(200);
    expect(stored(activityId).title).toBe("Lion Tamer");
    expect(
      (await saveActivity(EDITOR, activityId, { title: "No" })).status,
    ).toBe(403);

    // An Activity a curator adds is in the library with the Template.
    const { event, updatedAt } = await readTemplate(OTHER_CURATOR);
    const added = await call(
      OTHER_CURATOR,
      "POST",
      `/api/events/${templateId}/activities`,
      {
        body: { competitionId: event.competitions[0]?.id, title: "Tightrope" },
        ifMatch: updatedAt,
      },
    );
    expect(added.status).toBe(201);
    const newId = added.json["activityId"] as string;
    expect(row(newId)).toMatchObject({
      organizationId: coyote,
      visibility: "library",
    });
    expect(
      (await call(OUTSIDER, "GET", `/api/activities/${newId}`)).status,
    ).toBe(200);
  });

  it("its Common Field set is edited by curators only", async () => {
    const common = (
      await call(
        OTHER_CURATOR,
        "GET",
        `/api/events/${templateId}/common-fields`,
      )
    ).json as { set: Doc; updatedAt: number; role: string };
    expect(common.role).toBe("editor");
    expect(
      (
        await call(
          OTHER_CURATOR,
          "PUT",
          `/api/common-field-sets/${common.set.id}`,
          {
            body: { ...common.set, title: "Big Top Common Fields" },
            ifMatch: common.updatedAt,
          },
        )
      ).status,
    ).toBe(200);
    const again = (
      await call(EDITOR, "GET", `/api/events/${templateId}/common-fields`)
    ).json as { set: Doc; updatedAt: number; role: string };
    expect(again.role).toBe("viewer");
    expect(
      (
        await call(EDITOR, "PUT", `/api/common-field-sets/${again.set.id}`, {
          body: again.set,
          ifMatch: again.updatedAt,
        })
      ).status,
    ).toBe(403);
  });

  it("a curator's unpublish hands it back to its Organization's editors", async () => {
    await call(CURATOR, "POST", "/api/library/unpublish", {
      body: { id: templateId },
    });
    expect((await readTemplate(EDITOR)).role).toBe("editor");
    expect((await saveTemplate(EDITOR, { title: "Ours" })).status).toBe(200);
    expect(
      (await call(OTHER_CURATOR, "GET", `/api/events/${templateId}`)).status,
    ).toBe(404);
  });
});

describe("saving an Activity a Template lists", () => {
  it("is checked against the Template too", async () => {
    const template = stored(templateId);
    const competition = template.competitions.find(
      (c) => (c.commonFields?.before.length ?? 0) > 0,
    );
    const commonId = competition?.commonFields?.before[0] ?? "";
    const activityId =
      template.activities.find((a) => a.competitionId === competition?.id)
        ?.activityId ?? "";
    expect(commonId).not.toBe("");
    expect(activityId).not.toBe("");
    const activity = stored(activityId);
    const [first, ...rest] = activity.scoring.fields;
    const res = await saveActivity(EDITOR, activityId, {
      scoring: {
        ...activity.scoring,
        fields: [{ ...first, id: commonId }, ...rest],
      },
    });
    expect(res.status).toBe(422);
    expect(String(res.json["error"])).toContain("is a Common Field");
  });
});

describe("a saved Activity on its own", () => {
  it("is read and saved outside any Event, with its visibility", async () => {
    const source = stored(EVENT_ID).activities[0]?.activityId ?? "";
    const saved = (
      await call(EDITOR, "POST", `/api/activities/${source}/save-to-library`)
    ).json["activityId"] as string;
    expect(
      (await call(EDITOR, "GET", `/api/activities/${saved}`)).json,
    ).toMatchObject({ role: "editor", visibility: "private" });
    expect(
      (await saveActivity(EDITOR, saved, { title: "Juggling" })).status,
    ).toBe(200);

    await publish(saved);
    expect(
      (await call(EDITOR, "GET", `/api/activities/${saved}`)).json,
    ).toMatchObject({ role: "viewer", visibility: "library" });
    expect(
      (await saveActivity(OTHER_CURATOR, saved, { title: "Juggling Act" }))
        .status,
    ).toBe(200);
  });
});

describe("an Event", () => {
  it("is read with its visibility, and never opens a curator's way in", async () => {
    expect(
      (await call(CURATOR, "GET", `/api/events/${EVENT_ID}`)).json,
    ).toMatchObject({ role: "owner", visibility: "private" });
    expect(
      (await call(OTHER_CURATOR, "GET", `/api/events/${EVENT_ID}`)).status,
    ).toBe(404);
  });
});
