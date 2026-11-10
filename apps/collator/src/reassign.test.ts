import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { scoreEntries } from "./db/schema.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadEventCartridge } from "./load-event.ts";
import type { MatrixRow } from "./official-view.ts";
import { circusCartridge, CLOWN_CAR, testDb } from "./test-support.ts";

// An Official moves a score entry to another entrant (ADR-0019 reassign-entry; #42 PR 6): the API refuses a
// nonsense move, the matrix shows where the entry counts now, and an off-roster entry can be moved onto the roster.

const OFFICIAL = "lead.judge@example.com";
const ALEX = {
  id: "judge-alex",
  name: "Alex Judge",
  email: "alex@example.com",
};

let db: Db;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  db = testDb();
  app = createApp({ db });
  const result = loadEventCartridge(db, circusCartridge());
  if (!result.ok) throw new Error(result.issues.join("\n"));
  await put("/api/groups/g1", { name: "Troop 101" });
  await put("/api/teams/team-a", { groupId: "g1", name: "Flaming Arrows" });
  await put("/api/teams/team-b", { groupId: "g1", name: "Owls" });
  await put("/api/teams/team-c", { groupId: "g1", name: "Hawks" });
  await score("s-a", "team-a", 9);
  await score("s-b", "team-b", 7);
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
const score = (id: string, entrantId: string, v: number) =>
  put(`/api/scores/${id}`, {
    judge: ALEX,
    activityId: CLOWN_CAR.id,
    entrantId,
    values: { [CLOWN_CAR.ownField]: v, [CLOWN_CAR.commonField]: 5 },
    phoneCreatedAt: "2027-05-15T09:30:00Z",
  });
let n = 0;
const act = (action: Record<string, unknown>, id = `act-${++n}`) =>
  put(
    `/api/official/actions/${id}`,
    {
      action: { activityId: CLOWN_CAR.id, ...action },
      clientCreatedAt: "2027-05-15T10:00:00Z",
    },
    OFFICIAL,
  );
const move = (
  entryId: string,
  entrantId: string,
  toEntrantId: string,
  notes?: string,
) =>
  act({
    type: "reassign-entry",
    entrantId,
    entryId,
    toEntrantId,
    ...(notes !== undefined && { notes }),
  });
const rows = async () => {
  const res = await app.request(`/api/official/activities/${CLOWN_CAR.id}`, {
    headers: { [OFFICIAL_EMAIL_HEADER]: OFFICIAL },
  });
  return ((await res.json()) as { matrix: MatrixRow[] }).matrix;
};

describe("PUT /api/official/actions/:id: reassign-entry", () => {
  it("refuses a move to an entrant that isn't on the roster, an unknown entry, and a move to where it already counts", async () => {
    for (const res of [
      await move("s-a", "team-a", "nobody"),
      await move("nope", "team-a", "team-c"),
      await move("s-a", "team-a", "team-a"),
      await move("s-a", "team-b", "team-c"),
    ]) {
      expect(res.status).toBe(400);
    }
  });

  it("moves the values, total and place to the entrant it was moved to", async () => {
    const res = await move("s-a", "team-a", "team-c", "wrong Patrol");
    expect(res.status).toBe(201);
    const matrix = await rows();
    const c = matrix.find((r) => r.entrantId === "team-c");
    const a = matrix.find((r) => r.entrantId === "team-a");
    expect(c).toMatchObject({
      scored: true,
      place: 1,
      entryId: "s-a",
      values: { [CLOWN_CAR.ownField]: 9 },
    });
    expect(c?.total).toBeGreaterThan(0);
    expect(c?.candidates.map((e) => e.entryId)).toEqual(["s-a"]);
    expect(c?.moves).toEqual([
      expect.objectContaining({
        entryId: "s-a",
        direction: "here",
        fromId: "team-a",
        fromName: "Flaming Arrows",
        toId: "team-c",
        toName: "Hawks",
        by: expect.stringMatching(/./),
        notes: "wrong Patrol",
        state: "applied",
      }),
    ]);
    expect(a).toMatchObject({ scored: false, total: null });
    expect(matrix.find((r) => r.entrantId === "team-b")?.place).toBe(2);
    // Moving it back undoes it.
    await move("s-a", "team-c", "team-a");
    const back = await rows();
    expect(back.find((r) => r.entrantId === "team-a")?.place).toBe(1);
    expect(back.find((r) => r.entrantId === "team-c")?.scored).toBe(false);
  });

  it("an off-roster entry moved to a Team counts there, and its row goes", async () => {
    db.insert(scoreEntries)
      .values({
        id: "s-ghost",
        judgeId: ALEX.id,
        activityId: CLOWN_CAR.id,
        entrantId: "ghost-team",
        values: JSON.stringify({ [CLOWN_CAR.ownField]: 8 }),
        phoneCreatedAt: "2027-05-15T09:50:00Z",
        receivedAt: new Date(),
      })
      .run();
    expect((await rows()).map((r) => [r.entrantId, r.onRoster])).toContainEqual(
      ["ghost-team", false],
    );
    expect((await move("s-ghost", "ghost-team", "team-c")).status).toBe(201);
    const after = await rows();
    expect(after.map((r) => r.entrantId)).not.toContain("ghost-team");
    expect(after.find((r) => r.entrantId === "team-c")).toMatchObject({
      scored: true,
      onRoster: true,
      entryId: "s-ghost",
    });
  });
});
