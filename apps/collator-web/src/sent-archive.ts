// Everything the box confirmed, kept on the phone (#66, ADR-0027 "Reset, restore and the box epoch"): if the box is
// restored from an earlier backup it can lose what it confirmed since, and the phone puts these back in the outbox.

/** The part of localStorage used here, so tests can pass their own. */
export interface ArchiveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One request the box confirmed: scores, Group and Team adds, closures. */
export interface ArchiveEntry {
  id: string;
  path: string;
  body: unknown;
  label: string;
  queuedAt: string;
  /** The epoch the phone knew when it made this. */
  epoch?: string;
  /** The epoch the box was in when it confirmed this. */
  confirmedEpoch?: string | undefined;
}

export interface SentArchive {
  /** In the order first sent. */
  entries(): ArchiveEntry[];
  /** Keeps a confirmed request. One already kept (same id) is updated in place, so the order stays. */
  add(entry: ArchiveEntry): void;
  clear(): void;
}

export function createSentArchive(_options: {
  storage: ArchiveStorage;
  /** Where it's kept: per Event. */
  key: () => string;
  warn?: (message: string) => void;
}): SentArchive {
  throw new Error("not implemented");
}
