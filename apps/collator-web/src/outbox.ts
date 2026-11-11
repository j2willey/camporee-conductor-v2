// The phone's outbox (#41 PR 2). Phones lose Wi-Fi at stations, so every score is kept on the phone first
// and sent from here, resent until the box answers. A resend is always safe: the request carries the id
// the phone made, and the box answers "repeat" for one it already has (ADR-0027 item 8).
//
// Sends go one at a time, in the order they were kept, and stop at the first one the box can't be reached
// for. A score the box refuses (it answered, and said no) is kept with the box's message until the Judge
// discards it: resending it unchanged can't help.

/** One request waiting to go to the box. Generic, so roster adds can join the queue later (#41 PR 3). */
export interface OutboxItem {
  /** The id the phone made; the request's path ends with it. */
  id: string;
  /** Where to PUT it, e.g. `/api/scores/<id>`. */
  path: string;
  body: unknown;
  /** What the Judge sees, e.g. "Flaming Arrows (Troop 101) at Clown Car". */
  label: string;
  queuedAt: string;
  /** The box epoch the phone knew when this was made (#66): a reset drops what was made before it. */
  epoch?: string;
  /** The box's message, once it refused this one. */
  refused?: string;
}

/** What one send got back. `refused`: the box answered and said no; otherwise it couldn't be reached. */
export type SendResult =
  | { ok: true; repeat: boolean; epoch?: string }
  | { ok: false; refused: boolean; message: string };

/** Where the outbox is kept on the phone. `save` answers false when the phone wouldn't keep it. */
export interface OutboxStore {
  load(): OutboxItem[];
  save(items: readonly OutboxItem[]): boolean;
}

/** What happened to a score the Judge just saved. */
export type SendNowResult =
  | { status: "sent"; repeat: boolean }
  | { status: "waiting" }
  | { status: "refused"; message: string };

export interface Outbox {
  /** Everything not yet in the box: waiting ones, and refused ones until discarded. */
  items(): readonly OutboxItem[];
  /** False when the phone wouldn't keep the outbox (private browsing, storage full). */
  kept(): boolean;
  /**
   * Keep a new score, then send what's waiting. A refusal of this one hands it back to the form. After
   * `waitMs` with no answer it resolves "waiting": the Judge moves on, and a later refusal is kept here.
   */
  sendNow(
    item: OutboxItem,
    options?: { waitMs?: number },
  ): Promise<SendNowResult>;
  /** Send what's waiting, in order. */
  flush(): Promise<void>;
  /** Resolves once the current send run (if any) has finished. */
  idle(): Promise<void>;
  discard(id: string): void;
  /** Take out the items `drop` picks (a reset: made before it, so never sent) and return them. */
  dropWhere(drop: (item: OutboxItem) => boolean): OutboxItem[];
  /** Put items back to send again, first and in this order, skipping ids already here (a restore). */
  requeue(items: readonly OutboxItem[]): void;
  subscribe(listener: () => void): () => void;
}

const FIRST_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

export function createOutbox({
  store,
  send,
  schedule,
  epoch,
  onConfirmed,
  beforeRun,
}: {
  store: OutboxStore;
  send: (item: OutboxItem) => Promise<SendResult>;
  /** The box epoch the phone knows now: stamped on each new item. */
  epoch?: () => string | undefined;
  /** The box confirmed this item (created or repeat): the sent archive keeps it. */
  onConfirmed?: (
    item: OutboxItem,
    result: { repeat: boolean; epoch?: string },
  ) => void;
  /** Runs before each send run that has something to send: the phone checks the box epoch here. Failures are ignored. */
  beforeRun?: () => Promise<void>;
  /** Run `fn` once after `ms`: `setTimeout` in the browser. */
  schedule: (fn: () => void, ms: number) => void;
}): Outbox {
  let items: OutboxItem[] = store.load();
  let kept = true;
  let running: Promise<void> | null = null;
  let retryMs = FIRST_RETRY_MS;
  let retryPending = false;
  const listeners = new Set<() => void>();
  /** Results for scores the Judge is waiting on, by id. */
  const awaited = new Map<string, (r: SendNowResult) => void>();

  const update = (next: OutboxItem[]) => {
    items = next;
    kept = store.save(items);
    listeners.forEach((l) => l());
  };

  const retryLater = () => {
    if (retryPending) return;
    retryPending = true;
    const wait = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    schedule(() => {
      retryPending = false;
      void flush();
    }, wait);
  };

  const run = async () => {
    for (;;) {
      const next = items.find((i) => i.refused === undefined);
      if (!next) break;
      const result = await send(next);
      if (result.ok) {
        retryMs = FIRST_RETRY_MS;
        update(items.filter((i) => i.id !== next.id));
        awaited.get(next.id)?.({ status: "sent", repeat: result.repeat });
      } else if (result.refused) {
        const answer = awaited.get(next.id);
        if (answer) {
          // The Judge is still on the form: hand it back to fix, rather than keeping it here.
          update(items.filter((i) => i.id !== next.id));
          answer({ status: "refused", message: result.message });
        } else {
          update(
            items.map((i) =>
              i.id === next.id ? { ...i, refused: result.message } : i,
            ),
          );
        }
      } else {
        retryLater();
        break;
      }
      awaited.delete(next.id);
    }
    // Anyone still waiting is behind a send that didn't get through.
    awaited.forEach((answer) => answer({ status: "waiting" }));
    awaited.clear();
  };

  const flush = (): Promise<void> => {
    running ??= run().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    items: () => items,
    kept: () => kept,
    sendNow: async (item, { waitMs } = {}) => {
      update([...items, item]);
      const result = new Promise<SendNowResult>((resolve) =>
        awaited.set(item.id, resolve),
      );
      if (waitMs !== undefined) {
        schedule(() => {
          awaited.get(item.id)?.({ status: "waiting" });
          awaited.delete(item.id);
        }, waitMs);
      }
      // A run already going may have passed this item's turn: wait for it, then run again.
      if (running) await running;
      void flush();
      return result;
    },
    flush,
    idle: () => running ?? Promise.resolve(),
    discard: (id) => update(items.filter((i) => i.id !== id)),
    dropWhere: () => {
      throw new Error("not implemented");
    },
    requeue: () => {
      throw new Error("not implemented");
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
