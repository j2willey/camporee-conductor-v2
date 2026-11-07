import type {
  JudgeIdentity,
  JudgeLabels,
  Roster,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { api, newId } from "../api.ts";
import { saveJudge } from "../identity.ts";
import { loadKept, ROSTER_KEY } from "../offline-data.ts";
import { ui } from "../ui.ts";

/**
 * Who's judging: a name, an email and, optionally, their own unit (#41 PR 5), kept on this phone. No
 * account (ADR-0023). The unit is free text, a Group's name, not a roster entry: a Judge's unit may not be
 * attending. The roster's Groups are offered as suggestions.
 */
export function JudgeDetails({
  judge,
  labels,
  onSaved,
}: {
  judge: JudgeIdentity | null;
  labels: JudgeLabels;
  onSaved: (judge: JudgeIdentity) => void;
}) {
  const [name, setName] = useState(judge?.name ?? "");
  const [email, setEmail] = useState(judge?.email ?? "");
  const [homeGroup, setHomeGroup] = useState(judge?.homeGroup ?? "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  useEffect(() => {
    loadKept<Roster>(ROSTER_KEY, api.roster, localStorage).then(
      (kept) => setSuggestions(kept.value.groups.map((g) => g.name)),
      () => {
        // No suggestions: the Judge types it.
      },
    );
  }, []);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        // A different person on this phone is a different Judge; a fixed typo keeps the id.
        const sameJudge =
          judge && judge.email.toLowerCase() === email.trim().toLowerCase();
        const unit = homeGroup.trim();
        const saved: JudgeIdentity = {
          id: sameJudge ? judge.id : newId(),
          name: name.trim(),
          email: email.trim(),
          ...(unit && { homeGroup: unit }),
        };
        saveJudge(saved);
        onSaved(saved);
      }}
    >
      <h1 className={ui.h1}>Who's judging?</h1>
      <p className={ui.muted}>
        No account needed. Your name goes with each score you enter.
      </p>
      <label className={ui.label}>
        Name
        <input
          className={ui.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          required
        />
      </label>
      <label className={ui.label}>
        Email
        <input
          className={ui.input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
      </label>
      <label className={ui.label}>
        Your {homeGroupWord(labels)} (optional)
        <input
          className={ui.input}
          value={homeGroup}
          onChange={(e) => setHomeGroup(e.target.value)}
          list="home-group-suggestions"
          maxLength={200}
          autoComplete="off"
        />
        <span className="font-normal text-stone-500">
          For the thank-you notes. It needn't be at this event.
        </span>
      </label>
      <datalist id="home-group-suggestions">
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <button className={ui.button} type="submit">
        Start judging
      </button>
    </form>
  );
}

/** The event's word for a Group (e.g. Troop); "unit (troop/crew)" when the pack doesn't name one. */
function homeGroupWord(labels: JudgeLabels): string {
  return labels.group.trim() || "unit (troop/crew)";
}
