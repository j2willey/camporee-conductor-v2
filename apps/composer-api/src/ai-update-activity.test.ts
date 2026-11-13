import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeProvider } from "./ai/fake.ts";
import type { AiProvider, AiRequest } from "./ai/provider.ts";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { documents } from "./db/schema.ts";
import { importEvent } from "./import/import-event.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, documentAudit, testDb } from "./test-support.ts";

/**
 * AI update with a prompt, and undo (ADR-0030 notes, #103 PR 4; v1's `update-game`). The AI answers each of the title
 * and content sections, or null to leave it; the server puts that onto the stored Activity as a proposal.
 */

type ActivityDoc = Record<string, unknown> & {
  id: string;
  slug: string;
  title: string;
  content: Record<string, unknown> & { story: string; rules: string[] };
  scoring: unknown;
};

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as Record<string, unknown> & { id: string };
const ACTIVITY = (bundle.activities as ActivityDoc[]).find(
  (a) => a.slug === "clown-car",
) as ActivityDoc;

const OWNER = "cora@example.com";
const VIEWER = "vic@example.com";
const OUTSIDER = "olga@example.com";

/** Nothing changed but the story and the rules. */
const ANSWER = {
  title: null,
  objective: null,
  story: "The clowns lost their car keys.",
  description: null,
  rules: ["Find the keys first.", "No juggling the keys."],
  timeAndScoring: null,
  notes: null,
  staffing: null,
  setup: null,
  reset: null,
  supplies: null,
};

let db: Db;
let ai: AiProvider & { requests: AiRequest[] };
let reply: () => unknown;
let app: ReturnType<typeof createApp>;

const appWith = (provider: AiProvider | null) =>
  createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date("2026-11-12T10:00:00Z"),
    ai: provider,
  });

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

const storedDoc = (id: string) =>
  JSON.parse(
    db.select().from(documents).where(eq(documents.id, id)).get()?.json ??
      "null",
  ) as Record<string, unknown>;
const updatedAtOf = async (path: string) =>
  ((await call(OWNER, "GET", path)).json["updatedAt"] as number) ?? 0;

const update = (
  who: string,
  body: unknown = { instruction: "Make it about lost keys" },
  id = ACTIVITY.id,
) => call(who, "POST", `/api/activities/${id}/ai/update`, { body });

async function acceptActivity(proposal: unknown, feature: string) {
  return call(OWNER, "PUT", `/api/activities/${ACTIVITY.id}/ai`, {
    body: { proposal, feature },
    ifMatch: await updatedAtOf(`/api/activities/${ACTIVITY.id}`),
  });
}

beforeEach(async () => {
  db = testDb();
  reply = () => ANSWER;
  ai = fakeProvider(() => JSON.stringify(reply()));
  app = appWith(ai);
  const org = (
    await call(OWNER, "POST", "/api/organizations", {
      body: { name: "Coyote Creek", slug: "coyote-creek" },
    })
  ).json["id"] as string;
  importEvent(db, org, bundle, new Date("2026-11-12T09:00:00Z"));
  await call(VIEWER, "GET", "/api/me");
  await call(OWNER, "POST", `/api/organizations/${org}/members`, {
    body: { email: VIEWER, role: "viewer" },
  });
  await call(OUTSIDER, "GET", "/api/me");
});

describe("POST /api/activities/:activityId/ai/update", () => {
  it("proposes the Activity with only the sections the AI changed; nothing is saved", async () => {
    const res = await update(OWNER);
    expect(res.status).toBe(200);
    const proposal = res.json["proposal"] as ActivityDoc;
    expect(proposal).toEqual({
      ...ACTIVITY,
      content: {
        ...ACTIVITY.content,
        story: ANSWER.story,
        rules: ANSWER.rules,
      },
    });
    expect(storedDoc(ACTIVITY.id)).toEqual(ACTIVITY);
  });

  it("sends the instruction, and the current text unless asked not to", async () => {
    await update(OWNER, { instruction: "Make it about lost keys" });
    const withText = `${ai.requests[0]?.system}\n${ai.requests[0]?.prompt}`;
    expect(withText).toContain("Make it about lost keys");
    expect(withText).toContain(
      JSON.stringify(ACTIVITY.content.story).slice(1, -1),
    );
    expect(ai.requests[0]?.schema).toMatchObject({ type: "object" });

    await update(OWNER, {
      instruction: "Write it fresh",
      includeContent: false,
    });
    const without = `${ai.requests[1]?.system}\n${ai.requests[1]?.prompt}`;
    expect(without).toContain("Write it fresh");
    expect(without).not.toContain(
      JSON.stringify(ACTIVITY.content.story).slice(1, -1),
    );
  });

  it("changes the title and supplies when asked, with blank groups left out", async () => {
    reply = () => ({
      ...ANSWER,
      title: "Clown Car Key Hunt",
      supplies: [{ group: "", item: "Keys", quantity: "" }],
    });
    const proposal = (await update(OWNER)).json["proposal"] as ActivityDoc;
    expect(proposal.title).toBe("Clown Car Key Hunt");
    expect(proposal.content["supplies"]).toEqual([{ item: "Keys" }]);
    expect(proposal.scoring).toEqual(ACTIVITY.scoring);
  });

  it("needs an instruction", async () => {
    expect((await update(OWNER, { instruction: "  " })).status).toBe(400);
    expect((await update(OWNER, {})).status).toBe(400);
    expect(ai.requests).toHaveLength(0);
  });

  it("is a 502 when the answer doesn't make a valid Activity", async () => {
    reply = () => ({ ...ANSWER, story: "" });
    const res = await update(OWNER);
    expect(res.status).toBe(502);
    expect(String(res.json["error"])).toContain("didn't fit");
  });

  it("works on an Activity on its own, with no Event", async () => {
    const saved = (
      await call(
        OWNER,
        "POST",
        `/api/activities/${ACTIVITY.id}/save-to-library`,
      )
    ).json["activityId"] as string;
    expect((await update(OWNER, undefined, saved)).status).toBe(200);
  });

  it("is for the Activity's editors; not found without AI", async () => {
    expect((await update(VIEWER)).status).toBe(403);
    expect((await update(OUTSIDER)).status).toBe(404);
    expect(ai.requests).toHaveLength(0);
    app = appWith(null);
    expect((await update(OWNER)).status).toBe(404);
  });
});

describe("accept and undo", () => {
  it("accepts an update, audited as AI, and undoes it back to the version before", async () => {
    const proposal = (await update(OWNER)).json["proposal"];
    expect((await acceptActivity(proposal, "update")).status).toBe(200);
    expect(storedDoc(ACTIVITY.id)).toEqual(proposal);
    expect(documentAudit(db).at(-1)).toMatchObject({
      action: "activity.update",
      detail: { ai: "update" },
    });

    expect((await acceptActivity(ACTIVITY, "undo")).status).toBe(200);
    expect(storedDoc(ACTIVITY.id)).toEqual(ACTIVITY);
    expect(documentAudit(db).at(-1)).toMatchObject({
      action: "activity.update",
      detail: { ai: "undo" },
    });
  });

  it("undoes an Event's AI change the same way", async () => {
    const path = `/api/events/${EVENT.id}`;
    const accept = async (proposal: unknown, feature: string) =>
      call(OWNER, "PUT", `${path}/ai`, {
        body: { proposal, feature },
        ifMatch: await updatedAtOf(path),
      });
    expect(
      (await accept({ ...EVENT, theme: "Under the Big Top" }, "theme")).status,
    ).toBe(200);
    expect((await accept(EVENT, "undo")).status).toBe(200);
    expect(storedDoc(EVENT.id)).toEqual(EVENT);
    expect(documentAudit(db).at(-1)).toMatchObject({
      action: "event.update",
      detail: { ai: "undo" },
    });
  });

  it("an undo is still checked by the diff and If-Match", async () => {
    const proposal = (await update(OWNER)).json["proposal"];
    await acceptActivity(proposal, "update");
    const changedSlug = await acceptActivity(
      { ...ACTIVITY, slug: "other" },
      "undo",
    );
    expect(changedSlug.status).toBe(422);
    const stale = await call(
      OWNER,
      "PUT",
      `/api/activities/${ACTIVITY.id}/ai`,
      {
        body: { proposal: ACTIVITY, feature: "undo" },
        ifMatch: 1,
      },
    );
    expect(stale.status).toBe(409);
  });
});
