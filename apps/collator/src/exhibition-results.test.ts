import { beforeEach, describe, expect, it } from "vitest";
import { scoreEvent } from "@camporee-conductor/scoring";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { exhibitionResultSaves, exhibitionStatusChanges } from "./db/schema.ts";
import { officialAwards } from "./awards.ts";
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

describe("Final and Draft (#43 PR 2)", () => {
  const status = (
    id: string,
    final: boolean,
    saveId: string | null,
    extra: { notes?: string; activityId?: string; email?: string } = {},
  ) =>
    app.request(
      `/api/official/exhibitions/${extra.activityId ?? archery}/status/${id}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [OFFICIAL_EMAIL_HEADER]: extra.email ?? OFFICIAL,
        },
        body: JSON.stringify({
          final,
          saveId,
          ...(extra.notes !== undefined && { notes: extra.notes }),
          clientCreatedAt: "2027-05-15T11:00:00Z",
        }),
      },
    );
  const view = async () =>
    (await (await get()).json()) as {
      final: {
        by: string;
        at: string;
        saveId: string | null;
        notes: string | null;
      } | null;
    };
  const bundleOf = () => {
    const b = loadedEvent(db)?.bundle;
    if (!b) throw new Error("no Event");
    return b;
  };

  it("is a draft until finalized", async () => {
    expect((await view()).final).toBeNull();
  });

  it("finalizes the loaded save (201), and the view says who, when and the notes", async () => {
    await save("save-1", [row("A", "1st")]);
    const res = await status("st-1", true, "save-1", { notes: "checked" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "created" });
    expect((await view()).final).toMatchObject({
      by: OFFICIAL,
      saveId: "save-1",
      notes: "checked",
    });
  });

  it("can finalize an Exhibition with nothing saved (saveId null)", async () => {
    expect((await status("st-1", true, null)).status).toBe(201);
    expect((await view()).final?.saveId).toBeNull();
  });

  it("treats the same id and content as a repeat (200), other content as a conflict (409)", async () => {
    await save("save-1", [row("A")]);
    await status("st-1", true, "save-1");
    expect((await status("st-1", true, "save-1")).status).toBe(200);
    expect((await status("st-1", true, "save-1", { notes: "x" })).status).toBe(
      409,
    );
    expect(db.select().from(exhibitionStatusChanges).all()).toHaveLength(1);
  });

  it("refuses a stale finalize (409) with the reload message", async () => {
    await save("save-1", [row("A")]);
    await save("save-2", [row("B")], "save-1");
    const res = await status("st-1", true, "save-1");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "New results were saved since you loaded this; reload and mark final again.",
    );
    expect((await status("st-2", true, null)).status).toBe(409);
  });

  it("refuses finalizing twice, and back to draft when already a draft (400)", async () => {
    expect((await status("d-0", false, null)).status).toBe(400);
    await status("st-1", true, null);
    const res = await status("st-2", true, null);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/final/i);
  });

  it("refuses an Activity that isn't an Exhibition or isn't in the Event (400)", async () => {
    expect(
      (await status("st-1", true, null, { activityId: CLOWN_CAR.id })).status,
    ).toBe(400);
    expect(
      (await status("st-2", true, null, { activityId: "nope" })).status,
    ).toBe(400);
  });

  it("refuses a save while final (409), but a repeat of an earlier save is still a repeat", async () => {
    await save("save-1", [row("A")]);
    await status("st-1", true, "save-1");
    const res = await save("save-2", [row("B")], "save-1");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(
      "These results are final; put them back to draft to change them.",
    );
    expect((await save("save-1", [row("A")])).status).toBe(200);
    expect(db.select().from(exhibitionResultSaves).all()).toHaveLength(1);
  });

  it("back to draft makes it a draft again and saves work", async () => {
    await save("save-1", [row("A")]);
    await status("st-1", true, "save-1");
    expect((await status("st-2", false, null)).status).toBe(201);
    expect((await view()).final).toBeNull();
    expect((await save("save-2", [row("B")], "save-1")).status).toBe(201);
    expect((await status("st-3", true, "save-2")).status).toBe(201);
  });

  it("shows Final or Draft in the Overview", async () => {
    const flag = async () =>
      (
        (await (
          await app.request("/api/official/event", {
            headers: { [OFFICIAL_EMAIL_HEADER]: OFFICIAL },
          })
        ).json()) as { activities: { id: string; final?: boolean }[] }
      ).activities;
    let all = await flag();
    expect(all.find((a) => a.id === archery)?.final).toBe(false);
    expect(all.find((a) => a.id === CLOWN_CAR.id)?.final).toBeUndefined();
    await status("st-1", true, null);
    all = await flag();
    expect(all.find((a) => a.id === archery)?.final).toBe(true);
  });

  describe("Awards", () => {
    const exhibitions = () =>
      bundleOf().activities.filter((a) => a.scoringType === "exhibition");

    it("counts Exhibitions and stays provisional while one is a draft", () => {
      const a = officialAwards(db, bundleOf());
      expect(a.exhibitionCount).toBe(exhibitions().length);
      expect(a.exhibitionFinalCount).toBe(0);
      expect(a.provisional).toBe(true);
    });

    it("lists only final Exhibitions, rows in the Official's order, after the registry groups", async () => {
      await save("save-1", [
        row("Zed", "2nd"),
        row("Amy", "1st", { notes: "n" }),
      ]);
      await status("st-1", true, "save-1");
      const a = officialAwards(db, bundleOf());
      expect(a.exhibitionFinalCount).toBe(1);
      const groups = a.sections.flatMap((s) => s.groups);
      const found = groups.filter((g) => g.kind === "exhibition");
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        id: archery,
        title: "William Tell No Apple",
        rows: [
          { participantName: "Zed", place: "2nd" },
          { participantName: "Amy", place: "1st", notes: "n" },
        ],
      });
      const section = a.sections.find((s) =>
        s.groups.some((g) => g === found[0]),
      );
      expect(section?.groups.at(-1)).toBe(found[0]);
      // back to draft: not listed
      await status("st-2", false, null);
      expect(
        officialAwards(db, bundleOf())
          .sections.flatMap((s) => s.groups)
          .some((g) => g.kind === "exhibition"),
      ).toBe(false);
    });

    it("is not provisional because of Exhibitions once all are final", async () => {
      for (const [i, e] of exhibitions().entries()) {
        await status(`st-${i}`, true, null, { activityId: e.id });
      }
      const a = officialAwards(db, bundleOf());
      expect(a.exhibitionFinalCount).toBe(a.exhibitionCount);
      // ranked Activities are still unfinalized here, so the Event stays provisional
      expect(a.provisional).toBe(true);
    });
  });
});
