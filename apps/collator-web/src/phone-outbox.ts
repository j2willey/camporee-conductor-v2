import { useSyncExternalStore } from "react";
import { api, onBoxEpoch, sendQueued } from "./api.ts";
import { createEpochWatcher, resendMissing } from "./epoch-watch.ts";
import { isScore } from "./offline-data.ts";
import { closing } from "./phone-closing.ts";
import { addNotice } from "./phone-notices.ts";
import { createSentArchive } from "./sent-archive.ts";
import {
  createOutbox,
  type Outbox,
  type OutboxItem,
  type OutboxStore,
} from "./outbox.ts";

// The outbox on this phone: kept in localStorage, which writes before the send starts, so a saved score
// is never only in memory (#41 PR 2). It sends whenever the phone comes back online or the page is shown
// again, and on its own retry timer.

const KEY = "collator.outbox";

/**
 * How long a form waits for the box before telling the Judge it's kept on the phone: 3 s while a send is
 * under way and slow, none when the phone knows it's offline. Out of range is normal, not something to
 * wait out (#41).
 */
export const answerWaitMs = () => (navigator.onLine ? 3000 : 0);

const localStore: OutboxStore = {
  load: () => {
    try {
      const raw = localStorage.getItem(KEY);
      const items = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(items) ? (items as OutboxItem[]) : [];
    } catch {
      return [];
    }
  },
  save: (items) => {
    try {
      if (items.length === 0) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify(items));
      return true;
    } catch {
      // Private browsing or storage full: still sent while this page stays open.
      return false;
    }
  },
};

// What this phone knows of the box epoch, and what the box confirmed, for a restore or a reset (#66).
const EPOCH_KEY = "collator.epoch";
const knownEpoch = () => {
  try {
    return localStorage.getItem(EPOCH_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Everything the box confirmed, kept per Event so a restored box can be sent it again. */
export const sentArchive = createSentArchive({
  storage: localStorage,
  key: () => {
    let event = "event";
    try {
      const kept = JSON.parse(
        localStorage.getItem("collator.event") ?? "null",
      ) as { event?: { id?: string } } | null;
      event = kept?.event?.id ?? event;
    } catch {
      // No event kept yet.
    }
    return `collator.sent.${event}`;
  },
});

// The watcher is made below, once the outbox exists; the outbox asks it to look before each send run.
const late: { watcher?: ReturnType<typeof createEpochWatcher> } = {};

export const outbox: Outbox = createOutbox({
  store: localStore,
  send: sendQueued,
  schedule: (fn, ms) => {
    setTimeout(fn, ms);
  },
  epoch: knownEpoch,
  onConfirmed: (item, { epoch }) => {
    const confirmedEpoch = epoch ?? knownEpoch();
    sentArchive.add({
      ...item,
      ...(confirmedEpoch !== undefined && { confirmedEpoch }),
    });
  },
  // A reset or restore found out now, before a stale score goes to the box.
  beforeRun: async () => {
    await late.watcher?.sync();
  },
});

const watcher = createEpochWatcher({
  known: {
    get: knownEpoch,
    set: (id) => {
      try {
        localStorage.setItem(EPOCH_KEY, id);
      } catch {
        // Not kept: learned again from the next answer.
      }
    },
  },
  fetchEpochs: api.epochs,
  outbox,
  archive: sentArchive,
  say: addNotice,
  onReset: () => {
    // The box has none of the scores or closures this phone remembers; what's still queued is new.
    closing.clearAll();
    for (const item of outbox.items()) {
      const score = item.body as {
        judge?: { id: string };
        activityId?: string;
      };
      if (isScore(item) && score.judge && score.activityId)
        closing.scored(score.judge.id, score.activityId, item.id);
    }
  },
});

late.watcher = watcher;

// Any answer carrying a different epoch: look, then send what was put back.
onBoxEpoch((id) => {
  void watcher.seen(id).then(() => outbox.flush());
});

/** A closure said the box is missing these scores: send again the ones this phone kept. */
export function resendMissingScores(missing: readonly string[]): number {
  const n = resendMissing(
    { archive: sentArchive, outbox, ...epochOption() },
    missing,
  );
  if (n > 0) void outbox.flush();
  return n;
}
const epochOption = () => {
  const epoch = knownEpoch();
  return epoch === undefined ? {} : { epoch };
};

window.addEventListener("online", () => void outbox.flush());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void outbox.flush();
});
// Anything left from before a reload goes now.
void outbox.flush();

/** The outbox's items, re-rendering when they change. */
export function useOutboxItems(): readonly OutboxItem[] {
  return useSyncExternalStore(outbox.subscribe, outbox.items);
}
