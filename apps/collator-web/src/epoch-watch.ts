import { decideEpoch, type EpochAnswer } from "./epoch-decision.ts";
import { isScore } from "./offline-data.ts";
import type { Outbox } from "./outbox.ts";
import type { ArchiveEntry, SentArchive } from "./sent-archive.ts";

/** An archive entry as an outbox item again: the same id and request, without the epoch it was confirmed in. */
const asItem = ({ confirmedEpoch, ...item }: ArchiveEntry) => {
  void confirmedEpoch;
  return item;
};

// The phone notices a new box epoch and acts (#66).

export interface EpochWatcher {
  /** An answer from the box carried this epoch id (the `x-box-epoch` header, or `/api/event`). */
  seen(id: string): Promise<void>;
  /** Ask the box which epoch it is in now, and act if it changed. Resolves quietly when the box can't be reached. */
  sync(): Promise<void>;
}

export function createEpochWatcher({
  known,
  fetchEpochs,
  outbox,
  archive,
  say,
  onReset,
}: {
  known: { get(): string | undefined; set(id: string): void };
  fetchEpochs: (since: string) => Promise<EpochAnswer>;
  /** Putting items back doesn't send them: the caller flushes (or is already sending). */
  outbox: Pick<Outbox, "items" | "dropWhere" | "requeue">;
  archive: SentArchive;
  /** Tell the Judge, plainly. */
  say: (message: string) => void;
  /** After a reset: forget what the phone keeps about scores the box no longer has. */
  onReset?: () => void;
}): EpochWatcher {
  let checking: Promise<void> | null = null;

  const act = (answer: EpochAnswer) => {
    const current = answer.current.id;
    const action = decideEpoch(answer);
    if (action === "reset") {
      const stale = outbox.dropWhere(
        (i) => i.epoch !== undefined && i.epoch !== current,
      );
      const unsent = stale.filter(
        (i) => i.refused === undefined && isScore(i),
      ).length;
      const kept = archive.entries().length;
      archive.clear();
      onReset?.();
      if (unsent > 0) {
        say(
          `The box was reset; ${unsent} unsent ${unsent === 1 ? "score from before the reset was" : "scores from before the reset were"} discarded.`,
        );
      } else if (kept > 0 || stale.length > 0) {
        say(
          "The box was reset; scores sent before the reset are no longer kept on this phone.",
        );
      }
    } else if (action === "restore") {
      const back = archive
        .entries()
        .filter((e) => e.confirmedEpoch !== current)
        .map((entry) => ({
          ...asItem(entry),
          epoch: current,
        }));
      outbox.requeue(back);
      if (back.length > 0)
        say(`The box was restored; resending ${back.length} items.`);
    }
    known.set(current);
  };

  const check = (since: string): Promise<void> =>
    (checking ??= fetchEpochs(since)
      .then(act, () => {
        // The box can't be reached: keep what's known, and look again on the next answer.
      })
      .finally(() => {
        checking = null;
      }));

  return {
    seen: (id) => {
      const was = known.get();
      if (was === undefined) {
        known.set(id);
        return Promise.resolve();
      }
      return was === id ? Promise.resolve() : check(was);
    },
    sync: () => {
      const was = known.get();
      return was === undefined ? Promise.resolve() : check(was);
    },
  };
}

/** Closure answered with score ids the box doesn't have: put those the phone kept back in the outbox. Returns how many. */
export function resendMissing(
  {
    archive,
    outbox,
    epoch,
  }: {
    archive: SentArchive;
    outbox: Pick<Outbox, "requeue">;
    epoch?: string;
  },
  missing: readonly string[],
): number {
  const lost = new Set(missing);
  const back = archive
    .entries()
    .filter((e) => lost.has(e.id))
    .map((entry) => ({
      ...asItem(entry),
      ...(epoch !== undefined && { epoch }),
    }));
  outbox.requeue(back);
  return back.length;
}
