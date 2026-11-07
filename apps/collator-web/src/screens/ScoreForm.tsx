import type {
  JudgeActivity,
  JudgeField,
  JudgeIdentity,
  ScoreSubmission,
} from "@camporee-conductor/collator/types";
import { useState } from "react";
import { api, ApiError, newId } from "../api.ts";
import { initialEntry, readEntry, type Entry } from "../form.ts";
import { ui } from "../ui.ts";
import type { Entrant } from "./EntrantPicker.tsx";

/**
 * The Activity's form, built from its fields (Common Fields already merged by the Collator, ADR-0020).
 * A failed send keeps the entry and freezes the exact submission: "Try again" resends it unchanged, same
 * id, so the box never counts it twice (ADR-0027 item 8). Changing it afterwards starts a new score id.
 */
export function ScoreForm({
  activity,
  entrant,
  judge,
  onSaved,
  onBack,
}: {
  activity: JudgeActivity;
  entrant: Entrant;
  judge: JudgeIdentity;
  onSaved: (repeat: boolean) => void;
  onBack: () => void;
}) {
  const [entry, setEntry] = useState<Entry>(() =>
    initialEntry(activity.fields),
  );
  const [problems, setProblems] = useState<string[]>([]);
  const [pending, setPending] = useState<ScoreSubmission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const send = async (submission: ScoreSubmission) => {
    setPending(submission);
    setSending(true);
    setError(null);
    try {
      const { status } = await api.putScore(submission);
      onSaved(status === "repeat");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setSending(false);
    }
  };

  const submit = () => {
    const read = readEntry(activity.fields, entry);
    if (!read.ok) {
      setProblems(read.problems);
      return;
    }
    setProblems([]);
    void send({
      id: newId(),
      judge,
      activityId: activity.id,
      entrantId: entrant.id,
      values: read.values,
      phoneCreatedAt: new Date().toISOString(),
    });
  };

  const locked = pending !== null;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) void send(pending);
        else submit();
      }}
    >
      <button
        type="button"
        className={`${ui.link} self-start`}
        onClick={onBack}
        disabled={sending}
      >
        ← Back
      </button>
      <div>
        <h1 className={ui.h1}>{entrant.label}</h1>
        <p className={ui.muted}>{activity.title}</p>
      </div>

      {activity.fields.length === 0 && (
        <p className={ui.muted}>
          This Activity has nothing for Judges to enter.
        </p>
      )}
      {activity.fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={entry[field.id]}
          disabled={locked}
          onChange={(value) => setEntry({ ...entry, [field.id]: value })}
        />
      ))}

      {problems.length > 0 && (
        <ul className={ui.error} role="alert">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className={ui.error} role="alert">
          <p>Not saved: {error}</p>
          <p className="mt-1">
            Your entry is kept. Try again when you're back in range.
          </p>
        </div>
      )}
      <button className={ui.button} type="submit" disabled={sending}>
        {sending ? "Saving…" : locked ? "Try again" : "Save score"}
      </button>
      {locked && !sending && (
        <button
          type="button"
          className={ui.buttonQuiet}
          onClick={() => {
            setPending(null);
            setError(null);
          }}
        >
          Change the entry
        </button>
      )}
    </form>
  );
}

function FieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: JudgeField;
  value: string | boolean | undefined;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
}) {
  const { config } = field;
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.type === "checkbox") {
    return (
      <label className="flex items-center gap-3 text-base">
        <input
          type="checkbox"
          className="h-6 w-6"
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
    );
  }
  const text = typeof value === "string" ? value : "";
  const common = {
    className: ui.input,
    value: text,
    disabled,
    placeholder: config.placeholder,
  };
  return (
    <label className={ui.label}>
      {label}
      {field.type === "textarea" ? (
        <textarea
          {...common}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : field.type === "select" ? (
        <select {...common} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {(config.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type={field.type === "number" ? "number" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          min={config.min}
          max={config.max}
          step="any"
          // Stopwatch times are typed as m:ss for now; the timer comes with #41.
          {...(field.type === "stopwatch" && {
            placeholder: config.placeholder ?? "m:ss",
          })}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
