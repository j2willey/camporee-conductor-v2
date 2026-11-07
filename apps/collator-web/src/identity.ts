import type { JudgeIdentity } from "@camporee-conductor/collator/types";

// Who's judging, kept on the phone and sent with each score. No account, no sign-in (ADR-0023).
const KEY = "collator.judge";

export function savedJudge(): JudgeIdentity | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const judge = JSON.parse(raw) as Partial<JudgeIdentity>;
    return judge.id && judge.name && judge.email
      ? { id: judge.id, name: judge.name, email: judge.email }
      : null;
  } catch {
    return null;
  }
}

export function saveJudge(judge: JudgeIdentity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(judge));
  } catch {
    // Private browsing or storage full: the Judge is asked again next time.
  }
}
