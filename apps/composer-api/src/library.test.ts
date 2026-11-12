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

/** The library model (ADR-0031, #102 PR 1): visibility, curators, publish and unpublish. */

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as {
  id: string;
  slug: string;
  title: string;
  activities: { activityId: string }[];
  competitions: { commonFields?: { setId: string } }[];
};
const [FIRST] = bundle.activities as { id: string; slug: string }[];
const ACTIVITY = FIRST?.id ?? "";
const SET_ID = EVENT.competitions[0]?.commonFields?.setId ?? "";
const TEMPLATE_ID = "0196cfa2-4c00-7000-8000-000000000300";

const CURATOR = "cora@example.com"; // owner of Coyote Creek, curator
const ANN = "ann@example.com"; // owner of Coyote Creek, not a curator
const OUTSIDER = "olga@example.com"; // another Organization; curator once she's made one

let db: Db;
let app: ReturnType<typeof createApp>;
let org: string;

async function call(who: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
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
const visibility = (id: string) =>
  db
    .select({ visibility: documents.visibility })
    .from(documents)
    .where(eq(documents.id, id))
    .get()?.visibility;
const publish = (who: string, id: string) =>
  call(who, "POST", "/api/library/publish", { id });
const unpublish = (who: string, id: string) =>
  call(who, "POST", "/api/library/unpublish", { id });

/** The Circus Event as a Template document (Event-shaped, no contacts), listing the same Activities. */
function storeTemplate(extra: Record<string, unknown> = {}) {
  const rest = { ...(bundle.event as Record<string, unknown>) };
  delete rest["contacts"];
  const template = {
    ...rest,
    ...extra,
    id: TEMPLATE_ID,
    kind: "template",
    slug: "circus-template",
    title: "Circus Template",
  };
  db.insert(documents)
    .values({
      id: TEMPLATE_ID,
      kind: "template",
      organizationId: org,
      slug: template.slug,
      title: template.title,
      json: JSON.stringify(template),
    })
    .run();
}

beforeEach(async () => {
  db = testDb();
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date("2026-11-12T10:00:00Z"),
  });
  const res = await call(CURATOR, "POST", "/api/organizations", {
    name: "Coyote Creek",
    slug: "coyote-creek",
  });
  org = res.json["id"] as string;
  importEvent(db, org, bundle, new Date("2026-11-12T09:00:00Z"));
  for (const who of [ANN, OUTSIDER]) await call(who, "GET", "/api/me");
  await call(CURATOR, "POST", `/api/organizations/${org}/members`, {
    email: ANN,
    role: "owner",
  });
  await call(OUTSIDER, "POST", "/api/organizations", {
    name: "Elsewhere",
    slug: "elsewhere",
  });
  setCurator(db, CURATOR, true);
});

describe("curators", () => {
  it("are users flagged by the sysadmin, and /api/me says so", async () => {
    expect((await call(CURATOR, "GET", "/api/me")).json["curator"]).toBe(true);
    expect((await call(ANN, "GET", "/api/me")).json["curator"]).toBe(false);
    expect(setCurator(db, CURATOR, false)).toBe(true);
    expect((await call(CURATOR, "GET", "/api/me")).json["curator"]).toBe(false);
    expect(setCurator(db, "nobody@example.com", true)).toBe(false);
  });
});

describe("publishing", () => {
  it("starts every document private", () => {
    expect(visibility(EVENT.id)).toBe("private");
    expect(visibility(ACTIVITY)).toBe("private");
  });

  it("lets a curator publish an Activity, and anyone signed in read it", async () => {
    expect(
      (await call(OUTSIDER, "GET", `/api/activities/${ACTIVITY}`)).status,
    ).toBe(404);
    const res = await publish(CURATOR, ACTIVITY);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ published: [ACTIVITY] });
    expect(visibility(ACTIVITY)).toBe("library");
    const read = await call(OUTSIDER, "GET", `/api/activities/${ACTIVITY}`);
    expect(read.status).toBe(200);
    expect(read.json["role"]).toBe("viewer");
    expect(documentAudit(db).map((r) => r.action)).toContain("library.publish");
  });

  it("refuses a non-curator (#102 acceptance)", async () => {
    const res = await publish(ANN, ACTIVITY);
    expect(res.status).toBe(403);
    expect(res.json["error"]).toBe(
      "Only a curator can publish to the library.",
    );
    expect(visibility(ACTIVITY)).toBe("private");
  });

  it("refuses a curator from outside the Organization: publishing never exposes another Organization's work", async () => {
    setCurator(db, OUTSIDER, true);
    expect((await publish(OUTSIDER, ACTIVITY)).status).toBe(404);
    expect(visibility(ACTIVITY)).toBe("private");
  });

  it("publishes a Template with its Activities and Common Field set", async () => {
    storeTemplate();
    const res = await publish(CURATOR, TEMPLATE_ID);
    expect(res.status).toBe(200);
    expect(visibility(TEMPLATE_ID)).toBe("library");
    expect(visibility(SET_ID)).toBe("library");
    for (const { activityId } of EVENT.activities) {
      expect(visibility(activityId)).toBe("library");
    }
    expect((res.json["published"] as string[]).length).toBe(
      EVENT.activities.length + 2,
    );
  });

  it("refuses an Event, and a Template holding personal data", async () => {
    const event = await publish(CURATOR, EVENT.id);
    expect(event.status).toBe(400);
    expect(event.json["error"]).toBe(
      "Only Templates and Activities go in the library.",
    );
    storeTemplate({
      contacts: [
        { role: "Director", name: "Ann", email: "a@x.org", phone: "1" },
      ],
    });
    const personal = await publish(CURATOR, TEMPLATE_ID);
    expect(personal.status).toBe(422);
    expect(personal.json["error"]).toBe(
      "template circus-template holds personal data (contacts): it can't go in the library.",
    );
    expect(visibility(TEMPLATE_ID)).toBe("private");
  });
});

describe("unpublishing", () => {
  it("lets any curator take a document out of the library", async () => {
    await publish(CURATOR, ACTIVITY);
    expect((await unpublish(ANN, ACTIVITY)).status).toBe(403);
    setCurator(db, OUTSIDER, true);
    const res = await unpublish(OUTSIDER, ACTIVITY);
    expect(res.status).toBe(200);
    expect(visibility(ACTIVITY)).toBe("private");
    setCurator(db, OUTSIDER, false);
    expect(
      (await call(OUTSIDER, "GET", `/api/activities/${ACTIVITY}`)).status,
    ).toBe(404);
    expect(documentAudit(db).map((r) => r.action)).toContain(
      "library.unpublish",
    );
  });
});
