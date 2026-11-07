import type { JudgeIdentity } from "@camporee-conductor/collator/types";
import { useState } from "react";
import { newId } from "../api.ts";
import { saveJudge } from "../identity.ts";
import { ui } from "../ui.ts";

/** Who's judging: a name and an email, kept on this phone. No account (ADR-0023). */
export function JudgeDetails({
  judge,
  onSaved,
}: {
  judge: JudgeIdentity | null;
  onSaved: (judge: JudgeIdentity) => void;
}) {
  const [name, setName] = useState(judge?.name ?? "");
  const [email, setEmail] = useState(judge?.email ?? "");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        // A different person on this phone is a different Judge; a fixed typo keeps the id.
        const sameJudge =
          judge && judge.email.toLowerCase() === email.trim().toLowerCase();
        const saved = {
          id: sameJudge ? judge.id : newId(),
          name: name.trim(),
          email: email.trim(),
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
      <button className={ui.button} type="submit">
        Start judging
      </button>
    </form>
  );
}
