import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { setCurator } from "./library.ts";
import { CIRCUS_2026, testDb } from "./test-support.ts";

/** The library catalog (ADR-0031, #102 PR 2): listing, filters and previews. */

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as { id: string; title: string };
const ACTIVITIES = bundle.activities as Record<string, unknown>[];
const TAGGED = ACTIVITIES.find((a) => Array.isArray(a["tags"])) as {
  id: string;
  title: string;
};
const EVENT_DOC = bundle.event as {
  competitions: { id: string; programGuide?: { listActivities: boolean } }[];
  activities: { activityId: string; competitionId: string }[];
};
/** An Activity in a Competition the Program Guide lists (Circus 2026 hides its Patrol Games). */
const LISTED = (() => {
  const shown = new Set(
    EVENT_DOC.competitions
      .filter((c) => c.programGuide?.listActivities !== false)
      .map((c) => c.id),
  );
  const entry = EVENT_DOC.activities.find((a) => shown.has(a.competitionId));
  return ACTIVITIES.find((a) => a["id"] === entry?.activityId) as {
    title: string;
  };
})();
const TEMPLATE_ID = "0196cfa2-4c00-7000-8000-000000000300";
const SAVED_ID = "0196cfa2-4c00-7000-8000-000000000301";
const OTHER_SAVED_ID = "0196cfa2-4c00-7000-8000-000000000302";

const CURATOR = "cora@example.com"; // owner of Coyote Creek, curator
const OUTSIDER = "olga@example.com"; // owner of Elsewhere

let db: Db;
let app: ReturnType<typeof createApp>;
let org: string;
let elsewhere: string;

type Item = {
  id: string;
  kind: "template" | "activity";
  title: string;
  tags: string[];
  visibility: "private" | "library";
  organization: { id: string; name: string };
  mine: boolean;
};

async function call(who: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

async function catalog(who: string, query = ""): Promise<Item[]> {
  const res = await call(who, `/api/library${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Item[];
}

const ids = (items: Item[]) => items.map((i) => i.id).sort();

function insert(
  organizationId: string,
  doc: Record<string, unknown> & { id: string; kind: string },
) {
  db.insert(documents)
    .values({
      id: doc.id,
      kind: doc.kind as "activity",
      organizationId,
      slug: doc["slug"] as string,
      title: doc["title"] as string,
      json: JSON.stringify(doc),
    })
    .run();
}

/** A saved Activity: a copy of the tagged Circus Activity that no Event lists. */
function storeSaved(
  organizationId: string,
  id: string,
  title: string,
  tags?: string[],
) {
  insert(organizationId, {
    ...(TAGGED as unknown as Record<string, unknown>),
    id,
    kind: "activity",
    slug: title.toLowerCase().replaceAll(" ", "-"),
    title,
    ...(tags && { tags }),
  });
}

/** The Circus Event as a Template (Event-shaped, no contacts), listing the same Activities. */
function storeTemplate() {
  const rest = { ...(bundle.event as Record<string, unknown>) };
  delete rest["contacts"];
  insert(org, {
    ...rest,
    id: TEMPLATE_ID,
    kind: "template",
    slug: "circus-template",
    title: "Circus Template",
  });
}

beforeEach(async () => {
  db = testDb();
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date("2026-11-12T10:00:00Z"),
  });
  const created = await call(CURATOR, "/api/organizations", {
    name: "Coyote Creek",
    slug: "coyote-creek",
  });
  org = ((await created.json()) as { id: string }).id;
  importEvent(db, org, bundle, new Date("2026-11-12T09:00:00Z"));
  const other = await call(OUTSIDER, "/api/organizations", {
    name: "Elsewhere",
    slug: "elsewhere",
  });
  elsewhere = ((await other.json()) as { id: string }).id;
  setCurator(db, CURATOR, true);
});

describe("GET /api/library", () => {
  it("leaves out an Event's Activities: they aren't saved for reuse", async () => {
    expect(await catalog(CURATOR)).toEqual([]);
  });

  it("lists my Organizations' private Templates and saved Activities", async () => {
    storeTemplate();
    storeSaved(org, SAVED_ID, "Knot Relay", ["#knots"]);
    const items = await catalog(CURATOR);
    expect(ids(items)).toEqual([TEMPLATE_ID, SAVED_ID].sort());
    const saved = items.find((i) => i.id === SAVED_ID);
    expect(saved).toMatchObject({
      kind: "activity",
      title: "Knot Relay",
      tags: ["#knots"],
      visibility: "private",
      organization: { id: org, name: "Coyote Creek" },
      mine: true,
    });
    expect(items.find((i) => i.id === TEMPLATE_ID)).toMatchObject({
      kind: "template",
      tags: [],
    });
  });

  it("doesn't list an Activity a private Template lists on its own", async () => {
    storeTemplate();
    // The Template lists every Circus Activity; none of them is a saved Activity.
    expect(ids(await catalog(CURATOR, "?kind=activity"))).toEqual([]);
  });

  it("shows outsiders the library only", async () => {
    storeTemplate();
    storeSaved(org, SAVED_ID, "Knot Relay");
    expect(await catalog(OUTSIDER)).toEqual([]);

    const res = await call(CURATOR, "/api/library/publish", {
      id: TEMPLATE_ID,
    });
    expect(res.status).toBe(200);
    const items = await catalog(OUTSIDER);
    // The Template and its Activities; never the private saved one.
    expect(ids(items)).toEqual(
      [TEMPLATE_ID, ...ACTIVITIES.map((a) => a["id"] as string)].sort(),
    );
    expect(items.every((i) => i.visibility === "library" && !i.mine)).toBe(
      true,
    );
    expect(items[0]?.organization.name).toBe("Coyote Creek");
  });

  it("lists another Organization's saved Activities only to its members", async () => {
    storeSaved(elsewhere, OTHER_SAVED_ID, "Elsewhere Relay");
    expect(ids(await catalog(OUTSIDER))).toEqual([OTHER_SAVED_ID]);
    expect(await catalog(CURATOR)).toEqual([]);
  });

  it("filters by kind, tag and text", async () => {
    storeTemplate();
    storeSaved(org, SAVED_ID, "Knot Relay", ["#Knots", "relay"]);
    storeSaved(org, OTHER_SAVED_ID, "Water Carry", ["water"]);

    expect(ids(await catalog(CURATOR, "?kind=template"))).toEqual([
      TEMPLATE_ID,
    ]);
    expect(ids(await catalog(CURATOR, "?kind=activity"))).toEqual(
      [SAVED_ID, OTHER_SAVED_ID].sort(),
    );
    // Case, spaces and a leading # don't matter.
    for (const tag of ["knots", "%23knots", "%20KNOTS%20"]) {
      expect(ids(await catalog(CURATOR, `?tag=${tag}`))).toEqual([SAVED_ID]);
    }
    expect(ids(await catalog(CURATOR, "?q=water"))).toEqual([OTHER_SAVED_ID]);
    expect(ids(await catalog(CURATOR, "?q=CIRCUS"))).toEqual([TEMPLATE_ID]);
    // Text also matches tags.
    expect(ids(await catalog(CURATOR, "?q=relay"))).toEqual([SAVED_ID]);
    expect(await catalog(CURATOR, "?kind=template&q=water")).toEqual([]);
  });

  it("lists by title", async () => {
    storeSaved(org, SAVED_ID, "Zip Line");
    storeSaved(org, OTHER_SAVED_ID, "Archery");
    expect((await catalog(CURATOR)).map((i) => i.title)).toEqual([
      "Archery",
      "Zip Line",
    ]);
  });

  it("refuses an unknown kind", async () => {
    expect((await call(CURATOR, "/api/library?kind=event")).status).toBe(400);
  });
});

describe("GET /api/library/:id/preview", () => {
  const preview = async (who: string, id: string) => {
    const res = await call(who, `/api/library/${id}/preview`);
    return { status: res.status, html: await res.text() };
  };

  it("shows a saved Activity's guide, on its own", async () => {
    storeSaved(org, SAVED_ID, "Knot Relay");
    const { status, html } = await preview(CURATOR, SAVED_ID);
    expect(status).toBe(200);
    expect(html).toContain("<title>Knot Relay: guide</title>");
    expect(html).toContain("Knot Relay");
    // No number: it isn't in a Template.
    expect(html).not.toMatch(/\d\. Knot Relay/);
    // Never another Event's name.
    expect(html).not.toContain(EVENT.title);
  });

  it("numbers a Template's Activity as the Template does", async () => {
    storeTemplate();
    const { status, html } = await preview(CURATOR, TAGGED.id);
    expect(status).toBe(200);
    expect(html).toMatch(new RegExp(`[A-Z]\\d+\\. ${TAGGED.title}`));
  });

  it("numbers a library Activity only from a library Template", async () => {
    storeTemplate(); // private
    const res = await call(CURATOR, "/api/library/publish", { id: TAGGED.id });
    expect(res.status).toBe(200);
    const { status, html } = await preview(OUTSIDER, TAGGED.id);
    expect(status).toBe(200);
    expect(html).not.toMatch(new RegExp(`[A-Z]\\d+\\. ${TAGGED.title}`));
  });

  it("shows a Template as its Program Guide", async () => {
    storeTemplate();
    const { status, html } = await preview(CURATOR, TEMPLATE_ID);
    expect(status).toBe(200);
    expect(html).toContain("Circus Template");
    expect(html).toContain(LISTED.title);
  });

  it("is 404 to outsiders until it's in the library", async () => {
    storeTemplate();
    expect((await preview(OUTSIDER, TEMPLATE_ID)).status).toBe(404);
    expect((await preview(OUTSIDER, TAGGED.id)).status).toBe(404);
    await call(CURATOR, "/api/library/publish", { id: TEMPLATE_ID });
    expect((await preview(OUTSIDER, TEMPLATE_ID)).status).toBe(200);
    expect((await preview(OUTSIDER, TAGGED.id)).status).toBe(200);
  });

  it("is 404 for anything but a Template or an Activity", async () => {
    expect((await preview(CURATOR, EVENT.id)).status).toBe(404);
    expect((await preview(CURATOR, "no-such-id")).status).toBe(404);
  });
});
