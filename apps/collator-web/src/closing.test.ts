import { describe, expect, it } from "vitest";
import { createClosing, type ClosingStorage } from "./closing.ts";

// Close Game on the phone (#41 PR 6): which scores this phone saved at each Activity, per Judge, so a
// closure can name them all; and which Activities this Judge has closed.

function memoryStorage(): ClosingStorage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("closing", () => {
  it("keeps the ids of the scores a Judge saved at each Activity, across a reload", () => {
    const storage = memoryStorage();
    const closing = createClosing(storage);
    closing.scored("alex", "clown-car", "s-1");
    closing.scored("alex", "clown-car", "s-2");
    closing.scored("alex", "high-wire", "s-3");
    closing.scored("sam", "clown-car", "s-4");
    const again = createClosing(storage);
    expect(again.scoreIds("alex", "clown-car")).toEqual(["s-1", "s-2"]);
    expect(again.scoreIds("sam", "clown-car")).toEqual(["s-4"]);
    expect(again.scoreIds("alex", "juggling")).toEqual([]);
  });

  it("lists a score once, however often it's logged", () => {
    const closing = createClosing(memoryStorage());
    closing.scored("alex", "clown-car", "s-1");
    closing.scored("alex", "clown-car", "s-1");
    expect(closing.scoreIds("alex", "clown-car")).toEqual(["s-1"]);
  });

  it("forgets a score the Judge discarded: it won't be sent, so a closure doesn't name it", () => {
    const closing = createClosing(memoryStorage());
    closing.scored("alex", "clown-car", "s-1");
    closing.scored("alex", "clown-car", "s-2");
    closing.forget("alex", "clown-car", "s-1");
    expect(closing.scoreIds("alex", "clown-car")).toEqual(["s-2"]);
  });

  it("remembers a closure until the Judge reopens it", () => {
    const closing = createClosing(memoryStorage());
    const closed = { closureId: "c-1", scoreCount: 2, missing: 0 };
    closing.closed("alex", "clown-car", closed);
    expect(closing.closure("alex", "clown-car")).toEqual(closed);
    expect(closing.closure("sam", "clown-car")).toBeUndefined();
    expect([...closing.closedActivities("alex")]).toEqual(["clown-car"]);
    closing.reopen("alex", "clown-car");
    expect(closing.closure("alex", "clown-car")).toBeUndefined();
    // The scores are still listed: a later closure names them too.
  });

  it("survives storage that's broken or full", () => {
    const closing = createClosing({
      getItem: () => "{nope",
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(closing.scoreIds("alex", "clown-car")).toEqual([]);
    expect(() => closing.scored("alex", "clown-car", "s-1")).not.toThrow();
  });
});

describe("closing after a reset", () => {
  it("clears what the phone kept about scores and closures", () => {
    const storage = memoryStorage();
    const closing = createClosing(storage);
    closing.scored("alex", "clown-car", "s-1");
    closing.closed("alex", "clown-car", {
      closureId: "c-1",
      scoreCount: 1,
      missing: 0,
    });
    closing.clearAll();
    const again = createClosing(storage);
    expect(again.scoreIds("alex", "clown-car")).toEqual([]);
    expect(again.closure("alex", "clown-car")).toBeUndefined();
  });
});
