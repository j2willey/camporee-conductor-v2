import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { scoreEntries } from "./db/schema.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadEventCartridge } from "./load-event.ts";
import { loggedActions } from "./official-actions.ts";
import {
  circusCartridge,
  CLOWN_CAR,
  DIRECTOR_EMAIL,
  editFields,
  HIGH_WIRE,
  testDb,
} from "./test-support.ts";

// The Official view (#40 PR 3): sign in with an email on the cartridge's Officials list (ADR-0027 item 5),
// then see each Activity's score entries and its ranking from packages/scoring. Read-only: edits, DQ,
// finalize and conflicts are #42.

const OFFICIAL = "lead.judge@example.com";
const ALEX = {
  id: "judge-alex",
  name: "Alex Judge",
  email: "alex@example.com",
};
/** Sam gave a home unit (#41 PR 5): a Group as typed, not a roster entry. */
const SAM = {
  id: "judge-sam",
  name: "Sam Judge",
  email: "sam@example.com",
  homeGroup: "Troop 7",
};

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = testDb();
  app = createApp({ db });
});

const put = (path: string, body: unknown) =>
  app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const asOfficial = (path: string, email: string | null = OFFICIAL) =>
  app.request(path, {
    headers: email === null ? {} : { [OFFICIAL_EMAIL_HEADER]: email },
  });

const load = () => {
  const result = loadEventCartridge(db, circusCartridge());
  if (!result.ok) throw new Error(result.issues.join("\n"));
};

/** Troop 101 with two Teams, and scores at Clown Car as Judges' phones would send them. */
async function withScores() {
  load();
  await put("/api/groups/group-1", { name: "Troop 101" });
  await put("/api/teams/team-1", {
    groupId: "group-1",
    name: "Flaming Arrows",
  });
  await put("/api/teams/team-2", { groupId: "group-1", name: "Owls" });
  const score = (
    id: string,
    judge: typeof ALEX | typeof SAM,
    entrantId: string,
    clowns: number,
  ) =>
    put(`/api/scores/${id}`, {
      judge,
      activityId: CLOWN_CAR.id,
      entrantId,
      values: { [CLOWN_CAR.ownField]: clowns, [CLOWN_CAR.commonField]: 5 },
      phoneCreatedAt: "2027-05-15T09:30:00Z",
    });
  expect((await score("score-1", ALEX, "team-1", 9)).status).toBe(201);
  expect((await score("score-2", ALEX, "team-2", 3)).status).toBe(201);
  // Sam scores the Owls again, later: the newest received counts (ADR-0027 item 9).
  expect((await score("score-3", SAM, "team-2", 4)).status).toBe(201);
}

describe("signing in as an Official: an email-only gate (ADR-0027 item 5)", () => {
  beforeEach(load);

  it("knows a listed Official by email", async () => {
    const res = await asOfficial("/api/official/me", DIRECTOR_EMAIL);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: DIRECTOR_EMAIL,
      name: "Pat Director",
      role: "director",
    });
  });

  it("ignores case and spaces around the email", async () => {
    const res = await asOfficial(
      "/api/official/me",
      "  Lead.Judge@Example.COM ",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      email: OFFICIAL,
      role: "official",
    });
  });

  it("refuses an email that isn't on the Officials list (403), saying so plainly", async () => {
    const res = await asOfficial("/api/official/me", "alex@example.com");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/isn't on this Event's list of Officials/),
    });
  });

  it("refuses a call with no email (401)", async () => {
    expect((await asOfficial("/api/official/me", null)).status).toBe(401);
    expect((await asOfficial("/api/official/me", "  ")).status).toBe(401);
  });

  it("checks the email on every Official call, not only at sign-in", async () => {
    for (const path of [
      "/api/official/event",
      `/api/official/activities/${CLOWN_CAR.id}`,
    ]) {
      expect((await asOfficial(path, null)).status).toBe(401);
      expect((await asOfficial(path, "alex@example.com")).status).toBe(403);
      expect((await asOfficial(path)).status).toBe(200);
    }
  });
});

it("refuses Official calls before a cartridge is loaded (409)", async () => {
  expect((await asOfficial("/api/official/me")).status).toBe(409);
});

describe("GET /api/official/event: the Activities to pick from", () => {
  beforeEach(withScores);

  it("lists every Activity with how many score entries it has, and the pack's labels", async () => {
    const res = await asOfficial("/api/official/event");
    const body = (await res.json()) as {
      event: { title: string; labels: { team: string; group: string } };
      activities: {
        id: string;
        title: string;
        competition: { label: string; level: string };
        entryCount: number;
      }[];
    };
    expect(body.event.labels).toEqual({ team: "Patrol", group: "Troop" });
    const clownCar = body.activities.find((a) => a.id === CLOWN_CAR.id);
    expect(clownCar).toMatchObject({
      title: "Clown Car",
      competition: { label: "Patrol Games", level: "team" },
      entryCount: 3,
    });
    expect(body.activities.length).toBeGreaterThan(10);
    expect(
      body.activities
        .filter((a) => a.id !== CLOWN_CAR.id)
        .map((a) => a.entryCount),
    ).toEqual(expect.arrayContaining([0]));
  });

  const clownCar = async () => {
    const res = await asOfficial("/api/official/event");
    const body = (await res.json()) as {
      activities: {
        id: string;
        entrantsScored: number;
        judges: number;
        conflicts: number;
        lastReceivedAt: string | null;
      }[];
    };
    return body.activities;
  };

  it("counts distinct entrants and Judges, and flags an entrant scored by two Judges", async () => {
    const activities = await clownCar();
    // Alex scored two Teams; Sam scored the Owls again: 2 entrants, 2 Judges, 1 conflict (item 9).
    expect(activities.find((a) => a.id === CLOWN_CAR.id)).toMatchObject({
      entrantsScored: 2,
      judges: 2,
      conflicts: 1,
    });
  });

  it("does not call one Judge scoring an entrant again a conflict: that's a correction", async () => {
    await put("/api/scores/score-4", {
      judge: ALEX,
      activityId: CLOWN_CAR.id,
      entrantId: "team-1",
      values: { [CLOWN_CAR.ownField]: 10, [CLOWN_CAR.commonField]: 5 },
      phoneCreatedAt: "2027-05-15T09:40:00Z",
    });
    const found = (await clownCar()).find((a) => a.id === CLOWN_CAR.id);
    expect(found).toMatchObject({
      entrantsScored: 2,
      judges: 2,
      conflicts: 1,
    });
  });

  it("is lastReceivedAt for the newest entry, and null where nothing is scored", async () => {
    const activities = await clownCar();
    const at = activities.find((a) => a.id === CLOWN_CAR.id)?.lastReceivedAt;
    expect(Number.isNaN(Date.parse(at ?? ""))).toBe(false);
    const empty = activities.find((a) => a.id !== CLOWN_CAR.id);
    expect(empty).toMatchObject({
      entrantsScored: 0,
      judges: 0,
      conflicts: 0,
      lastReceivedAt: null,
    });
  });
});

interface OfficialActivity {
  activity: { id: string; title: string };
  fields: { id: string; label: string; type: string; options?: string[] }[];
  matrix: MatrixRow[];
  entries: {
    id: string;
    receivedSeq: number;
    judge: { name: string; homeGroup?: string };
    entrantId: string;
    entrant: { name: string | null; group: string | null };
    values: Record<string, unknown>;
    phoneCreatedAt: string;
    counts: boolean;
  }[];
}

describe("GET /api/official/activities/:id: one Activity's entries and ranking", () => {
  beforeEach(withScores);

  const clownCar = async (): Promise<OfficialActivity> => {
    const res = await asOfficial(`/api/official/activities/${CLOWN_CAR.id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as OfficialActivity;
  };

  it("ranks the entrants with packages/scoring, best first, using the newest entry for each", async () => {
    const { matrix } = await clownCar();
    // Flaming Arrows: 9 clowns + 5 flag; the Owls: Sam's newer 4 + 5, not Alex's 3 + 5.
    expect(
      matrix.map((r) => [r.entrantId, r.entrant, r.place, r.total]),
    ).toEqual([
      ["team-1", { name: "Flaming Arrows", group: "Troop 101" }, 1, 14],
      ["team-2", { name: "Owls", group: "Troop 101" }, 2, 9],
    ]);
  });

  it("lists every score entry received, in order, with the Judge's name and which entry counts", async () => {
    const { entries } = await clownCar();
    expect(
      entries.map((e) => [e.id, e.judge.name, e.entrant.name, e.counts]),
    ).toEqual([
      ["score-1", "Alex Judge", "Flaming Arrows", true],
      ["score-2", "Alex Judge", "Owls", false],
      ["score-3", "Sam Judge", "Owls", true],
    ]);
    expect(entries[0]).toMatchObject({
      values: { [CLOWN_CAR.ownField]: 9, [CLOWN_CAR.commonField]: 5 },
      phoneCreatedAt: "2027-05-15T09:30:00Z",
    });
    const seqs = entries.map((e) => e.receivedSeq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("names the Judge's home unit when they gave one, for thank-you notes", async () => {
    const { entries } = await clownCar();
    expect(entries.map((e) => e.judge)).toEqual([
      { name: "Alex Judge" },
      { name: "Alex Judge" },
      { name: "Sam Judge", homeGroup: "Troop 7" },
    ]);
  });

  it("keeps the home unit from a Judge's newest score: a corrected one replaces it", async () => {
    await put("/api/scores/score-4", {
      judge: { ...SAM, homeGroup: "Troop 77" },
      activityId: CLOWN_CAR.id,
      entrantId: "team-1",
      values: { [CLOWN_CAR.ownField]: 1, [CLOWN_CAR.commonField]: 5 },
      phoneCreatedAt: "2027-05-15T10:30:00Z",
    });
    const { entries } = await clownCar();
    expect(entries.find((e) => e.id === "score-3")?.judge).toEqual({
      name: "Sam Judge",
      homeGroup: "Troop 77",
    });
  });

  it("doesn't serve Judges' emails", async () => {
    const res = await asOfficial(`/api/official/activities/${CLOWN_CAR.id}`);
    expect(await res.text()).not.toMatch(/example\.com/);
  });

  it("names the fields, Common Fields included, so values can be shown by label", async () => {
    const { fields } = await clownCar();
    expect(fields).toEqual(
      expect.arrayContaining([
        {
          id: CLOWN_CAR.ownField,
          label: "Big Top Cruiser Clowns",
          type: "number",
        },
        { id: CLOWN_CAR.commonField, label: "Patrol Flag", type: "number" },
      ]),
    );
  });

  it("gives a select field's options, so the laptop can show the right input", async () => {
    const selectDb = testDb();
    const selectApp = createApp({ db: selectDb });
    const loaded = loadEventCartridge(
      selectDb,
      circusCartridge({
        editActivity: editFields(CLOWN_CAR.id, (fields) => [
          ...fields,
          {
            id: "size",
            label: "Size",
            type: "select",
            kind: "info",
            audience: "judge",
            sortOrder: 99,
            weight: 1,
            config: { options: ["small", "large"] },
          },
        ]),
      }),
    );
    expect(loaded.ok).toBe(true);
    const res = await selectApp.request(
      `/api/official/activities/${CLOWN_CAR.id}`,
      { headers: { [OFFICIAL_EMAIL_HEADER]: OFFICIAL } },
    );
    const { fields } = (await res.json()) as OfficialActivity;
    expect(fields.find((f) => f.id === "size")).toEqual({
      id: "size",
      label: "Size",
      type: "select",
      options: ["small", "large"],
    });
  });

  it("is 404 for an Activity the Event doesn't have", async () => {
    const res = await asOfficial(
      "/api/official/activities/0196cfa2-4c00-7000-8000-0000000000ff",
    );
    expect(res.status).toBe(404);
  });
});

interface MatrixRow {
  entrantId: string;
  entrant: { name: string | null; group: string | null };
  scored: boolean;
  place: number | null;
  total: number | null;
  disqualified: boolean;
  dq: { by: string; at: string; notes?: string } | null;
  onRoster: boolean;
  entryId: string | null;
  values: Record<string, unknown> | null;
  corrections: Record<
    string,
    {
      original: unknown;
      by: string;
      at: string;
      notes?: string;
      warning?: string;
    }
  >;
  superseded: {
    entryId: string;
    fieldId: string;
    label: string;
    value: unknown;
    by: string;
    at: string;
    notes?: string;
  }[];
  judge: { name: string; homeGroup?: string } | null;
  receivedAt: string | null;
  entryCount: number;
  conflict: boolean;
  judges: { name: string; homeGroup?: string }[];
}

describe("GET /api/official/activities/:id: the score matrix (#42 PR 2a)", () => {
  beforeEach(async () => {
    await withScores();
    // A third Team nobody has scored.
    await put("/api/teams/team-3", { groupId: "group-1", name: "Night Owls" });
    await put("/api/groups/group-2", { name: "Troop 202" });
  });

  const view = async (id = CLOWN_CAR.id) => {
    const res = await asOfficial(`/api/official/activities/${id}`);
    expect(res.status).toBe(200);
    return (await res.json()) as OfficialActivity & { matrix: MatrixRow[] };
  };

  it("has one row per Team of the Competition, unscored ones included, with nothing filled in", async () => {
    const { matrix } = await view();
    expect(matrix.map((r) => r.entrantId).sort()).toEqual([
      "team-1",
      "team-2",
      "team-3",
    ]);
    expect(matrix.find((r) => r.entrantId === "team-3")).toMatchObject({
      scored: false,
      place: null,
      total: null,
      values: null,
      judge: null,
      receivedAt: null,
      entryCount: 0,
      conflict: false,
      judges: [],
    });
  });

  it("lists the scored rows in ranking order with the ranking's place and total, then unscored in roster order", async () => {
    const { matrix } = await view();
    const scored = matrix.filter((r) => r.scored);
    expect(scored.map((r) => [r.entrantId, r.place, r.total])).toEqual([
      ["team-1", 1, 14],
      ["team-2", 2, 9],
    ]);
    expect(matrix.map((r) => r.scored)).toEqual([true, true, false]);
  });

  it("shows the newest entry's values when one Judge scored again: more versions, not a conflict", async () => {
    const again = await put("/api/scores/score-4", {
      judge: ALEX,
      activityId: CLOWN_CAR.id,
      entrantId: "team-1",
      values: { [CLOWN_CAR.ownField]: 8, [CLOWN_CAR.commonField]: 5 },
      phoneCreatedAt: "2027-05-15T09:40:00Z",
    });
    expect(again.status).toBe(201);
    const row = (await view()).matrix.find((r) => r.entrantId === "team-1");
    expect(row).toMatchObject({
      entryCount: 2,
      conflict: false,
      total: 13,
      values: { [CLOWN_CAR.ownField]: 8, [CLOWN_CAR.commonField]: 5 },
      judge: { name: "Alex Judge" },
      judges: [{ name: "Alex Judge" }],
    });
    expect(Number.isNaN(Date.parse(row?.receivedAt ?? ""))).toBe(false);
  });

  it("marks an entrant two Judges scored a conflict, lists both, and shows the newer entry", async () => {
    const row = (await view()).matrix.find((r) => r.entrantId === "team-2");
    expect(row).toMatchObject({
      conflict: true,
      entryCount: 2,
      values: { [CLOWN_CAR.ownField]: 4, [CLOWN_CAR.commonField]: 5 },
      judge: { name: "Sam Judge", homeGroup: "Troop 7" },
      judges: [
        { name: "Alex Judge" },
        { name: "Sam Judge", homeGroup: "Troop 7" },
      ],
    });
    const other = (await view()).matrix.find((r) => r.entrantId === "team-1");
    expect(other?.conflict).toBe(false);
  });

  it("has Groups as the rows of a group-level Competition", async () => {
    const group = "01a18a1b-3000-7c87-9082-21de7512b1ac";
    const { matrix } = await view(group);
    expect(matrix.map((r) => r.entrantId).sort()).toEqual([
      "group-1",
      "group-2",
    ]);
    expect(matrix.every((r) => !r.scored)).toBe(true);
    expect(matrix.map((r) => r.entrant.name)).toEqual([
      "Troop 101",
      "Troop 202",
    ]);
  });

  it("serves no Judge email anywhere in the matrix", async () => {
    const res = await asOfficial(`/api/official/activities/${CLOWN_CAR.id}`);
    expect(await res.text()).not.toMatch(/@example\.com/);
  });
});

describe("PUT /api/official/actions/:id: DQ and reinstate (#42 PR 2b)", () => {
  beforeEach(withScores);

  const dqBody = (entrantId: string, disqualified = true, notes?: string) => ({
    action: {
      type: "disqualify",
      activityId: CLOWN_CAR.id,
      entrantId,
      disqualified,
      ...(notes !== undefined && { notes }),
    },
    clientCreatedAt: "2027-05-15T10:00:00Z",
  });

  const act = (
    id: string,
    body: unknown,
    email: string | null = DIRECTOR_EMAIL,
  ) =>
    app.request(`/api/official/actions/${id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        ...(email === null ? {} : { [OFFICIAL_EMAIL_HEADER]: email }),
      },
      body: JSON.stringify(body),
    });

  const matrix = async (): Promise<MatrixRow[]> => {
    const res = await asOfficial(
      `/api/official/activities/${CLOWN_CAR.id}`,
      DIRECTOR_EMAIL,
    );
    return ((await res.json()) as { matrix: MatrixRow[] }).matrix;
  };
  const row = async (id: string) =>
    (await matrix()).find((r) => r.entrantId === id);

  it("DQs a scored entrant: the row shows who and when, and the next entrant moves up", async () => {
    const res = await act("act-1", dqBody("team-1", true, "Left early"));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ status: "created" });
    expect(await row("team-1")).toMatchObject({
      disqualified: true,
      place: null,
      dq: { by: "Pat Director", notes: "Left early" },
    });
    expect(Number.isNaN(Date.parse((await row("team-1"))?.dq?.at ?? ""))).toBe(
      false,
    );
    expect(await row("team-2")).toMatchObject({ place: 1, dq: null });
    expect((await matrix()).map((r) => r.entrantId)).toEqual([
      "team-2",
      "team-1",
    ]);
  });

  it("names an Official with no name by their email", async () => {
    await act("act-1", dqBody("team-1"), OFFICIAL);
    expect((await row("team-1"))?.dq?.by).toBe(OFFICIAL);
  });

  it("reinstates with a later disqualified: false (the latest wins), and the place comes back", async () => {
    await act("act-1", dqBody("team-1"));
    expect((await act("act-2", dqBody("team-1", false))).status).toBe(201);
    expect(await row("team-1")).toMatchObject({
      disqualified: false,
      place: 1,
      dq: null,
    });
    expect(await row("team-2")).toMatchObject({ place: 2 });
  });

  it("answers a resend of the same id and body 200 repeat, and a different body with that id 409", async () => {
    await act("act-1", dqBody("team-1"));
    const again = await act("act-1", dqBody("team-1"));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "repeat" });
    expect((await act("act-1", dqBody("team-2"))).status).toBe(409);
    expect((await act("act-1", dqBody("team-1", false))).status).toBe(409);
  });

  it.each([
    ["an unknown Activity", { activityId: "no-such-activity" }],
    ["an entrant not on the roster", { entrantId: "ghost" }],
  ])("refuses %s (400) and says why", async (_name, change) => {
    const body = dqBody("team-1");
    const res = await act("act-1", {
      ...body,
      action: { ...body.action, ...change },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/disqualify: .*left out/),
    });
    expect((await row("team-1"))?.disqualified).toBe(false);
  });

  it("refuses an entrant of another Competition (a Group at a Team-level Activity)", async () => {
    const res = await act("act-1", dqBody("group-1"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/isn't in Competition/),
    });
  });

  it("refuses an action type other than disqualify, and a disqualify with no Activity (400)", async () => {
    const other = await act("act-1", {
      action: {
        type: "adjust-points",
        activityId: CLOWN_CAR.id,
        entrantId: "team-1",
        points: 5,
      },
      clientCreatedAt: "2027-05-15T10:00:00Z",
    });
    expect(other.status).toBe(400);
    expect(await other.text()).toMatch(/\S/);
    const body = dqBody("team-1");
    const noActivity = Object.fromEntries(
      Object.entries(body.action).filter(([key]) => key !== "activityId"),
    );
    const overall = await act("act-2", { ...body, action: noActivity });
    expect(overall.status).toBe(400);
    expect(await overall.text()).toMatch(/\S/);
  });

  it("keeps out an email that isn't on the Officials list (403) and logs nothing", async () => {
    const res = await act("act-1", dqBody("team-1"), "alex@example.com");
    expect(res.status).toBe(403);
    expect((await act("act-2", dqBody("team-1"), null)).status).toBe(401);
    expect((await row("team-1"))?.disqualified).toBe(false);
    expect(loggedActions(db)).toEqual([]);
  });

  it("logs who, when and exactly what; never touches a Judge's score entry", async () => {
    const before = (await (
      await asOfficial(
        `/api/official/activities/${CLOWN_CAR.id}`,
        DIRECTOR_EMAIL,
      )
    ).json()) as OfficialActivity;
    await act("act-1", dqBody("team-1", true, "Left early"));
    await act("act-2", dqBody("team-1", false));
    expect(loggedActions(db).map((a) => [a.id, a.officialEmail])).toEqual([
      ["act-1", DIRECTOR_EMAIL],
      ["act-2", DIRECTOR_EMAIL],
    ]);
    expect(loggedActions(db)[0]?.action).toEqual(
      dqBody("team-1", true, "Left early").action,
    );
    const after = (await (
      await asOfficial(
        `/api/official/activities/${CLOWN_CAR.id}`,
        DIRECTOR_EMAIL,
      )
    ).json()) as OfficialActivity;
    expect(after.entries).toEqual(before.entries);
  });
});

describe("PUT /api/official/actions/:id: an Official corrects a field (#42 PR 3)", () => {
  beforeEach(withScores);

  // Scores: Flaming Arrows (score-1) 9 clowns + flag 5 = 14, 1st; Owls (score-3, Sam's, the newest) 4 + 5 = 9, 2nd.
  const FLAG = CLOWN_CAR.commonField;
  const CLOWNS = CLOWN_CAR.ownField;
  const body = (action: Record<string, unknown>) => ({
    action: { activityId: CLOWN_CAR.id, entrantId: "team-1", ...action },
    clientCreatedAt: "2027-05-15T10:00:00Z",
  });
  const setField = (
    entryId: string,
    fieldId: string,
    value: unknown,
    more: Record<string, unknown> = {},
  ) => body({ type: "set-field-value", entryId, fieldId, value, ...more });
  const revertField = (entryId: string, fieldId: string) =>
    body({ type: "revert-field-value", entryId, fieldId });

  const act = (id: string, payload: unknown) =>
    app.request(`/api/official/actions/${id}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        [OFFICIAL_EMAIL_HEADER]: DIRECTOR_EMAIL,
      },
      body: JSON.stringify(payload),
    });
  const view = async () =>
    (await (
      await asOfficial(
        `/api/official/activities/${CLOWN_CAR.id}`,
        DIRECTOR_EMAIL,
      )
    ).json()) as OfficialActivity;
  const row = async (id: string) =>
    (await view()).matrix.find((r) => r.entrantId === id);

  it("changes the row's value, total and place, and shows the original, who and why", async () => {
    const res = await act(
      "fix-1",
      setField("score-1", CLOWNS, 2, { notes: "Recount" }),
    );
    expect(res.status).toBe(201);
    expect(await row("team-1")).toMatchObject({
      entryId: "score-1",
      values: { [CLOWNS]: 2, [FLAG]: 5 },
      total: 7,
      place: 2,
      corrections: {
        [CLOWNS]: { original: 9, by: "Pat Director", notes: "Recount" },
      },
      superseded: [],
    });
    expect(await row("team-2")).toMatchObject({ place: 1, total: 9 });
  });

  it("a revert restores the Judge's value, total and place", async () => {
    await act("fix-1", setField("score-1", CLOWNS, 2));
    expect((await act("fix-2", revertField("score-1", CLOWNS))).status).toBe(
      201,
    );
    expect(await row("team-1")).toMatchObject({
      values: { [CLOWNS]: 9 },
      total: 14,
      place: 1,
      corrections: {},
    });
  });

  it("accepts a value outside the field's range, with a warning on the correction", async () => {
    const res = await act("fix-1", setField("score-1", FLAG, 7));
    expect(res.status).toBe(201);
    const found = await row("team-1");
    expect(found?.total).toBe(16);
    expect(found?.corrections[FLAG]).toMatchObject({
      original: 5,
      warning: "Patrol Flag must be from 0 to 5",
    });
    expect(found?.corrections[CLOWNS]).toBeUndefined();
  });

  it("refuses an entry id the box doesn't have, or that is for another entrant or Activity (400)", async () => {
    await put("/api/scores/score-hw", {
      judge: ALEX,
      activityId: HIGH_WIRE.id,
      entrantId: "team-1",
      values: { [HIGH_WIRE.judgeField]: 1 },
      phoneCreatedAt: "2027-05-15T09:30:00Z",
    });
    for (const entryId of ["score-99", "score-2", "score-hw"]) {
      const res = await act(`fix-${entryId}`, setField(entryId, CLOWNS, 2));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.stringMatching(/\S/) });
    }
    expect((await act("fix-r", revertField("score-99", CLOWNS))).status).toBe(
      400,
    );
    expect(loggedActions(db)).toEqual([]);
  });

  it("refuses an unknown field and a non-number on a number field (400)", async () => {
    const unknown = await act("fix-1", setField("score-1", "nope", 2));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      error: expect.stringMatching(/no field nope/),
    });
    const text = await act("fix-2", setField("score-1", CLOWNS, "lots"));
    expect(text.status).toBe(400);
    expect(await text.json()).toEqual({
      error: expect.stringMatching(/must be a number/),
    });
    expect(loggedActions(db)).toEqual([]);
  });

  it("refuses notes that are only spaces, for a correction and a DQ (400)", async () => {
    expect(
      (await act("fix-1", setField("score-1", CLOWNS, 2, { notes: "   " })))
        .status,
    ).toBe(400);
    expect(
      (
        await act(
          "dq-1",
          body({ type: "disqualify", disqualified: true, notes: "  " }),
        )
      ).status,
    ).toBe(400);
    expect(loggedActions(db)).toEqual([]);
  });

  it("a newer entry for the entrant supersedes the correction; dismissing it empties the list", async () => {
    await act("fix-1", setField("score-1", CLOWNS, 2, { notes: "Recount" }));
    const entriesBefore = (await view()).entries;
    expect(
      (
        await put("/api/scores/score-4", {
          judge: ALEX,
          activityId: CLOWN_CAR.id,
          entrantId: "team-1",
          values: { [CLOWNS]: 6, [FLAG]: 5 },
          phoneCreatedAt: "2027-05-15T09:50:00Z",
        })
      ).status,
    ).toBe(201);
    const found = await row("team-1");
    expect(found).toMatchObject({
      entryId: "score-4",
      values: { [CLOWNS]: 6, [FLAG]: 5 },
      total: 11,
      corrections: {},
      superseded: [
        {
          entryId: "score-1",
          fieldId: CLOWNS,
          label: "Big Top Cruiser Clowns",
          value: 2,
          by: "Pat Director",
          notes: "Recount",
        },
      ],
    });
    // The Judge's entries are kept as entered.
    expect((await view()).entries.slice(0, entriesBefore.length)).toEqual(
      entriesBefore.map((e) => ({ ...e, counts: e.id === "score-3" })),
    );
    await act("fix-2", revertField("score-1", CLOWNS));
    expect((await row("team-1"))?.superseded).toEqual([]);
  });

  it("never touches the Judge's entry, and a resend of the same id is a repeat", async () => {
    const before = (await view()).entries;
    const payload = setField("score-1", CLOWNS, 2);
    expect((await act("fix-1", payload)).status).toBe(201);
    const again = await act("fix-1", payload);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: "repeat" });
    expect(loggedActions(db)).toHaveLength(1);
    expect((await view()).entries).toEqual(before);
  });
});

describe("the matrix shows an entry whose entrant isn't on the roster (#42 PR 2b)", () => {
  it("gives it its own row after the unscored ones: not on the roster, no place, no total", async () => {
    await withScores();
    await put("/api/teams/team-3", { groupId: "group-1", name: "Night Owls" });
    db.insert(scoreEntries)
      .values({
        id: "score-ghost",
        judgeId: ALEX.id,
        activityId: CLOWN_CAR.id,
        entrantId: "ghost-team",
        values: JSON.stringify({ [CLOWN_CAR.ownField]: 7 }),
        phoneCreatedAt: "2027-05-15T09:50:00Z",
        receivedAt: new Date(),
      })
      .run();
    const res = await asOfficial(`/api/official/activities/${CLOWN_CAR.id}`);
    const { matrix } = (await res.json()) as { matrix: MatrixRow[] };
    expect(matrix.map((r) => r.entrantId)).toEqual([
      "team-1",
      "team-2",
      "team-3",
      "ghost-team",
    ]);
    expect(matrix.map((r) => r.onRoster)).toEqual([true, true, true, false]);
    expect(matrix[3]).toMatchObject({
      scored: true,
      place: null,
      total: null,
      disqualified: false,
      values: { [CLOWN_CAR.ownField]: 7 },
      judge: { name: "Alex Judge" },
      entryCount: 1,
      conflict: false,
      entrant: { name: null, group: null },
    });
  });
});

describe("the page's own paths, such as /official, get the web app", () => {
  it("serves index.html for a deep link when the built app is served", async () => {
    const webRoot = mkdtempSync(join(tmpdir(), "collator-web-"));
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(
      join(webRoot, "index.html"),
      "<!doctype html><title>Collator</title>",
    );
    const served = createApp({ db, webRoot });
    for (const path of ["/", "/official"]) {
      const res = await served.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toMatch(/<title>Collator<\/title>/);
    }
    // An API path is never answered with the page.
    expect((await served.request("/api/nothing")).status).toBe(404);
  });
});
