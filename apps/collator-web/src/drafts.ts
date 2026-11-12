import type { Entry, TimerState } from "@camporee-conductor/judge-form";

// Half-filled forms (#41 PR 4), kept on the phone per Activity × Team, so leaving the screen, a locked
// phone or a reload loses nothing. A draft is forgotten once its score is saved (sent or kept in the
// outbox); a refused one stays, for the Judge to fix.

export interface Draft {
  entry: Entry;
  /** Stopwatch timers by field id, so one still running keeps running. */
  timers: Record<string, TimerState>;
}

/** The part of localStorage used here, so tests can pass their own. */
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = "collator.drafts";

export function createDrafts(storage: DraftStorage) {
  const keyOf = (activityId: string, entrantId: string) =>
    `${activityId}/${entrantId}`;

  const readAll = (): Record<string, Draft> => {
    try {
      const raw = storage.getItem(KEY);
      const all = raw ? (JSON.parse(raw) as unknown) : {};
      return all && typeof all === "object"
        ? (all as Record<string, Draft>)
        : {};
    } catch {
      return {};
    }
  };
  const writeAll = (all: Record<string, Draft>) => {
    try {
      if (Object.keys(all).length === 0) storage.removeItem(KEY);
      else storage.setItem(KEY, JSON.stringify(all));
    } catch {
      // Private browsing or storage full: the form still works, without a draft.
    }
  };

  return {
    get: (activityId: string, entrantId: string): Draft | undefined =>
      readAll()[keyOf(activityId, entrantId)],
    save: (activityId: string, entrantId: string, draft: Draft) => {
      writeAll({ ...readAll(), [keyOf(activityId, entrantId)]: draft });
    },
    clear: (activityId: string, entrantId: string) => {
      const gone = keyOf(activityId, entrantId);
      writeAll(
        Object.fromEntries(
          Object.entries(readAll()).filter(([key]) => key !== gone),
        ),
      );
    },
    /** The Teams (or Groups) with a draft at this Activity. */
    entrantsWithDrafts: (activityId: string): Set<string> =>
      new Set(
        Object.keys(readAll())
          .filter((k) => k.startsWith(`${activityId}/`))
          .map((k) => k.slice(activityId.length + 1)),
      ),
  };
}

export type Drafts = ReturnType<typeof createDrafts>;
