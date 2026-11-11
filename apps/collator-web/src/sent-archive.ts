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

export function createSentArchive({
  storage,
  key,
  warn = (message) => console.warn(message),
}: {
  storage: ArchiveStorage;
  /** Where it's kept: per Event. */
  key: () => string;
  warn?: (message: string) => void;
}): SentArchive {
  const read = (): ArchiveEntry[] => {
    try {
      const raw = storage.getItem(key());
      const entries = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(entries) ? (entries as ArchiveEntry[]) : [];
    } catch {
      return [];
    }
  };
  /** Writes, dropping the oldest entries while the phone says it's full. */
  const write = (entries: ArchiveEntry[]) => {
    let keep = entries;
    for (;;) {
      try {
        storage.setItem(key(), JSON.stringify(keep));
        break;
      } catch {
        if (keep.length === 0) return;
        keep = keep.slice(1);
      }
    }
    if (keep.length < entries.length) {
      warn(
        `The phone's storage is full: ${entries.length - keep.length} of the oldest sent scores are no longer kept for resending.`,
      );
    }
  };

  return {
    entries: read,
    add: (entry) => {
      const entries = read();
      const at = entries.findIndex((e) => e.id === entry.id);
      if (at < 0) entries.push(entry);
      else entries[at] = entry;
      write(entries);
    },
    clear: () => write([]),
  };
}
