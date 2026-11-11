import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { BackupConfig } from "./config.ts";
import { openDb, type Db } from "./db/open.ts";
import { currentEpoch } from "./epoch.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadedEvent, loadEventCartridge } from "./load-event.ts";
import { addOfficial } from "./officials.ts";
import { circusCartridge, CLOWN_CAR, DIRECTOR_EMAIL } from "./test-support.ts";

// Reset for rehearsals (#42 PR 8, ADR-0027): the Official types the Event's name, the box backs up first (or
// refuses), clears one transaction's worth, and appends a `reset` epoch.

const OFFICIAL = "lead.judge@example.com";
type Table =
  | "score_entries"
  | "activity_closures"
  | "judges"
  | "official_actions"
  | "exhibition_result_saves"
  | "exhibition_status_changes"
  | "groups"
  | "teams"
  | "roster_changes"
  | "event_documents"
  | "cartridge_loads"
  | "added_officials"
  | "award_label_saves";

let dir: string;
let stick: string;
let backup: BackupConfig;
let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collator-reset-"));
  stick = join(dir, "stick");
  mkdirSync(stick);
  backup = { dir: stick, everyMinutes: 5, keep: 10 };
  db = openDb(join(dir, "collator.db"));
  app = createApp({ db, backup });
});
afterEach(() => {
  db.$client.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = (table: Table) =>
  (db.$client.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number })
    .n;

const send = (method: string, path: string, body: unknown, email?: string) =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(email && { [OFFICIAL_EMAIL_HEADER]: email }),
    },
    body: JSON.stringify(body),
  });

/** Every kind of thing a reset clears or keeps, as phones and the laptop would make them. */
async function rehearsal() {
  const loaded = loadEventCartridge(db, circusCartridge());
  if (!loaded.ok) throw new Error(loaded.issues.join("\n"));
  addOfficial(db, { email: "added@example.com", role: "official" });
  await send("PUT", "/api/groups/g1", { name: "Troop 101" });
  await send("PUT", "/api/teams/t1", { groupId: "g1", name: "Owls" });
  const alex = { id: "j1", name: "Alex", email: "alex@example.com" };
  await send("PUT", "/api/scores/s1", {
    judge: alex,
    activityId: CLOWN_CAR.id,
    entrantId: "t1",
    values: { [CLOWN_CAR.ownField]: 5, [CLOWN_CAR.commonField]: 5 },
    phoneCreatedAt: "2027-05-15T09:30:00Z",
  });
  await send("PUT", "/api/closures/c1", {
    judge: alex,
    activityId: CLOWN_CAR.id,
    scoreIds: ["s1"],
    phoneCreatedAt: "2027-05-15T11:00:00Z",
  });
  expect(
    (
      await send(
        "PUT",
        "/api/official/actions/a1",
        {
          action: {
            type: "disqualify",
            activityId: CLOWN_CAR.id,
            entrantId: "t1",
            disqualified: true,
          },
          clientCreatedAt: "2027-05-15T12:00:00Z",
        },
        OFFICIAL,
      )
    ).status,
  ).toBe(201);
  const archery = loadedEvent(db)?.bundle.activities.find(
    (a) => a.scoringType === "exhibition",
  )?.id;
  expect(
    (
      await send(
        "PUT",
        `/api/official/exhibitions/${archery}/saves/x1`,
        {
          rows: [
            {
              participantName: "Sam",
              group: "",
              team: "",
              place: "1st",
              notes: "",
            },
          ],
          replacesId: null,
          clientCreatedAt: "2027-05-15T12:00:00Z",
        },
        OFFICIAL,
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await send(
        "PUT",
        `/api/official/exhibitions/${archery}/status/f1`,
        { final: true, saveId: "x1", clientCreatedAt: "2027-05-15T12:01:00Z" },
        OFFICIAL,
      )
    ).status,
  ).toBe(201);
  await send(
    "PUT",
    "/api/official/roster-changes/r1",
    {
      change: { type: "rename", kind: "team", id: "t1", name: "Night Owls" },
      clientCreatedAt: "2027-05-15T12:00:00Z",
    },
    OFFICIAL,
  );
  const label = (await (
    await send("GET", "/api/official/award-label", undefined, OFFICIAL)
  ).json()) as { label: unknown };
  expect(
    (
      await send(
        "PUT",
        "/api/official/award-label/l1",
        { label: label.label, clientCreatedAt: "2027-05-15T12:00:00Z" },
        OFFICIAL,
      )
    ).status,
  ).toBe(201);
  expect(count("score_entries")).toBe(1);
  expect(count("roster_changes")).toBe(1);
  expect(count("exhibition_status_changes")).toBe(1);
  expect(count("award_label_saves")).toBe(1);
}

const resetKeepsLabel = async (kind: "scores" | "full") => {
  await rehearsal();
  const title = loadedEvent(db)?.manifest.event.title ?? "";
  expect((await reset({ kind, confirm: title })).status).toBe(200);
  expect(count("award_label_saves")).toBe(1);
};

const reset = (body: unknown, email: string | null = OFFICIAL) =>
  send("POST", "/api/official/reset", body, email ?? undefined);

describe("POST /api/official/reset", () => {
  it("reset scores keeps the sticker label settings (setup, not results)", () =>
    resetKeepsLabel("scores"));

  it("full reset keeps the sticker label settings too", () =>
    resetKeepsLabel("full"));

  it("refuses a wrong confirmation with a 400 and changes nothing", async () => {
    await rehearsal();
    const epoch = currentEpoch(db).id;
    const res = await reset({ kind: "scores", confirm: "Some Other Event" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Type the Event's name to confirm.",
    });
    expect(count("score_entries")).toBe(1);
    expect(currentEpoch(db).id).toBe(epoch);
    expect(readdirSync(stick)).toEqual([]);
  });

  it("is for Officials only, like the rest of the Official view", async () => {
    await rehearsal();
    const res = await reset({ kind: "scores", confirm: "x" }, null);
    expect(res.status).toBe(401);
    expect(count("score_entries")).toBe(1);
  });

  it("refuses a bad kind", async () => {
    await rehearsal();
    expect((await reset({ kind: "everything", confirm: "x" })).status).toBe(
      400,
    );
  });

  it("with no backup folder, refuses with a 409 and changes nothing", async () => {
    await rehearsal();
    const bare = createApp({ db });
    const title = loadedEvent(db)?.manifest.event.title ?? "";
    const res = await bare.request("/api/official/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [OFFICIAL_EMAIL_HEADER]: OFFICIAL,
      },
      body: JSON.stringify({ kind: "scores", confirm: title }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toMatch(
      /^No backup could be taken \(.+\); nothing was reset\.$/,
    );
    expect(count("score_entries")).toBe(1);
    expect(currentEpoch(db).reason).toBe("created");
  });

  it("with a missing backup folder (stick not mounted), refuses and changes nothing", async () => {
    await rehearsal();
    rmSync(stick, { recursive: true });
    const title = loadedEvent(db)?.manifest.event.title ?? "";
    const res = await reset({ kind: "full", confirm: title });
    expect(res.status).toBe(409);
    expect(count("score_entries")).toBe(1);
    expect(count("groups")).toBe(1);
  });

  it("reset scores: backs up first, clears score data, keeps the roster, appends a reset epoch", async () => {
    await rehearsal();
    const event = loadedEvent(db)?.manifest.event;
    const before = currentEpoch(db);
    // The title or the slug works, in any case, with spaces around it.
    const res = await reset({
      kind: "scores",
      confirm: `  ${event?.title.toUpperCase()}  `,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      backup: string;
      epoch: { id: string; reason: string };
    };
    expect(readdirSync(stick)).toEqual([body.backup]);
    expect(body.backup).toMatch(/^collator-.*\.db$/);
    // The backup is the box as it was before the reset.
    const copy = new Database(join(stick, body.backup), { readonly: true });
    expect(
      (
        copy.prepare("SELECT count(*) n FROM score_entries").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    copy.close();

    for (const t of [
      "score_entries",
      "activity_closures",
      "judges",
      "official_actions",
      "exhibition_result_saves",
      "exhibition_status_changes",
    ] as const) {
      expect(count(t), t).toBe(0);
    }
    expect(count("groups")).toBe(1);
    expect(count("teams")).toBe(1);
    expect(count("roster_changes")).toBe(1);
    expect(count("event_documents")).toBeGreaterThan(0);
    expect(count("cartridge_loads")).toBe(1);
    expect(count("added_officials")).toBe(1);
    const now = currentEpoch(db);
    expect(now.reason).toBe("reset");
    expect(now.id).not.toBe(before.id);
    expect(body.epoch).toEqual({ id: now.id, reason: "reset" });
  });

  it("the slug confirms too", async () => {
    await rehearsal();
    const slug = loadedEvent(db)?.manifest.event.slug ?? "";
    expect((await reset({ kind: "scores", confirm: slug })).status).toBe(200);
  });

  it("full reset also clears Groups, Teams and the roster log", async () => {
    await rehearsal();
    const title = loadedEvent(db)?.manifest.event.title ?? "";
    expect((await reset({ kind: "full", confirm: title })).status).toBe(200);
    for (const t of [
      "score_entries",
      "activity_closures",
      "judges",
      "official_actions",
      "exhibition_result_saves",
      "exhibition_status_changes",
      "groups",
      "teams",
      "roster_changes",
    ] as const) {
      expect(count(t), t).toBe(0);
    }
    expect(currentEpoch(db).reason).toBe("reset");
  });

  it("leaves the cartridge loaded, and an added Official can still sign in", async () => {
    await rehearsal();
    const title = loadedEvent(db)?.manifest.event.title ?? "";
    expect((await reset({ kind: "full", confirm: title })).status).toBe(200);
    expect(loadedEvent(db)?.manifest.event.title).toBe(title);
    const me = await app.request("/api/official/me", {
      headers: { [OFFICIAL_EMAIL_HEADER]: "added@example.com" },
    });
    expect(me.status).toBe(200);
    expect((await app.request("/api/event")).status).toBe(200);
    expect(DIRECTOR_EMAIL).toBeTruthy();
  });

  it("the cartridge's tables are untouched and the epoch log only grows", async () => {
    await rehearsal();
    const title = loadedEvent(db)?.manifest.event.title ?? "";
    await reset({ kind: "scores", confirm: title });
    await reset({ kind: "scores", confirm: title });
    const reasons = (
      db.$client
        .prepare("SELECT reason FROM box_epochs ORDER BY seq")
        .all() as {
        reason: string;
      }[]
    ).map((r) => r.reason);
    expect(reasons).toEqual(["created", "reset", "reset"]);
    expect(existsSync(stick)).toBe(true);
  });
});
