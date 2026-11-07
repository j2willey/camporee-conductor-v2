import { useSyncExternalStore } from "react";
import { sendQueued } from "./api.ts";
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

/** How long a form waits for the box before telling the Judge it's kept on the phone. */
export const ANSWER_WAIT_MS = 3000;

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

export const outbox: Outbox = createOutbox({
  store: localStore,
  send: sendQueued,
  schedule: (fn, ms) => {
    setTimeout(fn, ms);
  },
});

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
