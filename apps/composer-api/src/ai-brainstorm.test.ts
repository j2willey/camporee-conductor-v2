import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeProvider } from "./ai/fake.ts";
import { AiError, type AiProvider, type AiRequest } from "./ai/provider.ts";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, documentAudit, testDb } from "./test-support.ts";

/**
 * Brainstorm (ADR-0030, #103 PR 2): theme ideas, and v1's three Introduction options. Asking and accepting are for
 * editors; accepting is a save checked by the structural diff and audited as AI. No personal data in a prompt.
 */

type EventDoc = Record<string, unknown> & {
  id: string;
  title: string;
  theme?: string;
  slug: string;
};

const bundle = readEventBundle(CIRCUS_2026);
const CONTACT = {
  role: "Director",
  name: "Pat Director",
  email: "pat.director@example.com",
  phone: "555-0100",
};
const OFFICIAL_EMAIL = "official.one@example.com";
const VENUE = { name: "Camp Secret Hollow", address: "1 Hidden Lane" };
const EVENT = {
  ...(bundle.event as EventDoc),
  contacts: [CONTACT],
  venue: VENUE,
} as EventDoc;
const ACTIVITY_TITLES = (bundle.activities as { title: string }[]).map(
  (a) => a.title,
);

const OWNER = "cora@example.com";
const VIEWER = "vic@example.com";
const OUTSIDER = "olga@example.com";

const IDEAS = {
  ideas: [
    { theme: "Under the Big Top", why: "Keeps the circus, adds the tent." },
    { theme: "Carnival of Skills", why: "Every station a sideshow." },
  ],
};
const OPTIONS = {
  action: "Step right up!",
  lore: "Long ago, a travelling circus…",
  skill: "Knots, fire and first aid await.",
};

let db: Db;
let ai: AiProvider & { requests: AiRequest[] };
let reply: (request: AiRequest) => string;

function appWith(provider: AiProvider | null) {
  return createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date("2026-11-12T10:00:00Z"),
    ai: provider,
  });
}
let app: ReturnType<typeof createApp>;

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

const stored = () =>
  JSON.parse(
    db.select().from(documents).where(eq(documents.id, EVENT.id)).get()?.json ??
      "null",
  ) as EventDoc;
const readEvent = async () =>
  (await call(OWNER, "GET", `/api/events/${EVENT.id}`)).json as {
    event: EventDoc;
    updatedAt: number;
  };

const themes = (who: string, body: unknown = {}) =>
  call(who, "POST", `/api/events/${EVENT.id}/ai/themes`, { body });
const introductions = (who: string, body: unknown = {}) =>
  call(who, "POST", `/api/events/${EVENT.id}/ai/introductions`, { body });
async function accept(
  who: string,
  proposal: unknown,
  feature: string,
  ifMatch?: number,
) {
  return call(who, "PUT", `/api/events/${EVENT.id}/ai`, {
    body: { proposal, feature },
    ifMatch: ifMatch ?? (await readEvent()).updatedAt,
  });
}

beforeEach(async () => {
  db = testDb();
  reply = (request) =>
    JSON.stringify(request.system.includes("Introduction") ? OPTIONS : IDEAS);
  ai = fakeProvider((request) => reply(request));
  app = appWith(ai);
  const org = (
    await call(OWNER, "POST", "/api/organizations", {
      body: { name: "Coyote Creek", slug: "coyote-creek" },
    })
  ).json["id"] as string;
  importEvent(
    db,
    org,
    { ...bundle, event: EVENT },
    new Date("2026-11-12T09:00:00Z"),
  );
  expect(
    (
      await call(OWNER, "POST", `/api/events/${EVENT.id}/officials`, {
        body: { officials: [{ email: OFFICIAL_EMAIL, role: "director" }] },
      })
    ).status,
  ).toBe(201);
  await call(VIEWER, "GET", "/api/me");
  await call(OWNER, "POST", `/api/organizations/${org}/members`, {
    body: { email: VIEWER, role: "viewer" },
  });
  await call(OUTSIDER, "GET", "/api/me");
});

describe("POST /api/events/:eventId/ai/themes", () => {
  it("returns a few theme ideas", async () => {
    const res = await themes(OWNER);
    expect(res.status).toBe(200);
    expect(res.json).toEqual(IDEAS);
    expect(ai.requests).toHaveLength(1);
    // Asks for an answer in a schema (structured outputs).
    expect(ai.requests[0]?.schema).toMatchObject({ type: "object" });
  });

  it("tells the model about the Event's design, and never its personal data", async () => {
    await themes(OWNER, { instruction: "Something with pirates" });
    const sent = `${ai.requests[0]?.system}\n${ai.requests[0]?.prompt}`;
    expect(sent).toContain(EVENT.title);
    expect(sent).toContain(String(EVENT.theme));
    for (const title of ACTIVITY_TITLES.slice(0, 3))
      expect(sent).toContain(title);
    expect(sent).toContain("Something with pirates");
    for (const secret of [
      CONTACT.name,
      CONTACT.email,
      CONTACT.phone,
      OFFICIAL_EMAIL,
      VENUE.name,
      VENUE.address,
      String(EVENT["organizerName"]),
    ]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("refuses a long instruction", async () => {
    expect((await themes(OWNER, { instruction: "x".repeat(501) })).status).toBe(
      400,
    );
  });

  it("is for editors; not found without AI", async () => {
    expect((await themes(VIEWER)).status).toBe(403);
    expect((await themes(OUTSIDER)).status).toBe(404);
    expect(ai.requests).toHaveLength(0);
    app = appWith(null);
    expect((await themes(OWNER)).status).toBe(404);
  });

  it("is 502 with the reason when the AI fails, declines or answers out of shape", async () => {
    reply = () => "not json";
    const garbled = await themes(OWNER);
    expect(garbled.status).toBe(502);
    expect(String(garbled.json["error"])).toContain("expected form");

    reply = () => JSON.stringify({ ideas: [{ theme: 7 }] });
    expect((await themes(OWNER)).status).toBe(502);

    app = appWith({
      model: "m",
      complete: () =>
        Promise.reject(new AiError("The AI declined this request.")),
    });
    const declined = await themes(OWNER);
    expect(declined.status).toBe(502);
    expect(declined.json["error"]).toBe("The AI declined this request.");
  });
});

describe("POST /api/events/:eventId/ai/introductions", () => {
  it("returns v1's three options from the theme", async () => {
    const res = await introductions(OWNER, { instruction: "Shorter" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual(OPTIONS);
    const sent = `${ai.requests[0]?.system}\n${ai.requests[0]?.prompt}`;
    expect(sent).toContain(String(EVENT.theme));
    expect(sent).toContain("Shorter");
    expect(sent).not.toContain(CONTACT.email);
  });

  it("needs a theme first, as in v1", async () => {
    const { event, updatedAt } = await readEvent();
    const noTheme = { ...event };
    delete noTheme.theme;
    expect(
      (
        await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
          body: noTheme,
          ifMatch: updatedAt,
        })
      ).status,
    ).toBe(200);
    const res = await introductions(OWNER);
    expect(res.status).toBe(400);
    expect(res.json["error"]).toBe("Give the Event a theme first.");
    expect(ai.requests).toHaveLength(0);
  });
});

describe("PUT /api/events/:eventId/ai (accept a proposal)", () => {
  it("saves the picked theme, audited as AI", async () => {
    const { event } = await readEvent();
    const res = await accept(
      OWNER,
      { ...event, theme: "Under the Big Top" },
      "theme",
    );
    expect(res.status).toBe(200);
    expect(res.json["updatedAt"]).toBe((await readEvent()).updatedAt);
    expect(stored().theme).toBe("Under the Big Top");
    expect(documentAudit(db).at(-1)).toMatchObject({
      action: "event.update",
      documentId: EVENT.id,
      detail: { ai: "theme" },
    });
  });

  it("saves the picked introduction", async () => {
    const { event } = await readEvent();
    expect(
      (
        await accept(
          OWNER,
          { ...event, introduction: OPTIONS.lore },
          "introduction",
        )
      ).status,
    ).toBe(200);
    expect(stored()["introduction"]).toBe(OPTIONS.lore);
  });

  it("refuses a proposal that changes anything else, and saves nothing", async () => {
    const { event } = await readEvent();
    const res = await accept(
      OWNER,
      { ...event, theme: "Under the Big Top", slug: "big-top" },
      "theme",
    );
    expect(res.status).toBe(422);
    expect(res.json["error"]).toContain(
      "slug: an AI proposal can't change this",
    );
    expect(stored().theme).toBe(EVENT.theme);
  });

  it("checks the proposal like any save", async () => {
    const { event, updatedAt } = await readEvent();
    expect(
      (await accept(OWNER, { ...event, introduction: 42 }, "introduction"))
        .status,
    ).toBe(422);
    expect(
      (await accept(OWNER, { ...event, theme: "x" }, "theme", updatedAt - 1))
        .status,
    ).toBe(409);
    expect(
      (await accept(VIEWER, { ...event, theme: "x" }, "theme")).status,
    ).toBe(403);
    expect(
      (await accept(OWNER, { ...event, theme: "x" }, "sorcery")).status,
    ).toBe(400);
    app = appWith(null);
    expect(
      (await accept(OWNER, { ...event, theme: "x" }, "theme")).status,
    ).toBe(404);
  });
});
