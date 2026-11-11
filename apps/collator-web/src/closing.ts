// Close Game on the phone (#41 PR 6; v1's "I'm done, close game"). The phone keeps the ids of every
// score it saved at each Activity, per Judge, so a closure can name them all and the box can say whether
// it has them; and which Activities this Judge has closed, until they reopen one by scoring there again.

/** The part of localStorage used here, so tests can pass their own. */
export interface ClosingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A closure the box confirmed. */
export interface Closed {
  closureId: string;
  scoreCount: number;
  /** How many of those scores the box didn't have. */
  missing: number;
}

interface State {
  /** `judgeId/activityId` → score ids, in the order saved. */
  scored: Record<string, string[]>;
  closed: Record<string, Closed>;
}

const KEY = "collator.closing";

export function createClosing(storage: ClosingStorage) {
  const keyOf = (judgeId: string, activityId: string) =>
    `${judgeId}/${activityId}`;
  const read = (): State => {
    try {
      const raw = storage.getItem(KEY);
      const state = raw ? (JSON.parse(raw) as Partial<State>) : {};
      return { scored: state.scored ?? {}, closed: state.closed ?? {} };
    } catch {
      return { scored: {}, closed: {} };
    }
  };
  const write = (state: State) => {
    try {
      storage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Not kept: a closure then names only what this page saved since it opened.
    }
  };

  return {
    /** A score saved at this Activity (sent, or kept in the outbox). */
    scored: (judgeId: string, activityId: string, scoreId: string) => {
      const state = read();
      const key = keyOf(judgeId, activityId);
      const ids = state.scored[key] ?? [];
      if (!ids.includes(scoreId)) state.scored[key] = [...ids, scoreId];
      write(state);
    },
    /** A score discarded on the phone: it will never reach the box. */
    forget: (judgeId: string, activityId: string, scoreId: string) => {
      const state = read();
      const key = keyOf(judgeId, activityId);
      state.scored[key] = (state.scored[key] ?? []).filter(
        (id) => id !== scoreId,
      );
      write(state);
    },
    scoreIds: (judgeId: string, activityId: string): string[] =>
      read().scored[keyOf(judgeId, activityId)] ?? [],
    closed: (judgeId: string, activityId: string, closed: Closed) => {
      const state = read();
      state.closed[keyOf(judgeId, activityId)] = closed;
      write(state);
    },
    closure: (judgeId: string, activityId: string): Closed | undefined =>
      read().closed[keyOf(judgeId, activityId)],
    reopen: (judgeId: string, activityId: string) => {
      const state = read();
      const gone = keyOf(judgeId, activityId);
      write({
        ...state,
        closed: Object.fromEntries(
          Object.entries(state.closed).filter(([key]) => key !== gone),
        ),
      });
    },
    /** After a reset: the box has none of the scores or closures this phone remembers. */
    clearAll: () => write({ scored: {}, closed: {} }),
    /** The Activities this Judge has closed. */
    closedActivities: (judgeId: string): Set<string> =>
      new Set(
        Object.keys(read().closed)
          .filter((k) => k.startsWith(`${judgeId}/`))
          .map((k) => k.slice(judgeId.length + 1)),
      ),
  };
}

export type Closing = ReturnType<typeof createClosing>;
