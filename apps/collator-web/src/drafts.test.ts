import { describe, expect, it } from "vitest";
import { createDrafts, type DraftStorage } from "./drafts.ts";

// #41 PR 4: a half-filled form survives leaving the screen or a reload, kept per Activity × Team.

function memoryStorage(): DraftStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const draft = {
  entry: { clowns: "7", flag: true },
  timers: { time: { runningSince: 1_000, elapsedMs: 0 } },
};

describe("drafts", () => {
  it("keeps a draft per Activity and Team, across a reload", () => {
    const storage = memoryStorage();
    createDrafts(storage).save("clown-car", "t1", draft);
    const again = createDrafts(storage);
    expect(again.get("clown-car", "t1")).toEqual(draft);
    expect(again.get("clown-car", "t2")).toBeUndefined();
    expect(again.get("circus-line", "t1")).toBeUndefined();
  });

  it("lists which Teams have a draft at an Activity", () => {
    const drafts = createDrafts(memoryStorage());
    drafts.save("clown-car", "t1", draft);
    drafts.save("clown-car", "t2", draft);
    drafts.save("circus-line", "t3", draft);
    expect([...drafts.entrantsWithDrafts("clown-car")].sort()).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("forgets a draft once the score is saved", () => {
    const storage = memoryStorage();
    const drafts = createDrafts(storage);
    drafts.save("clown-car", "t1", draft);
    drafts.clear("clown-car", "t1");
    expect(drafts.get("clown-car", "t1")).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });

  it("survives storage that's broken or full", () => {
    const broken: DraftStorage = {
      getItem: () => "{not json",
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const drafts = createDrafts(broken);
    expect(drafts.get("clown-car", "t1")).toBeUndefined();
    expect(() => drafts.save("clown-car", "t1", draft)).not.toThrow();
  });
});
