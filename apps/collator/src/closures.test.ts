import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadEventCartridge } from "./load-event.ts";
import { circusCartridge, CLOWN_CAR, testDb } from "./test-support.ts";

// Close Game (#41 PR 6): a Judge who's done at an Activity closes it. The phone sends the ids of every
// score it saved there; the box says whether it has them all. Officials see each Judge's closure, any
// scores missing, and a Judge who scored again after closing (that reopens it).

let db: Db;
let app: ReturnType<typeof createApp>;

const ALEX = {
  id: "judge-alex",
  name: "Alex Judge",
  email: "alex@example.com",
};
const SAM = { id: "judge-sam", name: "Sam Judge", email: "sam@example.com" };

const put = (path: string, body: unknown) =>
  app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const score = (id: string, judge = ALEX, entrantId = "team-1") =>
  put(`/api/scores/${id}`, {
    judge,
    activityId: CLOWN_CAR.id,
    entrantId,
    values: { [CLOWN_CAR.ownField]: 5, [CLOWN_CAR.commonField]: 5 },
    phoneCreatedAt: "2027-05-15T09:30:00Z",
  });

const close = (id: string, scoreIds: string[], judge = ALEX) =>
  put(`/api/closures/${id}`, {
    judge,
    activityId: CLOWN_CAR.id,
    scoreIds,
    phoneCreatedAt: "2027-05-15T11:00:00Z",
  });

interface Closure {
  judge: { name: string; homeGroup?: string };
  scoreCount: number;
  missing: string[];
  scoredSince: number;
  phoneCreatedAt: string;
}

const officialClosures = async (): Promise<Closure[]> => {
  const res = await app.request(`/api/official/activities/${CLOWN_CAR.id}`, {
    headers: { [OFFICIAL_EMAIL_HEADER]: "lead.judge@example.com" },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { closures: Closure[] }).closures;
};

beforeEach(async () => {
  db = testDb();
  app = createApp({ db });
  const loaded = loadEventCartridge(db, circusCartridge());
  if (!loaded.ok) throw new Error(loaded.issues.join("\n"));
  await put("/api/groups/group-1", { name: "Troop 101" });
  await put("/api/teams/team-1", { groupId: "group-1", name: "Owls" });
  await put("/api/teams/team-2", { groupId: "group-1", name: "Hawks" });
});

describe("PUT /api/closures/:id: a Judge closes an Activity", () => {
  it("confirms the box has every score the phone sent", async () => {
    await score("s-1");
    await score("s-2", ALEX, "team-2");
    const res = await close("c-1", ["s-1", "s-2"]);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      status: "created",
      have: 2,
      missing: [],
    });
  });

  it("names the scores the box doesn't have", async () => {
    await score("s-1");
    const res = await close("c-1", ["s-1", "s-lost"]);
    expect(await res.json()).toEqual({
      status: "created",
      have: 1,
      missing: ["s-lost"],
    });
  });

  it("is safe to resend: the same closure is a repeat, answered the same way", async () => {
    await score("s-1");
    await close("c-1", ["s-1"]);
    const res = await close("c-1", ["s-1"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "repeat",
      have: 1,
      missing: [],
    });
  });

  it("refuses the same id with different content, and an Activity the Event doesn't have", async () => {
    await close("c-1", []);
    expect((await close("c-1", ["s-9"])).status).toBe(409);
    const unknown = await put("/api/closures/c-2", {
      judge: ALEX,
      activityId: "no-such-activity",
      scoreIds: [],
      phoneCreatedAt: "2027-05-15T11:00:00Z",
    });
    expect(unknown.status).toBe(400);
  });
});

describe("the Official view shows each Judge's closure", () => {
  it("lists the newest closure per Judge, with the count and anything missing", async () => {
    await score("s-1");
    await score("s-2", SAM, "team-2");
    await close("c-1", ["s-1", "s-gone"]);
    await close("c-2", ["s-2"], SAM);
    expect(await officialClosures()).toEqual([
      {
        judge: { name: "Alex Judge" },
        scoreCount: 2,
        missing: ["s-gone"],
        scoredSince: 0,
        phoneCreatedAt: "2027-05-15T11:00:00Z",
      },
      {
        judge: { name: "Sam Judge" },
        scoreCount: 1,
        missing: [],
        scoredSince: 0,
        phoneCreatedAt: "2027-05-15T11:00:00Z",
      },
    ]);
  });

  it("counts a missing score as found once it arrives", async () => {
    await close("c-1", ["s-late"]);
    await score("s-late");
    expect((await officialClosures())[0]?.missing).toEqual([]);
  });

  it("shows a Judge who scored again after closing: that reopens it", async () => {
    await score("s-1");
    await close("c-1", ["s-1"]);
    await score("s-2", ALEX, "team-2");
    expect((await officialClosures())[0]?.scoredSince).toBe(1);

    // Closing again is a new closure, and the newest one is shown.
    await close("c-3", ["s-1", "s-2"]);
    expect(await officialClosures()).toMatchObject([
      { scoreCount: 2, scoredSince: 0, missing: [] },
    ]);
  });

  it("counts closures on the Activity list", async () => {
    await score("s-1");
    await close("c-1", ["s-1"]);
    const res = await app.request("/api/official/event", {
      headers: { [OFFICIAL_EMAIL_HEADER]: "lead.judge@example.com" },
    });
    const { activities } = (await res.json()) as {
      activities: { id: string; closedBy: number; closureProblems: number }[];
    };
    expect(activities.find((a) => a.id === CLOWN_CAR.id)).toMatchObject({
      closedBy: 1,
      closureProblems: 0,
    });
  });
});
