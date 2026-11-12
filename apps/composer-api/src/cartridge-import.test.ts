import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exportCartridge } from "@camporee-conductor/cartridge";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { documents } from "./db/schema.ts";
import { readEventBundle } from "./import/read-event-bundle.ts";
import { CIRCUS_2026, documentAudit, testDb } from "./test-support.ts";

/** Importing a cartridge in the browser (#100 PR 2): a v2 design cartridge or a v1 zip. */

const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as { id: string; slug: string; title: string };
const OFFICIALS = {
  schemaVersion: "4.0",
  kind: "officials",
  id: "0196cfa2-4c00-7000-8000-000000000200",
  slug: "circus-officials",
  title: "Circus Officials",
  eventId: EVENT.id,
  officials: [{ email: "director@example.com", role: "director" }],
};
const exportedAt = new Date("2026-11-12T09:00:00Z");
const DESIGN = exportCartridge(bundle, "design", { exportedAt });
const EVENT_DAY = exportCartridge(
  { ...bundle, officials: OFFICIALS },
  "event-day",
  { exportedAt },
);

/** The Circus 2026 v1 cartridge as v1's Composer exports it; `drop` takes one game out (file and playlist). */
function v1Zip(drop?: string): Uint8Array {
  const src = join(CIRCUS_2026, "v1-source");
  const camporee = JSON.parse(
    readFileSync(join(src, "camporee.json"), "utf8"),
  ) as { playlist: { gameId: string }[] };
  camporee.playlist = camporee.playlist.filter((e) => e.gameId !== drop);
  const files: Record<string, Uint8Array> = {
    "camporee.json": strToU8(JSON.stringify(camporee)),
    "presets.json": readFileSync(join(src, "presets.json")),
  };
  for (const name of readdirSync(join(src, "games"))) {
    if (name === `${drop}.json`) continue;
    files[`games/${name}`] = readFileSync(join(src, "games", name));
  }
  return zipSync(files);
}

const OWNER = "ann@example.com";
const VIEWER = "bob@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;
let org: string;

type Reply = {
  error: string;
  eventId: string;
  title: string;
  source: "cartridge" | "v1";
  created: number;
  updated: number;
  skipped: { game: string; reason: string }[];
  notes: string[];
  leftovers: { slug: string; title: string }[];
};

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

async function upload(
  who: string,
  bytes: Uint8Array,
  name = "upload.zip",
  orgId = org,
): Promise<{ status: number; json: Reply }> {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes as Uint8Array<ArrayBuffer>], name, {
      type: "application/zip",
    }),
  );
  const response = await app.request(`/api/organizations/${orgId}/import`, {
    method: "POST",
    headers: { [DEV_USER_HEADER]: who },
    body: form,
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

const count = (kind: "event" | "activity") =>
  db.select().from(documents).where(eq(documents.kind, kind)).all().length;

beforeEach(async () => {
  db = testDb();
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date("2026-11-12T10:00:00Z"),
  });
  const res = await call(OWNER, "POST", "/api/organizations", {
    name: "Coyote Creek",
    slug: "coyote-creek",
  });
  org = (res.json as unknown as { id: string }).id;
  await call(VIEWER, "GET", "/api/me");
  await call(OWNER, "POST", `/api/organizations/${org}/members`, {
    email: VIEWER,
    role: "viewer",
  });
});

describe("POST /api/organizations/:orgId/import", () => {
  it("imports a design cartridge, and again as an update, with an audit row", async () => {
    const first = await upload(OWNER, DESIGN, "circus-design.zip");
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({
      source: "cartridge",
      eventId: EVENT.id,
      title: EVENT.title,
      created: 35,
      updated: 0,
    });
    expect(count("activity")).toBe(33);
    const again = await upload(OWNER, DESIGN);
    expect(again.json).toMatchObject({ created: 0, updated: 35 });
    expect(documentAudit(db).map((r) => r.action)).toEqual([
      "event.import",
      "event.import",
    ]);
  });

  it("imports a v1 zip, reporting games it skipped", async () => {
    const res = await upload(OWNER, v1Zip(), "circus-v1.zip");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ source: "v1" });
    expect(res.json.created).toBeGreaterThan(30);
    expect(Array.isArray(res.json.skipped)).toBe(true);
    expect(Array.isArray(res.json.notes)).toBe(true);
    expect(count("event")).toBe(1);
  });

  it("lists Activities an earlier v1 import left behind", async () => {
    await upload(OWNER, v1Zip());
    const res = await upload(OWNER, v1Zip("clown-car"));
    expect(res.status).toBe(200);
    expect(res.json.leftovers).toEqual([
      { slug: "clown-car", title: "Clown Car" },
    ]);
  });

  it("refuses an event-day cartridge: it's for the box, and leaves out disabled Activities", async () => {
    const res = await upload(OWNER, EVENT_DAY, "circus-event-day.zip");
    expect(res.status).toBe(422);
    expect(res.json.error).toContain(
      'circus-event-day.zip: this is an "event-day" cartridge',
    );
    expect(count("event")).toBe(0);
  });

  it("names the file and each problem, and changes nothing", async () => {
    const res = await upload(OWNER, strToU8("not a zip"), "notes.txt");
    expect(res.status).toBe(422);
    expect(res.json.error).toBe(
      "notes.txt: not a zip file, so neither a cartridge nor a v1 export",
    );
    const empty = await upload(OWNER, zipSync({ "readme.txt": strToU8("hi") }));
    expect(empty.json.error).toBe(
      "upload.zip: no manifest.json (a cartridge) or camporee.json (a v1 export)",
    );
    expect(count("event")).toBe(0);
  });

  it("refuses a viewer, and a missing file", async () => {
    expect((await upload(VIEWER, DESIGN)).status).toBe(403);
    const response = await app.request(`/api/organizations/${org}/import`, {
      method: "POST",
      headers: { [DEV_USER_HEADER]: OWNER },
      body: new FormData(),
    });
    expect(response.status).toBe(400);
  });

  it("refuses documents that belong to another Organization", async () => {
    await upload(OWNER, DESIGN);
    const other = await call(OWNER, "POST", "/api/organizations", {
      name: "Elsewhere",
      slug: "elsewhere",
    });
    const res = await upload(
      OWNER,
      DESIGN,
      "circus-design.zip",
      (other.json as unknown as { id: string }).id,
    );
    expect(res.status).toBe(422);
    expect(res.json.error).toContain("belongs to another Organization");
  });
});
