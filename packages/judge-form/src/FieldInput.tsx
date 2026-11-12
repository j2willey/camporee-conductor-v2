import { useEffect, useState } from "react";
import type { FormField } from "./field.ts";
import {
  elapsedMs,
  formatElapsed,
  resetTimer,
  startTimer,
  stopTimer,
  type TimerState,
} from "./stopwatch.ts";
import { ui } from "./ui.ts";

/**
 * One field of the judge's form (moved unchanged from the Collator's ScoreForm, ADR-0029 item 6). A stopwatch
 * field gets its timer under the input.
 */
export function FieldInput({
  field,
  value,
  timer,
  disabled,
  onChange,
  onTimer,
}: {
  field: FormField;
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
