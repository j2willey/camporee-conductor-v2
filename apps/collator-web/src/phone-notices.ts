import { useSyncExternalStore } from "react";

// Plain notes for the Judge from things the phone did on its own (#66: the box was reset or restored). Kept in
// memory until dismissed.

let notes: readonly string[] = [];
const listeners = new Set<() => void>();

export function addNotice(message: string) {
  notes = [...notes, message];
  listeners.forEach((l) => l());
}

export function dismissNotice(message: string) {
  notes = notes.filter((n) => n !== message);
  listeners.forEach((l) => l());
}

export function useNotices(): readonly string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => notes,
  );
}
