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
 * Theme one Activity (ADR-0030 notes, #103 PR 3; v1's `theme-game`). The AI answers a title, the content and a
 * label and placeholder per field id; the server puts those onto the stored Activity as a proposal. Nothing is saved
 * until the editor accepts.
 */

type Field = {
  id: string;
  label: string;
  type: string;
  config?: { placeholder?: string; min?: number; max?: number };
};
type ActivityDoc = Record<string, unknown> & {
  id: string;
  slug: string;
  title: string;
  content: Record<string, unknown> & { story: string; rules: string[] };
  scoring: { fields: Field[] };
};

const bundle = readEventBundle(CIRCUS_2026);
const CONTACT_EMAIL = "pat.director@example.com";
const OFFICIAL_EMAIL = "official.one@example.com";
const EVENT = {
  ...(bundle.event as Record<string, unknown> & { id: string; theme: string }),
  introduction: "Welcome to the greatest show in the woods.",
  contacts: [{ role: "Director", name: "Pat Director", email: CONTACT_EMAIL }],
};
const ACTIVITY = (bundle.activities as ActivityDoc[]).find(
  (a) => a.slug === "3-ring-circus",
) as ActivityDoc;

const OWNER = "cora@example.com";
const VIEWER = "vic@example.com";
const OUTSIDER = "olga@example.com";

/** The AI's answer: themed text, and a label per field (the first with a placeholder too). */
function themedAnswer(activity: ActivityDoc) {
  return {
    title: "The Big Top Spectacular",
    content: {
      story: "The ringmaster needs three acts by sundown.",
      objective: "Put on three acts.",
      description: "Run each ring in turn.",
      rules: ["No real lions."],
      timeAndScoring: "Ten minutes; points per act.",
      setup: "Three rope rings.",
      reset: "Coil the ropes.",
      staffing: "One judge.",
      notes: "",
      supplies: [{ group: "", item: "Rope (Ring Rope)", quantity: "3" }],
    },
    fields: activity.scoring.fields.map((f, i) => ({
      id: f.id,
      label: `Big Top ${f.label}`,
      placeholder: i === 0 ? "Acts completed" : "",
    })),
  };
}

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

const stored = () =>
  JSON.parse(
    db.select().from(documents).where(eq(documents.id, ACTIVITY.id)).get()
      ?.json ?? "null",
  ) as ActivityDoc;
const readActivity = async () =>
  (await call(OWNER, "GET", `/api/activities/${ACTIVITY.id}`)).json as {
    activity: ActivityDoc;
    updatedAt: number;
  };

const theme = (who: string, body: unknown = { eventId: EVENT.id }) =>
  call(who, "POST", `/api/activities/${ACTIVITY.id}/ai/theme`, { body });
async function propose(): Promise<ActivityDoc> {
  const res = await theme(OWNER);
  expect(res.status).toBe(200);
  return res.json["proposal"] as ActivityDoc;
}
async function accept(who: string, proposal: unknown, ifMatch?: number) {
  return call(who, "PUT", `/api/activities/${ACTIVITY.id}/ai`, {
    body: { proposal, feature: "theme" },
    ifMatch: ifMatch ?? (await readActivity()).updatedAt,
  });
}

beforeEach(async () => {
  db = testDb();
  reply = () => themedAnswer(ACTIVITY);
  ai = fakeProvider(() => JSON.stringify(reply()));
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
  await call(OWNER, "POST", `/api/events/${EVENT.id}/officials`, {
    body: { officials: [{ email: OFFICIAL_EMAIL, role: "director" }] },
  });
  await call(VIEWER, "GET", "/api/me");
  await call(OWNER, "POST", `/api/organizations/${org}/members`, {
    body: { email: VIEWER, role: "viewer" },
  });
  await call(OUTSIDER, "POST", "/api/organizations", {
    body: { name: "Elsewhere", slug: "elsewhere" },
  });
});

describe("POST /api/activities/:activityId/ai/theme", () => {
  it("proposes the themed Activity, built on the stored one; nothing is saved", async () => {
    const proposal = await propose();
    expect(proposal).toMatchObject({
      id: ACTIVITY.id,
      slug: ACTIVITY.slug,
      title: "The Big Top Spectacular",
      content: {
        story: "The ringmaster needs three acts by sundown.",
        rules: ["No real lions."],
        supplies: [{ item: "Rope (Ring Rope)", quantity: "3" }],
      },
    });
    // A blank group or quantity is left out, as the schema wants.
    expect(
      (proposal.content["supplies"] as Record<string, unknown>[])[0],
    ).not.toHaveProperty("group");
    // Fields: new wording, everything else as it was.
    const before = ACTIVITY.scoring.fields;
    const after = proposal.scoring.fields;
    expect(after.map((f) => f.id)).toEqual(before.map((f) => f.id));
    expect(after.map((f) => f.type)).toEqual(before.map((f) => f.type));
    expect(after[0]?.label).toBe(`Big Top ${before[0]?.label}`);
    expect(after[0]?.config?.placeholder).toBe("Acts completed");
    // A blank placeholder keeps the old one (or none).
    expect(after[1]?.config).toEqual(before[1]?.config);
    expect(stored()).toEqual(ACTIVITY);
  });

  it("tells the model the theme, the Introduction and the Activity, never personal data", async () => {
    await theme(OWNER, { eventId: EVENT.id, instruction: "Less scary" });
    const sent = `${ai.requests[0]?.system}\n${ai.requests[0]?.prompt}`;
    expect(sent).toContain(EVENT.theme);
    expect(sent).toContain(EVENT.introduction);
    expect(sent).toContain(ACTIVITY.content.story);
    expect(sent).toContain(ACTIVITY.scoring.fields[0]?.id ?? "?");
    expect(sent).toContain("Less scary");
    for (const secret of [
      CONTACT_EMAIL,
      "Pat Director",
      OFFICIAL_EMAIL,
      String(EVENT["organizerName"]),
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(ai.requests[0]?.schema).toMatchObject({ type: "object" });
  });

  it("ignores field ids it doesn't know, and keeps a field it left out or left blank", async () => {
    reply = () => ({
      ...themedAnswer(ACTIVITY),
      fields: [
        { id: "made_up_field", label: "Ghost", placeholder: "" },
        { id: ACTIVITY.scoring.fields[0]?.id, label: "  ", placeholder: "" },
      ],
    });
    const proposal = await propose();
    expect(proposal.scoring).toEqual(ACTIVITY.scoring);
  });

  it("is a 502 when the answer doesn't make a valid Activity", async () => {
    reply = () => ({
      ...themedAnswer(ACTIVITY),
      content: { ...themedAnswer(ACTIVITY).content, story: "   " },
    });
    const res = await theme(OWNER);
    expect(res.status).toBe(502);
    expect(String(res.json["error"])).toContain("didn't fit");
  });

  it("needs a theme or an Introduction first, as in v1", async () => {
    const { event, updatedAt } = (
      await call(OWNER, "GET", `/api/events/${EVENT.id}`)
    ).json as { event: Record<string, unknown>; updatedAt: number };
    const bare = { ...event };
    delete bare["theme"];
    delete bare["introduction"];
    expect(
      (
        await call(OWNER, "PUT", `/api/events/${EVENT.id}`, {
          body: bare,
          ifMatch: updatedAt,
        })
      ).status,
    ).toBe(200);
    const res = await theme(OWNER);
    expect(res.status).toBe(400);
    expect(res.json["error"]).toBe(
      "Give the Event a theme or an Introduction first.",
    );
    expect(ai.requests).toHaveLength(0);
  });

  it("is for the Activity's editors, with an Event they can read; not found without AI", async () => {
    expect((await theme(VIEWER)).status).toBe(403);
    expect((await theme(OUTSIDER)).status).toBe(404);
    const otherEvent = (
      await call(
        OUTSIDER,
        "POST",
        `/api/organizations/${
          (
            (await call(OUTSIDER, "GET", "/api/organizations"))
              .json as unknown as {
              id: string;
            }[]
          )[0]?.id
        }/events`,
        { body: { title: "Theirs" } },
      )
    ).json["eventId"] as string;
    expect((await theme(OWNER, { eventId: otherEvent })).status).toBe(404);
    expect((await theme(OWNER, {})).status).toBe(400);
    expect(ai.requests).toHaveLength(0);
    app = appWith(null);
    expect((await theme(OWNER)).status).toBe(404);
  });
});

describe("PUT /api/activities/:activityId/ai (accept)", () => {
  it("saves the proposal, audited as AI", async () => {
    const proposal = await propose();
    const res = await accept(OWNER, proposal);
    expect(res.status).toBe(200);
    expect(stored()).toEqual(proposal);
    expect(documentAudit(db).at(-1)).toMatchObject({
      action: "activity.update",
      documentId: ACTIVITY.id,
      detail: { ai: "theme" },
    });
  });

  it("refuses a proposal that changes what AI may not, and saves nothing", async () => {
    const proposal = await propose();
    const [first, ...rest] = proposal.scoring.fields;
    const res = await accept(OWNER, {
      ...proposal,
      scoring: {
        ...proposal.scoring,
        fields: [{ ...first, type: "text" }, ...rest],
      },
    });
    expect(res.status).toBe(422);
    expect(res.json["error"]).toContain(
      "scoring.fields.0.type: an AI proposal can't change this",
    );
    expect(stored()).toEqual(ACTIVITY);
  });

  it("checks the proposal like any save", async () => {
    const proposal = await propose();
    const { updatedAt } = await readActivity();
    expect((await accept(OWNER, proposal, updatedAt - 1)).status).toBe(409);
    expect((await accept(VIEWER, proposal)).status).toBe(403);
    expect(
      (
        await accept(OWNER, {
          ...proposal,
          content: { ...proposal.content, story: "" },
        })
      ).status,
    ).toBe(422);
  });
});
