import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { rosterChanges } from "./db/schema.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadEventCartridge } from "./load-event.ts";
import { recordRosterChange, resolvedRoster } from "./roster.ts";
import {
  circusCartridge,
  CLOWN_CAR,
  DIRECTOR_EMAIL,
  GROUP_ACTIVITY,
  testDb,
} from "./test-support.ts";

// Roster changes on the box (ADR-0027, 2026-11-10; #42 PR 6): add, rename, merge and unmerge, all logged, and
// applied when the box builds the scoring input.

const OFFICIAL = "lead.judge@example.com";
const ALEX = {
  id: "judge-alex",
  name: "Alex Judge",
  email: "alex@example.com",
};
const SAM = { id: "judge-sam", name: "Sam Judge", email: "sam@example.com" };

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = testDb();
  app = createApp({ db });
  const result = loadEventCartridge(db, circusCartridge());
  if (!result.ok) throw new Error(result.issues.join("\n"));
});

const put = (path: string, body: unknown, email: string | null = null) =>
  app.request(path, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(email === null ? {} : { [OFFICIAL_EMAIL_HEADER]: email }),
    },
    body: JSON.stringify(body),
  });
const asOfficial = (path: string, email = OFFICIAL) =>
  app.request(path, { headers: { [OFFICIAL_EMAIL_HEADER]: email } });

let n = 0;
/** An Official's roster change, through the API; returns the response. */
const change = (
  body: Record<string, unknown>,
  notes?: string,
  id = `change-${++n}`,
  email = OFFICIAL,
) =>
  put(
    `/api/official/roster-changes/${id}`,
    {
      change: body,
      ...(notes !== undefined && { notes }),
      clientCreatedAt: "2027-05-15T10:00:00Z",
    },
    email,
  );
const ok = async (res: Response | Promise<Response>) => {
  const r = await res;
  expect(r.status, await r.clone().text()).toBeLessThan(300);
  return r;
};

async function withRoster() {
  await put("/api/groups/g1", { name: "Troop 101" });
  await put("/api/groups/g2", { name: "Troop 202" });
  await put("/api/teams/team-a", { groupId: "g1", name: "Foo fighters" });
  await put("/api/teams/team-b", { groupId: "g1", name: "Foo Fighters" });
  await put("/api/teams/team-c", { groupId: "g2", name: "Hawks" });
}
const clowns = (id: string, judge: typeof ALEX, entrantId: string, v: number) =>
  put(`/api/scores/${id}`, {
    judge,
    activityId: CLOWN_CAR.id,
    entrantId,
    values: { [CLOWN_CAR.ownField]: v, [CLOWN_CAR.commonField]: 5 },
    phoneCreatedAt: "2027-05-15T09:30:00Z",
  });

interface Row {
  entrantId: string;
  entrant: { name: string | null; group: string | null };
  place: number | null;
  total: number | null;
  conflict: string;
  onRoster: boolean;
  dq: unknown;
}
const matrix = async (activityId = CLOWN_CAR.id) => {
  const res = await asOfficial(`/api/official/activities/${activityId}`);
  return ((await res.json()) as { matrix: Row[] }).matrix;
};
const phoneRoster = async () =>
  (await (await app.request("/api/roster")).json()) as {
    groups: { id: string; name: string }[];
    teams: { id: string; groupId: string; name: string }[];
  };
const standingsRows = async () => {
  const res = await asOfficial("/api/official/standings");
  const all = (await res.json()) as {
    competition: { level: string };
    rows: { entrantId: string; entrant: { name: string }; total: number }[];
  }[];
  return all.find((c) => c.competition.level === "team")?.rows ?? [];
};

describe("adding, renaming and logging roster changes", () => {
  beforeEach(withRoster);

  it("add-team and add-group put the laptop's id on the roster and log it", async () => {
    expect(
      (await change({ type: "add-group", groupId: "g9", name: "Troop 9" }))
        .status,
    ).toBe(201);
    expect(
      (
        await change({
          type: "add-team",
          teamId: "team-9",
          groupId: "g9",
          name: "Newts",
        })
      ).status,
    ).toBe(201);
    const roster = await phoneRoster();
    expect(roster.groups.map((g) => g.id)).toContain("g9");
    expect(roster.teams).toContainEqual({
      id: "team-9",
      groupId: "g9",
      name: "Newts",
    });
    expect(db.select().from(rosterChanges).all()).toHaveLength(2);
  });

  it("a phone sending the same id and content later gets a repeat", async () => {
    await change({
      type: "add-team",
      teamId: "team-9",
      groupId: "g1",
      name: "Newts",
    });
    const res = await put("/api/teams/team-9", {
      groupId: "g1",
      name: "Newts",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "repeat" });
  });

  it("a resend of a change is a repeat; the same id with other content is a 409", async () => {
    const body = { type: "rename", kind: "team", id: "team-a", name: "Foxes" };
    expect((await change(body, "typo", "c-1")).status).toBe(201);
    expect((await change(body, "typo", "c-1")).status).toBe(200);
    expect(
      (await change({ ...body, name: "Wolves" }, "typo", "c-1")).status,
    ).toBe(409);
    expect(db.select().from(rosterChanges).all()).toHaveLength(1);
  });

  it("a rename changes the display name everywhere, the latest wins, and the log says who and why", async () => {
    await ok(
      change({ type: "rename", kind: "team", id: "team-a", name: "Foxes" }),
    );
    await ok(
      change(
        { type: "rename", kind: "team", id: "team-a", name: "Red Foxes" },
        "spelling",
      ),
    );
    expect(
      (await phoneRoster()).teams.find((t) => t.id === "team-a")?.name,
    ).toBe("Red Foxes");
    await ok(
      change({ type: "rename", kind: "group", id: "g1", name: "Troop 1" }),
    );
    await clowns("s1", ALEX, "team-a", 9);
    const row = (await matrix()).find((r) => r.entrantId === "team-a");
    expect(row?.entrant).toEqual({ name: "Red Foxes", group: "Troop 1" });
    expect((await standingsRows())[0]?.entrant.name).toBe("Red Foxes");

    const res = await asOfficial("/api/official/roster");
    const body = (await res.json()) as {
      history: { by: string; notes?: string; text: string }[];
    };
    expect(body.history[0]).toMatchObject({ by: OFFICIAL });
    expect(body.history.map((h) => h.notes)).toContain("spelling");
    expect(body.history).toHaveLength(3);
  });

  it("a phone resending its original Team after a rename is still a repeat", async () => {
    await ok(
      change({ type: "rename", kind: "team", id: "team-a", name: "Foxes" }),
    );
    const res = await put("/api/teams/team-a", {
      groupId: "g1",
      name: "Foo fighters",
    });
    expect(res.status).toBe(200);
    expect(
      (await put("/api/teams/team-a", { groupId: "g1", name: "Foxes" })).status,
    ).toBe(409);
  });

  it("refuses what makes no sense, with 400 and a plain message", async () => {
    const refused = async (body: Record<string, unknown>, text: RegExp) => {
      const res = await change(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(text);
    };
    await refused(
      { type: "rename", kind: "team", id: "team-a", name: "  " },
      /name/i,
    );
    await refused(
      { type: "rename", kind: "team", id: "nope", name: "X" },
      /nope/,
    );
    await refused(
      { type: "rename", kind: "group", id: "team-a", name: "X" },
      /team-a/,
    );
    await refused({ type: "add-group", groupId: "gx", name: "" }, /name/i);
    await refused(
      { type: "add-team", teamId: "tx", groupId: "nope", name: "X" },
      /nope/,
    );
    await refused(
      { type: "merge", kind: "team", id: "team-a", intoId: "team-a" },
      /itself/,
    );
    await refused(
      { type: "merge", kind: "team", id: "team-a", intoId: "g1" },
      /Group|kind/,
    );
    await refused(
      { type: "merge", kind: "team", id: "team-a", intoId: "nope" },
      /nope/,
    );
    await refused(
      { type: "unmerge", kind: "team", id: "team-a" },
      /isn't merged/,
    );
    expect(db.select().from(rosterChanges).all()).toHaveLength(0);
  });

  it("is only for Officials, and the gate is checked", async () => {
    const body = {
      change: { type: "add-group", groupId: "gz", name: "Z" },
      clientCreatedAt: "2027-05-15T10:00:00Z",
    };
    expect((await put("/api/official/roster-changes/x", body)).status).toBe(
      401,
    );
    expect(
      (await put("/api/official/roster-changes/x", body, "alex@example.com"))
        .status,
    ).toBe(403);
    expect(
      (
        await put(
          "/api/official/roster-changes/x",
          {
            change: { type: "nonsense" },
            clientCreatedAt: "2027-05-15T10:00:00Z",
          },
          OFFICIAL,
        )
      ).status,
    ).toBe(400);
  });

  it("recordRosterChange refuses until an Event is loaded", () => {
    const bare = testDb();
    const result = recordRosterChange(bare, {
      id: "c",
      officialEmail: OFFICIAL,
      change: { type: "add-group", groupId: "g", name: "G" },
      clientCreatedAt: "2027-05-15T10:00:00Z",
    });
    expect(result).toMatchObject({ ok: false, reason: "no-event" });
  });
});

describe("merging", () => {
  beforeEach(withRoster);
  const merge = (
    id: string,
    intoId: string,
    kind = "team",
    notes = "same Patrol",
  ) => change({ type: "merge", kind, id, intoId }, notes);
  const unmerge = (id: string, kind = "team") =>
    change({ type: "unmerge", kind, id });

  it("A's entries count for B: one row, and two Judges make a conflict", async () => {
    await clowns("s1", ALEX, "team-a", 9);
    await clowns("s2", SAM, "team-b", 7);
    expect((await matrix()).map((r) => r.entrantId)).toEqual([
      "team-a",
      "team-b",
    ]);
    await ok(merge("team-a", "team-b"));
    const rows = await matrix();
    expect(rows.map((r) => [r.entrantId, r.entrant.name, r.conflict])).toEqual([
      ["team-b", "Foo Fighters", "unresolved"],
    ]);
    const event = (await (await asOfficial("/api/official/event")).json()) as {
      activities: { id: string; conflicts: number }[];
    };
    expect(event.activities.find((a) => a.id === CLOWN_CAR.id)?.conflicts).toBe(
      1,
    );
  });

  it("the standings follow, and the phone's roster hides A", async () => {
    await clowns("s1", ALEX, "team-a", 9);
    await clowns("s2", ALEX, "team-c", 2);
    expect((await standingsRows()).map((r) => r.entrantId)).toEqual([
      "team-a",
      "team-c",
    ]);
    await ok(merge("team-a", "team-b"));
    expect(
      (await standingsRows()).map((r) => [
        r.entrantId,
        r.entrant.name,
        r.total,
      ]),
    ).toEqual([
      ["team-b", "Foo Fighters", 14],
      ["team-c", "Hawks", 7],
    ]);
    expect((await phoneRoster()).teams.map((t) => t.id)).toEqual([
      "team-b",
      "team-c",
    ]);
  });

  it("a phone scoring A after the merge is fine: it counts for B", async () => {
    await ok(merge("team-a", "team-b"));
    expect((await clowns("s1", ALEX, "team-a", 9)).status).toBe(201);
    expect((await matrix()).map((r) => [r.entrantId, r.total])).toEqual([
      ["team-b", 14],
    ]);
  });

  it("unmerge restores everything", async () => {
    await clowns("s1", ALEX, "team-a", 9);
    await clowns("s2", SAM, "team-b", 7);
    await ok(merge("team-a", "team-b"));
    await ok(unmerge("team-a"));
    const rows = await matrix();
    expect(rows.map((r) => [r.entrantId, r.conflict])).toEqual([
      ["team-a", "none"],
      ["team-b", "none"],
    ]);
    expect(await standingsRows()).toHaveLength(2);
    expect((await phoneRoster()).teams.map((t) => t.id)).toContain("team-a");
    // ...and merging again works: the latest of merge and unmerge wins.
    await ok(merge("team-a", "team-b"));
    expect(await matrix()).toHaveLength(1);
  });

  it("chains: A into B and B into C resolves A to C", async () => {
    await clowns("s1", ALEX, "team-a", 9);
    await ok(merge("team-b", "team-c"));
    await ok(merge("team-a", "team-b"));
    expect((await matrix()).map((r) => [r.entrantId, r.total])).toEqual([
      ["team-c", 14],
    ]);
    const roster = resolvedRoster(db);
    expect(roster.resolve("team-a")).toBe("team-c");
    expect(roster.resolve("team-c")).toBe("team-c");
    expect(roster.mergedInto.get("team-a")).toBe("team-c");
    expect(roster.mergedInto.get("team-b")).toBe("team-c");
    expect(roster.teams.map((t) => t.id)).toEqual(["team-c"]);
  });

  it("refuses a loop", async () => {
    await ok(merge("team-a", "team-b"));
    const res = await merge("team-b", "team-a");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/loop/i);
    const chain = await ok(merge("team-b", "team-c"));
    expect(chain.status).toBe(201);
    expect((await merge("team-c", "team-a")).status).toBe(400);
  });

  it("a Group merge shows its Teams under the surviving Group, and Group-level entries count for it", async () => {
    await put("/api/scores/gs1", {
      judge: ALEX,
      activityId: GROUP_ACTIVITY,
      entrantId: "g2",
      values: { organization: 10 },
      phoneCreatedAt: "2027-05-15T09:30:00Z",
    });
    await ok(merge("g2", "g1", "group"));
    const roster = await phoneRoster();
    expect(roster.groups.map((g) => g.id)).toEqual(["g1"]);
    expect(roster.teams.find((t) => t.id === "team-c")?.groupId).toBe("g1");
    const rows = await matrix(GROUP_ACTIVITY);
    expect(
      rows.filter((r) => r.total !== null).map((r) => r.entrantId),
    ).toEqual(["g1"]);
    // The Team's name shows under the surviving Group.
    await clowns("s1", ALEX, "team-c", 3);
    expect(
      (await matrix()).find((r) => r.entrantId === "team-c")?.entrant,
    ).toEqual({
      name: "Hawks",
      group: "Troop 101",
    });
  });

  it("a DQ logged on A before the merge applies to B afterwards (actions are resolved too)", async () => {
    await clowns("s1", ALEX, "team-a", 9);
    await ok(
      put(
        "/api/official/actions/dq-1",
        {
          action: {
            type: "disqualify",
            activityId: CLOWN_CAR.id,
            entrantId: "team-a",
            disqualified: true,
          },
          clientCreatedAt: "2027-05-15T10:00:00Z",
        },
        OFFICIAL,
      ),
    );
    await ok(merge("team-a", "team-b"));
    const row = (await matrix()).find((r) => r.entrantId === "team-b");
    expect(row?.dq).toMatchObject({ disqualified: true });
  });

  it("lists what is merged, with the surviving name, who and why", async () => {
    await ok(merge("team-a", "team-b"));
    const body = (await (
      await asOfficial("/api/official/roster", DIRECTOR_EMAIL)
    ).json()) as {
      merged: {
        kind: string;
        id: string;
        name: string;
        intoId: string;
        intoName: string;
        by: string;
        notes?: string;
      }[];
      teams: { id: string }[];
    };
    expect(body.merged).toEqual([
      expect.objectContaining({
        kind: "team",
        id: "team-a",
        name: "Foo fighters",
        intoId: "team-b",
        intoName: "Foo Fighters",
        by: OFFICIAL,
        notes: "same Patrol",
      }),
    ]);
    expect(body.teams.map((t) => t.id)).not.toContain("team-a");
    await ok(unmerge("team-a"));
    const after = (await (await asOfficial("/api/official/roster")).json()) as {
      merged: unknown[];
    };
    expect(after.merged).toEqual([]);
  });
});
