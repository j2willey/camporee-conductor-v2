// The Official's email, kept on this device so they needn't type it again. It's sent with every Official
// call and checked by the box each time: an email-only gate, not an account (ADR-0027 item 5).
const KEY = "collator.official";

export function savedOfficialEmail(): string | null {
  try {
    return localStorage.getItem(KEY) || null;
  } catch {
    return null;
  }
}

export function saveOfficialEmail(email: string): void {
  try {
    localStorage.setItem(KEY, email);
  } catch {
    // Private browsing or storage full: the Official is asked again next time.
  }
}

export function forgetOfficialEmail(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to forget.
  }
}
