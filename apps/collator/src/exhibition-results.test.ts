import { beforeEach, describe, expect, it } from "vitest";
import { scoreEvent } from "@camporee-conductor/scoring";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { exhibitionResultSaves } from "./db/schema.ts";
import { exhibitionResults } from "./exhibition-results.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadedEvent, loadEventCartridge } from "./load-event.ts";
import { scoringInput } from "./scoring-input.ts";
import {
  circusCartridge,
  CLOWN_CAR,
  DIRECTOR_EMAIL,
  testDb,
} from "./test-support.ts";

// Exhibition results (ADR-0027, #42 PR 7): an Official's whole-list saves per Exhibition, latest wins, stale refused.
// These are kept on the box and never reach packages/scoring.

const OFFICIAL = "lead.judge@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;
let archery: string;

beforeEach(() => {
  db = testDb();
  app = createApp({ db });
  const result = loadEventCartridge(db, circusCartridge());
  if (!result.ok) throw new Error(result.issues.join("\n"));
  const found = loadedEvent(db)?.bundle.activities.find(
    (a) => a.scoringType === "exhibition",
  );
  if (!found) throw new Error("no Exhibition in the fixture");
  archery = found.id;
});

const row = (participantName: string, place = "", extra = {}) => ({
  participantName,
  group: "",
  team: "",
  place,
  notes: "",
  ...extra,
});

const save = (
  id: string,
  rows: unknown[],
  replacesId: string | null = null,
  email: string | null = OFFICIAL,
  activityId = archery,
) =>
  app.request(`/api/official/exhibitions/${activityId}/saves/${id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(email === null ? {} : { [OFFICIAL_EMAIL_HEADER]: email }),
    },
    body: JSON.stringify({
      rows,
      replacesId,
      clientCreatedAt: "2027-05-15T10:00:00Z",
    }),
  });

const get = (activityId = archery, email = OFFICIAL) =>
  app.request(`/api/official/exhibitions/${activityId}`, {
    headers: { [OFFICIAL_EMAIL_HEADER]: email },
  });

describe("saving and reading an Exhibition's results", () => {
  it("is empty and not saved before the first save", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      activity: { id: archery, title: "William Tell No Apple" },
      rows: [],
      saveId: null,
      savedBy: null,
      savedAt: null,
      history: [],
    });
  });

  it("returns a save's rows in order, with who and when", async () => {
    const rows = [
      row("Sam Shooter", "2nd", { group: "Troop 7", notes: "close" }),
      row("Alex Archer", "1st"),
    ];
    expect((await save("save-1", rows)).status).toBe(201);
    const view = (await (await get()).json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      rows,
      saveId: "save-1",
      savedBy: OFFICIAL,
      history: [{ saveId: "save-1", by: OFFICIAL, rowCount: 2 }],
    });
    expect(typeof view["savedAt"]).toBe("string");
  });

  it("names the Official by name when the list has one", async () => {
    await save("save-1", [row("Alex Archer")], null, DIRECTOR_EMAIL);
    expect(await (await get()).json()).toMatchObject({
      savedBy: "Pat Director",
    });
  });

  it("trims the free text", async () => {
    await save("save-1", [row("  Alex Archer ", " 1st ", { team: " Owls " })]);
    expect(await (await get()).json()).toMatchObject({
      rows: [row("Alex Archer", "1st", { team: "Owls" })],
    });
  });

  it("makes a second save that replaces the first the current list, keeping both in history, newest first", async () => {
    await save("save-1", [row("Alex Archer", "1st")]);
    expect(
      (await save("save-2", [row("Sam Shooter"), row("Alex Archer")], "save-1"))
        .status,
    ).toBe(201);
    const view = (await (await get()).json()) as {
      rows: unknown[];
      saveId: string;
      history: { saveId: string; rowCount: number }[];
    };
    expect(view.saveId).toBe("save-2");
    expect(view.rows).toHaveLength(2);
    expect(view.history.map((h) => [h.saveId, h.rowCount])).toEqual([
      ["save-2", 2],
      ["save-1", 1],
    ]);
  });

  it("allows an empty list: it clears the results and is still a logged save", async () => {
    await save("save-1", [row("Alex Archer")]);
    expect((await save("save-2", [], "save-1")).status).toBe(201);
    const view = (await (await get()).json()) as {
      rows: unknown[];
      history: unknown[];
    };
    expect(view.rows).toEqual([]);
    expect(view.history).toHaveLength(2);
  });

  it("keeps each Exhibition's results apart", async () => {
    await save("save-1", [row("Alex Archer")]);
    const other = loadedEvent(db)?.bundle.activities.find(
      (a) => a.scoringType === "exhibition" && a.id !== archery,
    );
    if (!other) throw new Error("fixture has one Exhibition only");
    expect(await (await get(other.id)).json()).toMatchObject({ rows: [] });
  });
});

describe("refusals", () => {
  it("refuses a stale replacesId (409) and changes nothing", async () => {
    await save("save-1", [row("Alex Archer")]);
    await save("save-2", [row("Sam Shooter")], "save-1");
    const res = await save("save-3", [row("Lee Late")], "save-1");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error:
        "Another Official saved these results since you loaded them; reload and save again.",
    });
    expect(db.select().from(exhibitionResultSaves).all()).toHaveLength(2);
    expect(await (await get()).json()).toMatchObject({ saveId: "save-2" });
  });

  it("refuses a first save that claims to replace something (409)", async () => {
    expect((await save("save-1", [row("A")], "nothing")).status).toBe(409);
  });

  it("refuses a save with no replacesId when there already is one (409)", async () => {
    await save("save-1", [row("Alex Archer")]);
    expect((await save("save-2", [row("B")], null)).status).toBe(409);
  });

  it("treats resending the same id and content as a repeat (200)", async () => {
    const rows = [row("Alex Archer", "1st")];
    expect((await save("save-1", rows)).status).toBe(201);
    const again = await save("save-1", rows);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "repeat" });
    expect(db.select().from(exhibitionResultSaves).all()).toHaveLength(1);
  });

  it("answers a repeat even after another save has replaced it", async () => {
    const rows = [row("Alex Archer")];
    await save("save-1", rows);
    await save("save-2", [row("B")], "save-1");
    expect((await save("save-1", rows)).status).toBe(200);
  });

  it("refuses the same id with other content (409)", async () => {
    await save("save-1", [row("Alex Archer")]);
    expect((await save("save-1", [row("Someone Else")])).status).toBe(409);
  });

  it("refuses a ranked Activity (400), saying why", async () => {
    const res = await save("save-1", [row("A")], null, OFFICIAL, CLOWN_CAR.id);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/isn't an Exhibition/),
    });
    expect((await get(CLOWN_CAR.id)).status).toBe(400);
  });

  it("refuses an Activity that isn't in the Event (400 on a save, 404 on a read)", async () => {
    expect(
      (await save("save-1", [row("A")], null, OFFICIAL, "nope")).status,
    ).toBe(400);
    expect((await get("nope")).status).toBe(404);
  });

  it("refuses an empty name (400), naming the row number", async () => {
    const res = await save("save-1", [row("Alex"), row("  ")]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/row 2/i),
    });
    expect(db.select().from(exhibitionResultSaves).all()).toHaveLength(0);
  });

  it("refuses too many rows, and text that's too long (400)", async () => {
    const many = Array.from({ length: 501 }, (_, i) => row(`P${i}`));
    expect((await save("save-1", many)).status).toBe(400);
    expect((await save("save-2", [row("x".repeat(201))])).status).toBe(400);
    expect(
      (await save("save-3", [row("A", "", { notes: "n".repeat(1001) })]))
        .status,
    ).toBe(400);
    expect(
      (await save("save-4", [row("A", "", { notes: "n".repeat(1000) })]))
        .status,
    ).toBe(201);
  });

  it("refuses a body that isn't rows (400)", async () => {
    expect((await save("save-1", [{ participantName: "A" }])).status).toBe(400);
    expect((await save("save-1", [row("A", "", { extra: 1 })])).status).toBe(
      400,
    );
  });

  it("refuses an email that isn't on the Officials list (403) and no email (401)", async () => {
    expect(
      (await save("save-1", [row("A")], null, "alex@example.com")).status,
    ).toBe(403);
    expect((await save("save-1", [row("A")], null, null)).status).toBe(401);
    expect((await get(archery, "alex@example.com")).status).toBe(403);
    expect(db.select().from(exhibitionResultSaves).all()).toHaveLength(0);
  });
});

describe("the Overview and scoring", () => {
  const overview = async () =>
    (
      (await (
        await app.request("/api/official/event", {
          headers: { [OFFICIAL_EMAIL_HEADER]: OFFICIAL },
        })
      ).json()) as {
        activities: {
          id: string;
          scoringType: string;
          resultCount?: number;
        }[];
      }
    ).activities;

  it("shows each Activity's scoring type, and an Exhibition's result count", async () => {
    let activities = await overview();
    expect(activities.find((a) => a.id === CLOWN_CAR.id)).toMatchObject({
      scoringType: "ranked",
    });
    expect(
      activities.find((a) => a.id === CLOWN_CAR.id)?.resultCount,
    ).toBeUndefined();
    expect(activities.find((a) => a.id === archery)).toMatchObject({
      scoringType: "exhibition",
      resultCount: 0,
    });
    await save("save-1", [row("A"), row("B"), row("C")]);
    activities = await overview();
    expect(activities.find((a) => a.id === archery)?.resultCount).toBe(3);
    await save("save-2", [row("A")], "save-1");
    expect((await overview()).find((a) => a.id === archery)?.resultCount).toBe(
      1,
    );
  });

  it("leaves packages/scoring's results unchanged", async () => {
    const bundle = loadedEvent(db)?.bundle;
    if (!bundle) throw new Error("no Event");
    const before = JSON.stringify(scoreEvent(scoringInput(db, bundle)));
    await save("save-1", [row("Alex Archer", "1st")]);
    expect(JSON.stringify(scoreEvent(scoringInput(db, bundle)))).toBe(before);
  });

  it("reads through the module too", () => {
    const bundle = loadedEvent(db)?.bundle;
    if (!bundle) throw new Error("no Event");
    expect(exhibitionResults(db, bundle, archery)?.rows).toEqual([]);
    expect(exhibitionResults(db, bundle, "nope")).toBeUndefined();
  });
});
