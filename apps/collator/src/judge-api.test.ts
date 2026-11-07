import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { loadEventCartridge } from "./load-event.ts";
import {
  CIRCUS_EVENT_ID,
  circusCartridge,
  CLOWN_CAR,
  GROUP_ACTIVITY,
  HIGH_WIRE,
  testDb,
} from "./test-support.ts";

// What the judge page (#40 PR 2) needs from the Collator: the Event to judge, each Activity's form.

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = testDb();
  app = createApp({ db });
});

const load = () => {
  const result = loadEventCartridge(db, circusCartridge());
  if (!result.ok) throw new Error(result.issues.join("\n"));
};

interface JudgeEvent {
  competitions: { id: string; label: string; level: "team" | "group" }[];
  event: {
    id: string;
    title: string;
    labels: { team: string; group: string };
  };
  activities: {
    id: string;
    title: string;
    competition: { id: string; label: string; level: "team" | "group" };
    fields: { id: string; label: string; type: string }[];
  }[];
}

const judgeEvent = async (): Promise<JudgeEvent> => {
  const res = await app.request("/api/event");
  expect(res.status).toBe(200);
  return (await res.json()) as JudgeEvent;
};

describe("GET /api/event: the Event a Judge scores", () => {
  it("is refused before a cartridge is loaded (409)", async () => {
    expect((await app.request("/api/event")).status).toBe(409);
  });

  it("names the Event and the pack's labels for Teams and Groups", async () => {
    load();
    const { event } = await judgeEvent();
    expect(event).toEqual({
      id: CIRCUS_EVENT_ID,
      title: "Coyote Creek District Camporee 2026",
      labels: { team: "Patrol", group: "Troop" },
    });
  });

  it("lists the Competitions in the Event's order, for the judge page's tabs (#41 PR 5)", async () => {
    load();
    const { competitions } = await judgeEvent();
    expect(competitions.map((c) => [c.label, c.level])).toEqual([
      ["Patrol Games", "team"],
      ["Exhibition Events", "team"],
      ["Troop Challenges", "group"],
    ]);
  });

  it("lists every Activity in the Event's order, with its Competition and level", async () => {
    load();
    const { activities } = await judgeEvent();
    expect(activities).toHaveLength(33);
    expect(activities[0]?.title).toBe("The Grand Entrée");
    expect(activities.find((a) => a.id === CLOWN_CAR.id)?.competition).toEqual(
      expect.objectContaining({ label: "Patrol Games", level: "team" }),
    );
    expect(
      activities.find((a) => a.id === GROUP_ACTIVITY)?.competition.level,
    ).toBe("group");
  });

  it("gives each Activity's form: Common Fields merged in (ADR-0020), Judge fields only", async () => {
    load();
    const { activities } = await judgeEvent();
    const clownCar = activities.find((a) => a.id === CLOWN_CAR.id);
    const ids = clownCar?.fields.map((f) => f.id) ?? [];
    expect(ids).toContain(CLOWN_CAR.ownField);
    expect(ids).toContain(CLOWN_CAR.commonField);

    // The Activity's variables fill the Common Field's {{tokens}}: Clown Car's ten_essentials is "Buddy".
    expect(clownCar?.fields.find((f) => f.id === "ten_ess")?.label).toBe(
      "10 Essentials: Buddy",
    );

    const highWire = activities.find((a) => a.id === HIGH_WIRE.id);
    const highWireIds = highWire?.fields.map((f) => f.id) ?? [];
    expect(highWireIds).toContain(HIGH_WIRE.judgeField);
    expect(highWireIds).not.toContain(HIGH_WIRE.officialField);
  });
});

describe("a Judge's home unit (#41 PR 5)", () => {
  const scoreWith = (judge: Record<string, unknown>) =>
    app.request("/api/scores/s-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        judge: { id: "j-1", name: "Alex", email: "alex@example.com", ...judge },
        activityId: "no-such-activity",
        entrantId: "t-1",
        values: {},
        phoneCreatedAt: "2027-05-15T09:00:00Z",
      }),
    });

  it("is optional free text: a long one is refused before anything else is checked", async () => {
    load();
    const res = await scoreWith({ homeGroup: "x".repeat(201) });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/homeGroup/);
  });

  it("takes one, or none, or a blank as none", async () => {
    load();
    for (const homeGroup of ["Troop 7", "  ", undefined]) {
      const res = await scoreWith(homeGroup === undefined ? {} : { homeGroup });
      // Past the body check: refused for the made-up Activity, not for the Judge.
      expect(await res.text()).toMatch(/no-such-activity/);
    }
  });
});

describe("a Judge's score entry holds Judge fields only", () => {
  it("refuses a field only Officials enter", async () => {
    load();
    await app.request("/api/groups/g-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Troop 101" }),
    });
    await app.request("/api/teams/t-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: "g-1", name: "Owls" }),
    });
    const res = await app.request("/api/scores/s-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        judge: { id: "j-1", name: "Alex", email: "alex@example.com" },
        activityId: HIGH_WIRE.id,
        entrantId: "t-1",
        values: { [HIGH_WIRE.officialField]: 3 },
        phoneCreatedAt: "2027-05-15T09:00:00Z",
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Officials/);
  });
});
