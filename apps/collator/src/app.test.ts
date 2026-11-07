import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { loadEventCartridge } from "./load-event.ts";
import { judgeList, scoreEntries } from "./roster-and-scores.ts";
import {
  CIRCUS_EVENT_ID,
  circusCartridge,
  CLOWN_CAR,
  editFields,
  GROUP_ACTIVITY,
  HIGH_WIRE,
  SHOWTIME,
  testDb,
} from "./test-support.ts";

const ALEX = {
  id: "judge-alex",
  name: "Alex Judge",
  email: "alex@example.com",
};
const SAM = { id: "judge-sam", name: "Sam Judge", email: "sam@example.com" };

let db: Db;
let app: ReturnType<typeof createApp>;

const put = (path: string, body: unknown) =>
  app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const score = (overrides: Record<string, unknown> = {}) => ({
  judge: ALEX,
  activityId: CLOWN_CAR.id,
  entrantId: "team-1",
  values: { [CLOWN_CAR.ownField]: 7, [CLOWN_CAR.commonField]: 5 },
  phoneCreatedAt: "2027-05-15T09:30:00Z",
  ...overrides,
});

/** Loads Circus 2026 and adds Troop 101 with one Team, as a Judge's phone would. */
async function withRoster() {
  await loadWithRoster(circusCartridge());
}

/** Loads this cartridge and adds Troop 101 with one Team. */
async function loadWithRoster(cartridge: Uint8Array) {
  const load = loadEventCartridge(db, cartridge);
  if (!load.ok) throw new Error(load.issues.join("\n"));
  expect((await put("/api/groups/group-1", { name: "Troop 101" })).status).toBe(
    201,
  );
  expect(
    (
      await put("/api/teams/team-1", {
        groupId: "group-1",
        name: "Flaming Arrows",
      })
    ).status,
  ).toBe(201);
}

beforeEach(() => {
  db = testDb();
  app = createApp({ db });
});

describe("health", () => {
  it("says which Event is loaded", async () => {
    expect(await (await app.request("/api/health")).json()).toEqual({
      ok: true,
      event: null,
    });
    loadEventCartridge(db, circusCartridge());
    expect(await (await app.request("/api/health")).json()).toMatchObject({
      ok: true,
      event: { id: CIRCUS_EVENT_ID },
    });
  });
});

describe("score entries are keyed by the phone's id (ADR-0027 item 8)", () => {
  beforeEach(withRoster);

  it("accepts a first submit", async () => {
    const res = await put("/api/scores/score-1", score());
    expect(res.status).toBe(201);
    expect(scoreEntries(db)).toEqual([
      expect.objectContaining({
        id: "score-1",
        judgeId: ALEX.id,
        activityId: CLOWN_CAR.id,
        entrantId: "team-1",
        values: { [CLOWN_CAR.ownField]: 7, [CLOWN_CAR.commonField]: 5 },
        phoneCreatedAt: "2027-05-15T09:30:00Z",
      }),
    ]);
  });

  it("takes an identical resend as a repeat: no duplicate", async () => {
    await put("/api/scores/score-1", score());
    const again = await put("/api/scores/score-1", score());
    expect(again.status).toBe(200);
    expect(scoreEntries(db)).toHaveLength(1);
  });

  it("refuses the same id with different content (409); the first entry stands", async () => {
    // An accidental conflicting resend. Judge corrections are #41 / #42, not this.
    await put("/api/scores/score-1", score());
    const conflicting = await put(
      "/api/scores/score-1",
      score({ values: { [CLOWN_CAR.ownField]: 9 } }),
    );
    expect(conflicting.status).toBe(409);
    expect(scoreEntries(db)).toHaveLength(1);
    expect(scoreEntries(db)[0]?.values).toEqual({
      [CLOWN_CAR.ownField]: 7,
      [CLOWN_CAR.commonField]: 5,
    });
  });

  it("keeps both when two Judges score the same Team at the same Activity, in the order received", async () => {
    // ADR-0027 item 9: the box's receive order decides "newest", not the phones' clocks.
    await put(
      "/api/scores/score-sam",
      score({ judge: SAM, phoneCreatedAt: "2027-05-15T10:00:00Z" }),
    );
    await put(
      "/api/scores/score-alex",
      score({ phoneCreatedAt: "2027-05-15T09:00:00Z" }),
    );
    const entries = scoreEntries(db);
    expect(entries.map((e) => e.id)).toEqual(["score-sam", "score-alex"]);
    const [first, second] = entries.map((e) => e.receivedSeq);
    expect(first).toBeLessThan(second ?? 0);
  });

  it("records the Judge with the score, and the latest name they gave", async () => {
    await put("/api/scores/score-1", score());
    await put(
      "/api/scores/score-2",
      score({ judge: { ...ALEX, name: "Alexandra Judge" } }),
    );
    // Read from the DB: Judges' emails are never served without the Official gate (PR 3).
    expect(judgeList(db)).toEqual([{ ...ALEX, name: "Alexandra Judge" }]);
  });
});

describe("score entries are checked against the loaded Event", () => {
  beforeEach(withRoster);

  it("refuses a field the Activity doesn't have, after merging Common Fields (ADR-0020)", async () => {
    const res = await put(
      "/api/scores/score-1",
      score({ values: { not_a_field: 1 } }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/not_a_field/);
    expect(scoreEntries(db)).toHaveLength(0);
  });

  it("refuses an Activity the Event doesn't have", async () => {
    const res = await put(
      "/api/scores/score-1",
      score({ activityId: "0196cfa2-4c00-7000-8000-0000000000ff" }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses an entrant who isn't on the roster", async () => {
    const res = await put(
      "/api/scores/score-1",
      score({ entrantId: "team-nobody" }),
    );
    expect(res.status).toBe(400);
  });

  it("refuses an entrant at the wrong level: a Group at a Team-level Activity", async () => {
    const res = await put(
      "/api/scores/score-1",
      score({ entrantId: "group-1" }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Team/);
  });

  it("takes a Group at a Group-level Activity", async () => {
    const res = await put(
      "/api/scores/score-1",
      score({ activityId: GROUP_ACTIVITY, entrantId: "group-1", values: {} }),
    );
    expect(res.status).toBe(201);
  });

  it("refuses a body that isn't a score entry", async () => {
    const res = await put("/api/scores/score-1", { values: "seven" });
    expect(res.status).toBe(400);
  });
});

describe("before a cartridge is loaded", () => {
  it("refuses scores and roster changes (409)", async () => {
    expect(
      (await put("/api/groups/group-1", { name: "Troop 101" })).status,
    ).toBe(409);
    expect((await put("/api/scores/score-1", score())).status).toBe(409);
  });
});

describe("Judges add Groups and Teams on the spot (v1 parity), keyed by the phone's id", () => {
  beforeEach(withRoster);

  it("takes an identical resend as a repeat", async () => {
    expect(
      (await put("/api/groups/group-1", { name: "Troop 101" })).status,
    ).toBe(200);
    expect(
      (
        await put("/api/teams/team-1", {
          groupId: "group-1",
          name: "Flaming Arrows",
        })
      ).status,
    ).toBe(200);
  });

  it("refuses the same id with different content (409)", async () => {
    expect(
      (await put("/api/groups/group-1", { name: "Troop 202" })).status,
    ).toBe(409);
    expect(
      (await put("/api/teams/team-1", { groupId: "group-1", name: "Owls" }))
        .status,
    ).toBe(409);
  });

  it("refuses a Team whose Group isn't on the roster", async () => {
    expect(
      (await put("/api/teams/team-2", { groupId: "group-x", name: "Owls" }))
        .status,
    ).toBe(400);
  });

  it("lists the roster", async () => {
    expect(await (await app.request("/api/roster")).json()).toEqual({
      groups: [{ id: "group-1", name: "Troop 101" }],
      teams: [{ id: "team-1", groupId: "group-1", name: "Flaming Arrows" }],
    });
  });
});

describe("the box re-checks number ranges: it's the record of truth on event day", () => {
  // Clown Car's own field is 0 to 9. An old cached page or a modified client mustn't store 10.
  beforeEach(withRoster);

  const withValue = (value: unknown) =>
    put(
      "/api/scores/score-1",
      score({ values: { [CLOWN_CAR.ownField]: value } }),
    );

  it("accepts a value in range, including both ends", async () => {
    expect((await withValue(9)).status).toBe(201);
    expect(
      (
        await put(
          "/api/scores/score-2",
          score({ values: { [CLOWN_CAR.ownField]: 0 } }),
        )
      ).status,
    ).toBe(201);
  });

  it("refuses a value below min, saying why, and stores nothing", async () => {
    const res = await withValue(-1);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(
        /Big Top Cruiser Clowns must be from 0 to 9/,
      ),
    });
    expect(scoreEntries(db)).toHaveLength(0);
  });

  it("refuses a value above max", async () => {
    const res = await withValue(10);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/must be from 0 to 9/);
    expect(scoreEntries(db)).toHaveLength(0);
  });

  it("refuses text that isn't a number in a number field", async () => {
    expect((await withValue("lots")).status).toBe(400);
  });

  it("names the field as the phone does, with the Activity's {{variables}} filled in", async () => {
    // Clown Car's 10 Essentials Common Field is "10 Essentials: {{ten_essentials}}"; its item is Buddy.
    const res = await put(
      "/api/scores/score-1",
      score({ values: { ten_ess: "lots" } }),
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/10 Essentials: Buddy must be a number/);
    expect(error).not.toMatch(/\{\{/);
  });

  it("accepts any number for a field with no range", async () => {
    const res = await put(
      "/api/scores/score-1",
      score({
        activityId: SHOWTIME.id,
        values: { [SHOWTIME.unrangedField]: 1000 },
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("the box checks required fields and select options, as the phone does", () => {
  // The fixture has neither, so these tests add them to a copy of the design (#40 PR 3).
  const PICK = "costume";
  const designWith = (edit: (fields: Record<string, unknown>[]) => void) =>
    circusCartridge({
      editActivity: editFields(CLOWN_CAR.id, (fields) => {
        edit(fields);
        return fields;
      }),
    });
  const requiredOwnField = (fields: Record<string, unknown>[]) => {
    const own = fields.find((f) => f["id"] === CLOWN_CAR.ownField);
    if (own) own["required"] = true;
  };

  it("refuses a score with a required Judge field left out, saying which, and stores nothing", async () => {
    await loadWithRoster(designWith(requiredOwnField));
    const res = await put(
      "/api/scores/score-1",
      score({ values: { [CLOWN_CAR.commonField]: 5 } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.stringMatching(/Big Top Cruiser Clowns is required/),
    });
    expect(scoreEntries(db)).toHaveLength(0);
  });

  it("refuses a required Judge field sent blank", async () => {
    await loadWithRoster(designWith(requiredOwnField));
    for (const blank of [null, "", "  "]) {
      const res = await put(
        "/api/scores/score-1",
        score({ values: { [CLOWN_CAR.ownField]: blank } }),
      );
      expect(res.status).toBe(400);
    }
    expect(scoreEntries(db)).toHaveLength(0);
  });

  it("accepts the score once the required field is filled in", async () => {
    await loadWithRoster(designWith(requiredOwnField));
    expect((await put("/api/scores/score-1", score())).status).toBe(201);
  });

  it("doesn't hold a Judge to a required field only Officials enter", async () => {
    await loadWithRoster(
      circusCartridge({
        editActivity: editFields(HIGH_WIRE.id, (fields) =>
          fields.map((f) =>
            f["id"] === HIGH_WIRE.officialField ? { ...f, required: true } : f,
          ),
        ),
      }),
    );
    const res = await put(
      "/api/scores/score-1",
      score({
        activityId: HIGH_WIRE.id,
        values: { [HIGH_WIRE.judgeField]: 3 },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("refuses a select value that isn't one of its options", async () => {
    await loadWithRoster(
      designWith((fields) =>
        fields.push({
          id: PICK,
          label: "Costume",
          type: "select",
          kind: "info",
          audience: "judge",
          sortOrder: 99,
          config: { options: ["Clown", "Ringmaster"] },
        }),
      ),
    );
    const refused = await put(
      "/api/scores/score-1",
      score({ values: { [PICK]: "Lion" } }),
    );
    expect(refused.status).toBe(400);
    expect(await refused.text()).toMatch(
      /Costume must be one of the listed options/,
    );
    expect(scoreEntries(db)).toHaveLength(0);
    const accepted = await put(
      "/api/scores/score-1",
      score({ values: { [PICK]: "Clown" } }),
    );
    expect(accepted.status).toBe(201);
  });
});
