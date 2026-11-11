import { describe, expect, it } from "vitest";
import { createEpochWatcher, resendMissing } from "./epoch-watch.ts";
import type { EpochAnswer, EpochInfo } from "./epoch-decision.ts";
import { createOutbox, type OutboxItem, type SendResult } from "./outbox.ts";
import { createSentArchive } from "./sent-archive.ts";

// The phone acts on a new box epoch (#66): after a restore it resends what the box lost, after a reset it drops
// what it kept. These run the real outbox and archive against a scripted box.

const e = (id: string, reason: EpochInfo["reason"]): EpochInfo => ({
  id,
  reason,
});

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

/** A phone: its outbox and archive, the epoch it knows, and a box that holds what it was sent. */
function phone(knownAtStart: string | undefined, epochs: EpochInfo[]) {
  let known = knownAtStart;
  const said: string[] = [];
  const onBox = new Set<string>();
  let boxEpoch = knownAtStart ?? "e1";
  let reachable = true;
  const resets: string[] = [];
  const archive = createSentArchive({
    storage: memoryStorage(),
    key: () => "event",
  });
  let stored: OutboxItem[] = [];
  const sentLog: string[] = [];
  const outbox = createOutbox({
    store: { load: () => stored, save: (i) => ((stored = [...i]), true) },
    send: (i): Promise<SendResult> => {
      if (!reachable)
        return Promise.resolve({ ok: false, refused: false, message: "no" });
      sentLog.push(i.id);
      const repeat = onBox.has(i.id);
      onBox.add(i.id);
      return Promise.resolve({ ok: true, repeat, epoch: boxEpoch });
    },
    schedule: () => {},
    epoch: () => known,
    onConfirmed: (i, r) =>
      archive.add({ ...i, confirmedEpoch: r.epoch ?? known }),
  });
  const watcher = createEpochWatcher({
    known: { get: () => known, set: (id) => (known = id) },
    fetchEpochs: (since): Promise<EpochAnswer> => {
      const at = epochs.findIndex((x) => x.id === since);
      return Promise.resolve({
        current: epochs.at(-1) as EpochInfo,
        since: at < 0 ? null : epochs.slice(at + 1),
        unknown: at < 0,
      });
    },
    outbox,
    archive,
    say: (m) => said.push(m),
    onReset: () => resets.push("reset"),
  });
  const score = (id: string) =>
    outbox.sendNow({
      id,
      path: `/api/scores/${id}`,
      body: { activityId: "a1" },
      label: id,
      queuedAt: "t",
    });
  return {
    outbox,
    archive,
    watcher,
    said,
    onBox,
    sentLog,
    resets,
    score,
    known: () => known,
    boxLoses: (...ids: string[]) => ids.forEach((id) => onBox.delete(id)),
    boxIsNow: (id: string) => (boxEpoch = id),
    goOffline: () => (reachable = false),
  };
}

describe("epoch watcher", () => {
  it("adopts the first epoch it sees without doing anything", async () => {
    const p = phone(undefined, [e("e1", "created")]);
    await p.watcher.seen("e1");
    expect(p.known()).toBe("e1");
    expect(p.said).toEqual([]);
  });

  it("does nothing when the epoch is the one it knows", async () => {
    const p = phone("e1", [e("e1", "created")]);
    await p.score("s1");
    await p.watcher.seen("e1");
    expect(p.outbox.items()).toEqual([]);
    expect(p.said).toEqual([]);
  });

  it("after a restore, puts everything the box confirmed back in the outbox, in order and with the same ids, and says so", async () => {
    const p = phone("e1", [e("e1", "created"), e("e2", "restore")]);
    await p.score("s1");
    await p.score("s2");
    await p.score("s3");
    p.boxLoses("s2", "s3"); // the backup was taken after s1
    p.boxIsNow("e2");
    await p.watcher.seen("e2");
    expect(p.said).toEqual(["The box was restored; resending 3 items."]);
    expect(p.known()).toBe("e2");
    expect(p.outbox.items().map((i) => i.id)).toEqual(["s1", "s2", "s3"]);
    await p.outbox.flush();
    expect([...p.onBox].sort()).toEqual(["s1", "s2", "s3"]);
    // Resent items carry the new epoch, and a second sight of it does nothing more.
    expect(p.archive.entries().map((x) => x.confirmedEpoch)).toEqual([
      "e2",
      "e2",
      "e2",
    ]);
    await p.watcher.seen("e2");
    expect(p.said).toHaveLength(1);
  });

  it("after a restore, doesn't resend what was confirmed in the new epoch", async () => {
    const p = phone("e1", [e("e1", "created"), e("e2", "restore")]);
    await p.score("s1");
    p.boxIsNow("e2");
    await p.score("s2"); // confirmed in e2 before the phone noticed
    await p.watcher.seen("e2");
    expect(p.outbox.items().map((i) => i.id)).toEqual(["s1"]);
    expect(p.said).toEqual(["The box was restored; resending 1 items."]);
  });

  it("resends everything when the box doesn't know the epoch the phone knew", async () => {
    const p = phone("old", [e("e9", "restore")]);
    await p.score("s1");
    await p.watcher.seen("e9");
    expect(p.outbox.items().map((i) => i.id)).toEqual(["s1"]);
    expect(p.known()).toBe("e9");
  });

  it("after a reset, drops the archive and every queued item made under an older epoch, and says how many were unsent", async () => {
    const p = phone("e1", [e("e1", "created"), e("e2", "reset")]);
    await p.score("s1"); // confirmed
    p.goOffline();
    await p.score("s2");
    await p.score("s3"); // queued under e1
    await p.watcher.seen("e2");
    expect(p.archive.entries()).toEqual([]);
    expect(p.outbox.items()).toEqual([]);
    expect(p.resets).toEqual(["reset"]);
    expect(p.said).toEqual([
      "The box was reset; 2 unsent scores from before the reset were discarded.",
    ]);
    expect(p.known()).toBe("e2");
  });

  it("after a reset, keeps what was queued under the new epoch", async () => {
    const p = phone("e1", [e("e1", "created"), e("e2", "reset")]);
    p.goOffline();
    const queued = (id: string, epoch: string) => ({
      id,
      path: `/api/scores/${id}`,
      body: {},
      label: id,
      queuedAt: "t",
      epoch,
    });
    p.outbox.requeue([queued("before", "e1"), queued("after", "e2")]);
    await p.watcher.seen("e2");
    expect(p.outbox.items().map((i) => i.id)).toEqual(["after"]);
  });

  it("after a reset that sent scores already confirmed, says the phone no longer keeps them", async () => {
    const p = phone("e1", [e("e1", "created"), e("e2", "reset")]);
    await p.score("s1");
    await p.watcher.seen("e2");
    expect(p.said).toEqual([
      "The box was reset; scores sent before the reset are no longer kept on this phone.",
    ]);
  });

  it("says nothing after a reset when the phone had nothing", async () => {
    const p = phone("e1", [e("e1", "created"), e("e2", "reset")]);
    await p.watcher.seen("e2");
    expect(p.said).toEqual([]);
    expect(p.known()).toBe("e2");
  });

  it("restore then reset drops, and reset then restore drops", async () => {
    for (const reasons of [
      ["restore", "reset"],
      ["reset", "restore"],
    ] as const) {
      const p = phone("e1", [
        e("e1", "created"),
        e("e2", reasons[0]),
        e("e3", reasons[1]),
      ]);
      await p.score("s1");
      await p.watcher.seen("e3");
      expect(p.outbox.items()).toEqual([]);
      expect(p.archive.entries()).toEqual([]);
    }
  });

  it("keeps the epoch it knew when the box can't be reached, and tries again on the next sight", async () => {
    let up = false;
    const p = phone("e1", [e("e1", "created"), e("e2", "restore")]);
    const watcher = createEpochWatcher({
      known: { get: () => "e1", set: () => {} },
      fetchEpochs: () =>
        up
          ? Promise.resolve({
              current: e("e2", "restore"),
              since: [e("e2", "restore")],
              unknown: false,
            })
          : Promise.reject(new Error("no")),
      outbox: p.outbox,
      archive: p.archive,
      say: (m) => p.said.push(m),
    });
    await watcher.seen("e2");
    expect(p.said).toEqual([]);
    up = true;
    await p.score("s1");
    await watcher.seen("e2");
    expect(p.said).toEqual(["The box was restored; resending 1 items."]);
  });

  it("sync checks the box even with no header in hand", async () => {
    const p = phone("e1", [e("e1", "created"), e("e2", "restore")]);
    await p.score("s1");
    await p.watcher.sync();
    expect(p.known()).toBe("e2");
    expect(p.outbox.items().map((i) => i.id)).toEqual(["s1"]);
  });
});

describe("a closure that reports missing scores", () => {
  it("puts back the ones the phone kept, and only those", async () => {
    const p = phone("e1", [e("e1", "created")]);
    await p.score("s1");
    await p.score("s2");
    const n = resendMissing(
      { archive: p.archive, outbox: p.outbox, epoch: "e1" },
      ["s2", "never-kept"],
    );
    expect(n).toBe(1);
    expect(p.outbox.items().map((i) => i.id)).toEqual(["s2"]);
  });
});
