import type {
  JudgeActivity,
  JudgeField,
  JudgeIdentity,
  ScoreSubmission,
} from "@camporee-conductor/collator/types";
import { useState } from "react";
import { newId } from "../api.ts";
import { initialEntry, readEntry, type Entry } from "../form.ts";
import type { SendNowResult } from "../outbox.ts";
import { outbox } from "../phone-outbox.ts";
import { ui } from "../ui.ts";
import type { Entrant } from "./EntrantPicker.tsx";

/**
 * The Activity's form, built from its fields (Common Fields already merged by the Collator, ADR-0020).
 * Saving puts the score in the phone's outbox first, then sends it (#41 PR 2). If the box answers within a
 * few seconds the Judge sees it saved; if not, it's kept on the phone and sent when the box can be reached,
 * same id, so the box never counts it twice (ADR-0027 item 8). A refusal opens the form again to fix it.
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
  onSaved: (result: Exclude<SendNowResult, { status: "refused" }>) => void;
  onBack: () => void;
}) {
  const [entry, setEntry] = useState<Entry>(() =>
    initialEntry(activity.fields),
  );
  const [problems, setProblems] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const read = readEntry(activity.fields, entry);
    if (!read.ok) {
      setProblems(read.problems);
      return;
    }
    setProblems([]);
    setRefusal(null);
    setSaving(true);
    const { id, ...score }: ScoreSubmission = {
      id: newId(),
      judge,
      activityId: activity.id,
      entrantId: entrant.id,
      values: read.values,
      phoneCreatedAt: new Date().toISOString(),
    };
    const result = await outbox.sendNow(
      {
        id,
        path: `/api/scores/${id}`,
        body: score,
        label: `${entrant.label} at ${activity.title}`,
        queuedAt: score.phoneCreatedAt,
      },
      { waitMs: ANSWER_WAIT_MS },
    );
    if (result.status === "refused") {
      // Nothing was stored, and the same entry would be refused again: the form stays open to fix it.
      setRefusal(result.message);
      setSaving(false);
    } else {
      onSaved(result);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <button
        type="button"
        className={`${ui.link} self-start`}
        onClick={onBack}
        disabled={saving}
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
          disabled={saving}
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
      {refusal && (
        <div className={ui.error} role="alert">
          <p>Not saved: {refusal}</p>
          <p className="mt-1">Your entry is kept. Fix it and save again.</p>
        </div>
      )}
      <button className={ui.button} type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save score"}
      </button>
    </form>
  );
}

/** How long the form waits for the box before telling the Judge the score is kept on the phone. */
const ANSWER_WAIT_MS = 3000;

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
