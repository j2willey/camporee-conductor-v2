import type { Roster } from "@camporee-conductor/collator/types";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api.ts";
import {
  addGroupItem,
  addTeamItem,
  isScore,
  loadKept,
  rosterWithPending,
  type KeptStorage,
} from "./offline-data.ts";

// #41 PR 3: the judge page opens and scores with no Wi-Fi. The event and roster from the last time the box
// answered are kept on the phone, and Teams added on the phone show up before the box has them.

function memoryStorage(works = true): KeptStorage & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (!works) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
  };
}

const unreachable = () =>
  Promise.reject(new ApiError("Can't reach the scoring box."));

describe("loadKept", () => {
  it("uses the box's answer when it gives one, and keeps a copy on the phone", async () => {
    const storage = memoryStorage();
    const loaded = await loadKept(
      "k",
      () => Promise.resolve({ n: 1 }),
      storage,
    );
    expect(loaded).toEqual({ value: { n: 1 }, fromPhone: false });
    expect(JSON.parse(storage.data.get("k") ?? "null")).toEqual({ n: 1 });
  });

  it("falls back on the copy kept on the phone when the box can't be reached", async () => {
    const storage = memoryStorage();
    await loadKept("k", () => Promise.resolve({ n: 1 }), storage);
    expect(await loadKept("k", unreachable, storage)).toEqual({
      value: { n: 1 },
      fromPhone: true,
    });
  });

  it("fails as before when the box can't be reached and nothing is kept", async () => {
    await expect(loadKept("k", unreachable, memoryStorage())).rejects.toThrow(
      "Can't reach the scoring box.",
    );
  });

  it("doesn't hide a refusal behind an old copy: the box answered", async () => {
    const storage = memoryStorage();
    await loadKept("k", () => Promise.resolve({ n: 1 }), storage);
    const refused = () =>
      Promise.reject(new ApiError("No event is loaded yet", true));
    await expect(loadKept("k", refused, storage)).rejects.toThrow(
      "No event is loaded yet",
    );
  });

  it("still answers when the phone won't keep a copy", async () => {
    const loaded = await loadKept(
      "k",
      () => Promise.resolve({ n: 1 }),
      memoryStorage(false),
    );
    expect(loaded).toEqual({ value: { n: 1 }, fromPhone: false });
  });
});

const roster: Roster = {
  groups: [{ id: "g1", name: "Troop 101" }],
  teams: [{ id: "t1", groupId: "g1", name: "Flaming Arrows" }],
};

describe("rosterWithPending", () => {
  it("lists Groups and Teams added on this phone that the box doesn't have yet", () => {
    const items = [
      addGroupItem({ id: "g2", name: "Troop 202" }, "now"),
      addTeamItem(
        { id: "t2", groupId: "g2", name: "Eagles" },
        "Troop 202",
        "now",
      ),
      addTeamItem(
        { id: "t3", groupId: "g1", name: "Owls" },
        "Troop 101",
        "now",
      ),
    ];
    expect(rosterWithPending(roster, items)).toEqual({
      groups: [
        { id: "g1", name: "Troop 101" },
        { id: "g2", name: "Troop 202" },
      ],
      teams: [
        { id: "t1", groupId: "g1", name: "Flaming Arrows" },
        { id: "t2", groupId: "g2", name: "Eagles" },
        { id: "t3", groupId: "g1", name: "Owls" },
      ],
    });
  });

  it("lists each once when the box already has it", () => {
    const items = [
      addTeamItem(
        { id: "t1", groupId: "g1", name: "Flaming Arrows" },
        "Troop 101",
        "now",
      ),
      addGroupItem({ id: "g1", name: "Troop 101" }, "now"),
    ];
    expect(rosterWithPending(roster, items)).toEqual(roster);
  });

  it("leaves out adds the box refused, and scores", () => {
    const items = [
      {
        ...addGroupItem({ id: "g2", name: "Troop 202" }, "now"),
        refused: "no",
      },
      {
        id: "s1",
        path: "/api/scores/s1",
        body: {},
        label: "a score",
        queuedAt: "now",
      },
    ];
    expect(rosterWithPending(roster, items)).toEqual(roster);
  });
});

describe("outbox items for roster adds", () => {
  it("PUT the same body the box takes, under the phone-made id", () => {
    expect(addGroupItem({ id: "g2", name: "Troop 202" }, "now")).toEqual({
      id: "g2",
      path: "/api/groups/g2",
      body: { name: "Troop 202" },
      label: "Troop 202",
      queuedAt: "now",
    });
    expect(
      addTeamItem(
        { id: "t2", groupId: "g2", name: "Eagles" },
        "Troop 202",
        "now",
      ),
    ).toEqual({
      id: "t2",
      path: "/api/teams/t2",
      body: { groupId: "g2", name: "Eagles" },
      label: "Eagles (Troop 202)",
      queuedAt: "now",
    });
  });
});

describe("isScore", () => {
  const at = (path: string) => ({
    id: "x",
    path,
    body: {},
    label: "x",
    queuedAt: "t",
  });
  it("is true for a score, false for a roster add or a closure", () => {
    expect(isScore(at("/api/scores/x"))).toBe(true);
    expect(isScore(at("/api/groups/x"))).toBe(false);
    expect(isScore(at("/api/teams/x"))).toBe(false);
    expect(isScore(at("/api/closures/x"))).toBe(false);
  });
});
