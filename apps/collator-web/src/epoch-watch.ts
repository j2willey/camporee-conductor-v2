import type { EpochAnswer } from "./epoch-decision.ts";
import type { Outbox } from "./outbox.ts";
import type { SentArchive } from "./sent-archive.ts";

// The phone notices a new box epoch and acts (#66).

export interface EpochWatcher {
  /** An answer from the box carried this epoch id (the `x-box-epoch` header, or `/api/event`). */
  seen(id: string): Promise<void>;
  /** Ask the box which epoch it is in now, and act if it changed. Resolves quietly when the box can't be reached. */
  sync(): Promise<void>;
}

export function createEpochWatcher(_options: {
  known: { get(): string | undefined; set(id: string): void };
  fetchEpochs: (since: string) => Promise<EpochAnswer>;
  outbox: Pick<Outbox, "items" | "dropWhere" | "requeue" | "flush">;
  archive: SentArchive;
  /** Tell the Judge, plainly. */
  say: (message: string) => void;
  /** After a reset: forget what the phone keeps about scores the box no longer has. */
  onReset?: () => void;
}): EpochWatcher {
  throw new Error("not implemented");
}

/** Closure answered with score ids the box doesn't have: put those the phone kept back in the outbox. Returns how many. */
export function resendMissing(
  _options: {
    archive: SentArchive;
    outbox: Pick<Outbox, "requeue" | "flush">;
    epoch?: string;
  },
  _missing: readonly string[],
): number {
  throw new Error("not implemented");
}
