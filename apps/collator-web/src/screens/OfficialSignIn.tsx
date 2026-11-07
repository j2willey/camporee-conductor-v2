import { useState } from "react";
import { ui } from "../ui.ts";

/** The email form. Only an email on the Event's Officials list gets in (ADR-0027 item 5). */
export function OfficialSignIn({
  problem,
  onSignIn,
}: {
  problem: string | null;
  onSignIn: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSignIn(email.trim());
      }}
    >
      <h1 className={ui.h1}>Officials</h1>
      <p className={ui.muted}>
        Sign in with the email the Event lists for you as an Official.
      </p>
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
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
        Sign in
      </button>
    </form>
  );
}
