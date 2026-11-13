import { ui } from "../ui.ts";
import { ErrorMessage } from "./ErrorMessage.tsx";

/** One changed piece of a proposal: what it says now, and what the AI proposes. */
export interface ProposedChange {
  label: string;
  before: string;
  after: string;
}

/**
 * An AI proposal shown as a diff (ADR-0030 item 3): each change before and after, then Accept or Discard. Nothing is
 * saved until the editor accepts; accepting is a save, checked and audited like any other.
 */
export function ProposalReview({
  changes,
  accepting,
  error,
  onAccept,
  onDiscard,
}: {
  changes: ProposedChange[];
  accepting: boolean;
  error: Error | null;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <section
      aria-label="Proposed change"
      className="space-y-3 rounded-md border border-amber-300 bg-amber-50/60 p-3"
    >
      <h3 className="text-sm font-semibold text-stone-800">
        Proposed by AI. Nothing is saved until you accept.
      </h3>
      {changes.map((change) => (
        <div key={change.label} className="space-y-1">
          <p className="text-sm font-medium text-stone-700">{change.label}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className={ui.muted}>Now</p>
              <p className="rounded bg-white px-2 py-1 text-sm whitespace-pre-line text-stone-500 line-through decoration-stone-300">
                {change.before || "(empty)"}
              </p>
            </div>
            <div>
              <p className={ui.muted}>Proposed</p>
              <p className="rounded bg-white px-2 py-1 text-sm whitespace-pre-line">
                {change.after || "(empty)"}
              </p>
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ui.button}
          disabled={accepting}
          onClick={onAccept}
        >
          Accept
        </button>
        <button
          type="button"
          className={ui.buttonQuiet}
          disabled={accepting}
          onClick={onDiscard}
        >
          Discard
        </button>
      </div>
      {error && <ErrorMessage error={error} />}
    </section>
  );
}
