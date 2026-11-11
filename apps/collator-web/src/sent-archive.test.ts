import { describe, expect, it, vi } from "vitest";
import { createSentArchive, type ArchiveEntry } from "./sent-archive.ts";

function memoryStorage(limit = Infinity) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
  };
}

const entry = (id: string, confirmedEpoch = "e1"): ArchiveEntry => ({
  id,
  path: `/api/scores/${id}`,
  body: { activityId: "a1", entrantId: "t1", values: { x: 1 } },
  label: `Score ${id}`,
  queuedAt: "2026-11-07T10:00:00.000Z",
  epoch: "e1",
  confirmedEpoch,
});

describe("sent archive", () => {
  it("keeps confirmed requests in the order first sent, across a reload", () => {
    const storage = memoryStorage();
    const key = () => "collator.sent.event-1";
    const archive = createSentArchive({ storage, key });
    archive.add(entry("s1"));
    archive.add(entry("g1"));
    archive.add(entry("s2"));
    expect(
      createSentArchive({ storage, key })
        .entries()
        .map((x) => x.id),
    ).toEqual(["s1", "g1", "s2"]);
  });

  it("updates one it already has in place: the order stays, the epoch it was confirmed in changes", () => {
    const archive = createSentArchive({
      storage: memoryStorage(),
      key: () => "k",
    });
    archive.add(entry("s1", "e1"));
    archive.add(entry("s2", "e1"));
    archive.add(entry("s1", "e2"));
    expect(archive.entries().map((x) => [x.id, x.confirmedEpoch])).toEqual([
      ["s1", "e2"],
      ["s2", "e1"],
    ]);
  });

  it("keeps each Event's separately", () => {
    const storage = memoryStorage();
    createSentArchive({ storage, key: () => "event-1" }).add(entry("s1"));
    expect(
      createSentArchive({ storage, key: () => "event-2" }).entries(),
    ).toEqual([]);
  });

  it("clears", () => {
    const archive = createSentArchive({
      storage: memoryStorage(),
      key: () => "k",
    });
    archive.add(entry("s1"));
    archive.clear();
    expect(archive.entries()).toEqual([]);
  });

  it("copes with storage that's broken or unreadable", () => {
    const archive = createSentArchive({
      storage: {
        getItem: () => "{nope",
        setItem: () => {
          throw new Error("denied");
        },
      },
      key: () => "k",
      warn: () => {},
    });
    expect(archive.entries()).toEqual([]);
    expect(() => archive.add(entry("s1"))).not.toThrow();
  });

  it("when storage is full, drops the oldest entries and warns", () => {
    const warn = vi.fn();
    const one = JSON.stringify([entry("s1")]).length;
    const archive = createSentArchive({
      storage: memoryStorage(one * 2 + 10),
      key: () => "k",
      warn,
    });
    archive.add(entry("s1"));
    archive.add(entry("s2"));
    archive.add(entry("s3"));
    expect(archive.entries().map((x) => x.id)).toEqual(["s2", "s3"]);
    expect(warn).toHaveBeenCalled();
  });
});
