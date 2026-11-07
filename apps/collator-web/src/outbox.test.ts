import { describe, expect, it } from "vitest";
import {
  createOutbox,
  type OutboxItem,
  type OutboxStore,
  type SendResult,
} from "./outbox.ts";

// The phone's outbox (#41 PR 2): every score is kept on the phone before it's sent, and resent until the
// box answers. Resending is safe because each score carries the id the phone made (ADR-0027 item 8).

function memoryStore(initial: OutboxItem[] = [], works = true) {
  let saved = structuredClone(initial);
  const store: OutboxStore = {
    load: () => structuredClone(saved),
    save: (items) => {
      if (!works) return false;
      saved = structuredClone([...items]);
      return true;
    },
  };
  return { store, saved: () => saved };
}

/** A box whose answers the test scripts, one per send, and which records what it was sent. */
function scriptedBox(...answers: SendResult[]) {
  const sent: string[] = [];
  return {
    sent,
    send: (item: OutboxItem): Promise<SendResult> => {
      sent.push(item.id);
      return Promise.resolve(answers.shift() ?? { ok: true, repeat: false });
    },
  };
}

/** A timer the test fires by hand. */
function manualTimer() {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    pending,
    schedule: (fn: () => void, ms: number) => {
      pending.push({ fn, ms });
    },
    fire: () => pending.splice(0).forEach((t) => t.fn()),
  };
}

const item = (id: string): OutboxItem => ({
  id,
  path: `/api/scores/${id}`,
  body: { activityId: "a1", entrantId: "t1", values: { x: 1 } },
  label: `Score ${id}`,
  queuedAt: "2026-11-07T10:00:00.000Z",
});

const UNREACHABLE: SendResult = {
  ok: false,
  refused: false,
  message: "Can't reach the scoring box.",
};
const refused = (message: string): SendResult => ({
  ok: false,
  refused: true,
  message,
});

describe("outbox", () => {
  it("keeps a score on the phone before sending it, and forgets it once the box has it", async () => {
    const mem = memoryStore();
    const box = scriptedBox();
    const outbox = createOutbox({
      store: mem.store,
      send: (i) => {
        expect(mem.saved().map((s) => s.id)).toEqual(["s1"]);
        return box.send(i);
      },
      schedule: manualTimer().schedule,
    });

    expect(await outbox.sendNow(item("s1"))).toEqual({
      status: "sent",
      repeat: false,
    });
    expect(box.sent).toEqual(["s1"]);
    expect(outbox.items()).toEqual([]);
    expect(mem.saved()).toEqual([]);
  });

  it("says the box already had it when the answer is a repeat", async () => {
    const outbox = createOutbox({
      store: memoryStore().store,
      send: scriptedBox({ ok: true, repeat: true }).send,
      schedule: manualTimer().schedule,
    });
    expect(await outbox.sendNow(item("s1"))).toEqual({
      status: "sent",
      repeat: true,
    });
  });

  it("keeps a score the box can't be reached for, and resends it later with the same id", async () => {
    const mem = memoryStore();
    const box = scriptedBox(UNREACHABLE);
    const timer = manualTimer();
    const outbox = createOutbox({
      store: mem.store,
      send: box.send,
      schedule: timer.schedule,
    });

    expect(await outbox.sendNow(item("s1"))).toEqual({ status: "waiting" });
    expect(outbox.items().map((i) => i.id)).toEqual(["s1"]);
    expect(mem.saved().map((i) => i.id)).toEqual(["s1"]);
    expect(timer.pending).toHaveLength(1);

    timer.fire();
    await outbox.idle();
    expect(box.sent).toEqual(["s1", "s1"]);
    expect(outbox.items()).toEqual([]);
  });

  it("sends in the order the scores were kept, and stops at the first one the box can't be reached for", async () => {
    const box = scriptedBox({ ok: true, repeat: false }, UNREACHABLE);
    const outbox = createOutbox({
      store: memoryStore([item("s1"), item("s2"), item("s3")]).store,
      send: box.send,
      schedule: manualTimer().schedule,
    });

    await outbox.flush();
    expect(box.sent).toEqual(["s1", "s2"]);
    expect(outbox.items().map((i) => i.id)).toEqual(["s2", "s3"]);
  });

  it("a score added behind waiting ones waits its turn", async () => {
    const box = scriptedBox(UNREACHABLE);
    const outbox = createOutbox({
      store: memoryStore([item("s1")]).store,
      send: box.send,
      schedule: manualTimer().schedule,
    });

    expect(await outbox.sendNow(item("s2"))).toEqual({ status: "waiting" });
    expect(box.sent).toEqual(["s1"]);
    expect(outbox.items().map((i) => i.id)).toEqual(["s1", "s2"]);
  });

  it("hands a refused score straight back to the form, so the Judge can fix it", async () => {
    const outbox = createOutbox({
      store: memoryStore().store,
      send: scriptedBox(refused("Patrol Flag is wrong")).send,
      schedule: manualTimer().schedule,
    });

    expect(await outbox.sendNow(item("s1"))).toEqual({
      status: "refused",
      message: "Patrol Flag is wrong",
    });
    expect(outbox.items()).toEqual([]);
  });

  it("stops waiting after a while: the Judge moves on, and a later refusal is kept, not dropped", async () => {
    let release: (r: SendResult) => void = () => {};
    const timer = manualTimer();
    const outbox = createOutbox({
      store: memoryStore().store,
      send: () => new Promise((resolve) => (release = resolve)),
      schedule: timer.schedule,
    });

    const result = outbox.sendNow(item("s1"), { waitMs: 3000 });
    await Promise.resolve();
    expect(timer.pending.map((t) => t.ms)).toEqual([3000]);
    timer.fire();
    expect(await result).toEqual({ status: "waiting" });

    release(refused("No such Activity"));
    await outbox.idle();
    expect(outbox.items()).toEqual([
      { ...item("s1"), refused: "No such Activity" },
    ]);
  });

  it("keeps a score refused later, with the box's message, skips it, and lets the Judge discard it", async () => {
    const box = scriptedBox(refused("No such Activity"));
    const outbox = createOutbox({
      store: memoryStore([item("s1"), item("s2")]).store,
      send: box.send,
      schedule: manualTimer().schedule,
    });

    await outbox.flush();
    expect(box.sent).toEqual(["s1", "s2"]);
    expect(outbox.items()).toEqual([
      { ...item("s1"), refused: "No such Activity" },
    ]);

    await outbox.flush();
    expect(box.sent).toEqual(["s1", "s2"]);

    outbox.discard("s1");
    expect(outbox.items()).toEqual([]);
  });

  it("backs off between retries, up to 30 seconds, and starts again after a send gets through", async () => {
    const box = scriptedBox(
      UNREACHABLE,
      UNREACHABLE,
      UNREACHABLE,
      UNREACHABLE,
      UNREACHABLE,
      UNREACHABLE,
    );
    const timer = manualTimer();
    const outbox = createOutbox({
      store: memoryStore([item("s1")]).store,
      send: box.send,
      schedule: timer.schedule,
    });

    const waits: number[] = [];
    await outbox.flush();
    for (let i = 0; i < 5; i++) {
      waits.push(timer.pending[0]?.ms ?? -1);
      timer.fire();
      await outbox.idle();
    }
    waits.push(timer.pending[0]?.ms ?? -1);
    expect(waits).toEqual([2000, 4000, 8000, 16000, 30000, 30000]);

    timer.fire();
    await outbox.idle();
    expect(outbox.items()).toEqual([]);
    expect(timer.pending).toHaveLength(0);

    box.sent.length = 0;
    const again = createOutbox({
      store: memoryStore([item("s2")]).store,
      send: scriptedBox(UNREACHABLE).send,
      schedule: timer.schedule,
    });
    await again.flush();
    expect(timer.pending[0]?.ms).toBe(2000);
  });

  it("runs one send at a time: a second flush during a send waits for the first", async () => {
    let release: (r: SendResult) => void = () => {};
    const sent: string[] = [];
    const outbox = createOutbox({
      store: memoryStore([item("s1")]).store,
      send: (i) => {
        sent.push(i.id);
        return new Promise((resolve) => (release = resolve));
      },
      schedule: manualTimer().schedule,
    });

    const first = outbox.flush();
    const second = outbox.flush();
    release({ ok: true, repeat: false });
    await Promise.all([first, second]);
    expect(sent).toEqual(["s1"]);
  });

  it("picks up where it left off after the page reloads", async () => {
    const mem = memoryStore([item("s1")]);
    const box = scriptedBox();
    const outbox = createOutbox({
      store: mem.store,
      send: box.send,
      schedule: manualTimer().schedule,
    });
    expect(outbox.items().map((i) => i.id)).toEqual(["s1"]);
    await outbox.flush();
    expect(box.sent).toEqual(["s1"]);
  });

  it("tells listeners when the list changes", async () => {
    const outbox = createOutbox({
      store: memoryStore().store,
      send: scriptedBox(UNREACHABLE).send,
      schedule: manualTimer().schedule,
    });
    const seen: number[] = [];
    const stop = outbox.subscribe(() => seen.push(outbox.items().length));
    await outbox.sendNow(item("s1"));
    stop();
    outbox.discard("s1");
    expect(seen.at(-1)).toBe(1);
  });

  it("says when the phone can't keep scores, and still sends them while the page is open", async () => {
    const box = scriptedBox(UNREACHABLE);
    const timer = manualTimer();
    const outbox = createOutbox({
      store: memoryStore([], false).store,
      send: box.send,
      schedule: timer.schedule,
    });

    expect(await outbox.sendNow(item("s1"))).toEqual({ status: "waiting" });
    expect(outbox.kept()).toBe(false);
    expect(outbox.items().map((i) => i.id)).toEqual(["s1"]);
    timer.fire();
    await outbox.idle();
    expect(outbox.items()).toEqual([]);
  });
});
