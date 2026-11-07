import type {
  JudgeActivity,
  JudgeField,
  JudgeIdentity,
  ScoreSubmission,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { newId } from "../api.ts";
import type { Draft } from "../drafts.ts";
import { initialEntry, readEntry } from "../form.ts";
import type { SendNowResult } from "../outbox.ts";
import { drafts } from "../phone-drafts.ts";
import { answerWaitMs, outbox } from "../phone-outbox.ts";
import {
  elapsedMs,
  formatElapsed,
  resetTimer,
  startTimer,
  stopTimer,
  type TimerState,
} from "../stopwatch.ts";
import { ui } from "../ui.ts";
import type { Entrant } from "./EntrantPicker.tsx";

/**
 * The Activity's form, built from its fields (Common Fields already merged by the Collator, ADR-0020).
 * Saving puts the score in the phone's outbox first, then sends it (#41 PR 2). If the box answers within a
 * few seconds the Judge sees it saved; if not, it's kept on the phone and sent when the box can be reached,
 * same id, so the box never counts it twice (ADR-0027 item 8). A refusal opens the form again to fix it.
 * What's typed (and any stopwatch) is kept as a draft until the score is saved (#41 PR 4).
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
  const blank = (): Draft => ({
    entry: initialEntry(activity.fields),
    timers: {},
  });
  const [kept] = useState(() => drafts.get(activity.id, entrant.id));
  const [draft, setDraft] = useState<Draft>(() => kept ?? blank());
  const [restored, setRestored] = useState(kept !== undefined);
  const { entry, timers } = draft;

  // Keep the draft as it changes; a form back as it started has none.
  const { id: activityId, fields } = activity;
  const { id: entrantId } = entrant;
  useEffect(() => {
    const untouched =
      JSON.stringify(draft.entry) === JSON.stringify(initialEntry(fields)) &&
      Object.values(draft.timers).every(
        (t) => t.runningSince === null && t.elapsedMs === 0,
      );
    if (untouched) drafts.clear(activityId, entrantId);
    else drafts.save(activityId, entrantId, draft);
  }, [draft, activityId, fields, entrantId]);
  const [problems, setProblems] = useState<string[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    // A stopwatch still running stops now, and its time is the one saved.
    const now = Date.now();
    let toSave = entry;
    let stopped = timers;
    for (const [fieldId, timer] of Object.entries(timers)) {
      if (timer.runningSince === null) continue;
      const done = stopTimer(timer, now);
      stopped = { ...stopped, [fieldId]: done };
      toSave = { ...toSave, [fieldId]: formatElapsed(done.elapsedMs) };
    }
    if (stopped !== timers) setDraft({ entry: toSave, timers: stopped });
    const read = readEntry(activity.fields, toSave);
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
      { waitMs: answerWaitMs() },
    );
    if (result.status === "refused") {
      // Nothing was stored, and the same entry would be refused again: the form stays open to fix it.
      setRefusal(result.message);
      setSaving(false);
    } else {
      drafts.clear(activity.id, entrant.id);
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

      {restored && (
        <div className={`${ui.note} flex items-center justify-between gap-2`}>
          <p>Picked up where you left off.</p>
          <button
            type="button"
            className={ui.link}
            onClick={() => {
              setDraft(blank());
              setRestored(false);
            }}
          >
            Start over
          </button>
        </div>
      )}
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
          timer={timers[field.id]}
          disabled={saving}
          onChange={(value) =>
            setDraft((d) => ({
              ...d,
              entry: { ...d.entry, [field.id]: value },
            }))
          }
          onTimer={(timer, value) =>
            setDraft((d) => ({
              entry:
                value === undefined
                  ? d.entry
                  : { ...d.entry, [field.id]: value },
              timers: { ...d.timers, [field.id]: timer },
            }))
          }
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

function FieldInput({
  field,
  value,
  timer,
  disabled,
  onChange,
  onTimer,
}: {
  field: JudgeField;
  value: string | boolean | undefined;
  timer: TimerState | undefined;
  disabled: boolean;
  onChange: (value: string | boolean) => void;
  /** A stopwatch changed; `value`, when given, is the time to put in the field. */
  onTimer: (timer: TimerState, value?: string) => void;
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
  const input = (
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
          // A stopwatch time can be typed too, as m:ss.
          {...(field.type === "stopwatch" && {
            placeholder: config.placeholder ?? "m:ss",
          })}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
  if (field.type !== "stopwatch") return input;
  return (
    <div className="flex flex-col gap-2">
      {input}
      <Stopwatch
        label={field.label}
        timer={timer}
        disabled={disabled}
        onTimer={onTimer}
      />
    </div>
  );
}

/**
 * Start, Stop and Reset for a stopwatch field. Stop puts the time in the field (whole seconds, m:ss);
 * Start again carries on from there. It runs on the clock, kept in the draft, so a locked screen or a
 * reload doesn't lose time.
 */
function Stopwatch({
  label,
  timer,
  disabled,
  onTimer,
}: {
  label: string;
  timer: TimerState | undefined;
  disabled: boolean;
  onTimer: (timer: TimerState, value?: string) => void;
}) {
  const running = timer?.runningSince != null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [running]);
  const shown = timer ? elapsedMs(timer, running ? now : 0) : 0;

  return (
    <div className="flex items-center gap-2">
      <span
        className="min-w-16 font-mono text-2xl tabular-nums"
        role="timer"
        aria-label={`Timer: ${label}`}
      >
        {formatElapsed(shown)}
      </span>
      {running ? (
        <button
          type="button"
          className={ui.button}
          disabled={disabled}
          aria-label={`Stop timer: ${label}`}
          onClick={() => {
            const done = stopTimer(timer, Date.now());
            onTimer(done, formatElapsed(done.elapsedMs));
          }}
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          className={ui.button}
          disabled={disabled}
          aria-label={`Start timer: ${label}`}
          onClick={() => {
            const start = Date.now();
            setNow(start);
            onTimer(startTimer(timer ?? resetTimer(), start));
          }}
        >
          {shown > 0 ? "Carry on" : "Start"}
        </button>
      )}
      <button
        type="button"
        className={ui.buttonQuiet}
        disabled={disabled || (!running && shown === 0)}
        aria-label={`Reset timer: ${label}`}
        onClick={() => onTimer(resetTimer(), "")}
      >
        Reset
      </button>
    </div>
  );
}
