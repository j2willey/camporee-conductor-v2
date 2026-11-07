// Small choices kept on this phone: the Activity tab, the last Activity picked (#41 PR 5). Losing them
// (private browsing, storage full) only costs a tap.

export function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not kept: the page still works.
  }
}
