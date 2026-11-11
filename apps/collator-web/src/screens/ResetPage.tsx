import { useState } from "react";
import { errorMessage, officialApi } from "../api.ts";
import { ui } from "../ui.ts";

type Kind = "scores" | "full";

/**
 * Reset for a rehearsal (#42 PR 8, ADR-0027). Two kinds, each with its own typed confirmation. The box backs up
 * first and refuses if it can't; it also checks the typed name itself.
 */
export function ResetPage({
  email,
  eventTitle,
  onBack,
}: {
  email: string;
  eventTitle: string;
  onBack: () => void;
}) {
  const [done, setDone] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <button className={`${ui.link} self-start`} onClick={onBack}>
        ← Overview
      </button>
      <h1 className={ui.h1}>Reset</h1>
      <p className={ui.muted}>
        For clearing a rehearsal before the real thing. The box saves a backup
        first; if it can't, nothing is reset. Phones that were scoring will not
        send what was cleared.
      </p>
      {done && (
        <p className={ui.success} role="status">
          {done}
        </p>
      )}
      <ResetSection
        kind="scores"
        heading="Reset scores"
        clears="all scores, closures, Judges, Official actions (disqualifications, corrections, ranks, finalizing) and Exhibition results."
        keeps="the Event's design, the Groups and Teams, and the Officials."
        email={email}
        eventTitle={eventTitle}
        onDone={setDone}
      />
      <ResetSection
        kind="full"
        heading="Full reset"
        clears="everything Reset scores clears, and also the Groups, Teams and the roster changes."
        keeps="the Event's design and the Officials."
        email={email}
        eventTitle={eventTitle}
        onDone={setDone}
      />
    </section>
  );
}

function ResetSection({
  kind,
  heading,
  clears,
  keeps,
  email,
  eventTitle,
  onDone,
}: {
  kind: Kind;
  heading: string;
  clears: string;
  keeps: string;
  email: string;
  eventTitle: string;
  onDone: (message: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === eventTitle.toLowerCase();

  const reset = () => {
    setBusy(true);
    setProblem(null);
    officialApi.reset(email, { kind, confirm: typed }).then(
      (result) => {
        setBusy(false);
        setTyped("");
        onDone(`Reset done. Backup saved as ${result.backup}.`);
      },
      (e: unknown) => {
        setBusy(false);
        setProblem(errorMessage(e));
      },
    );
  };

  return (
    <section className={`${ui.card} flex flex-col gap-3`}>
      <h2 className={ui.h2}>{heading}</h2>
      <p className="text-sm">
        <strong>Clears:</strong> {clears}
      </p>
      <p className="text-sm">
        <strong>Keeps:</strong> {keeps}
      </p>
      <label className={ui.label}>
        Type the Event&apos;s name to confirm
        <input
          className={ui.input}
          aria-label={`Type the Event's name to confirm, ${heading}`}
          value={typed}
          placeholder={eventTitle}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
        />
      </label>
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      <button
        className="rounded-md bg-red-700 px-4 py-3 text-base font-medium text-white hover:bg-red-800 disabled:opacity-50"
        disabled={!matches || busy}
        onClick={reset}
      >
        {busy ? "Resetting…" : heading}
      </button>
    </section>
  );
}
