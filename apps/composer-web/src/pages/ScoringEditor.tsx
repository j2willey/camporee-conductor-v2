import { useQuery } from "@tanstack/react-query";
import {
  FieldInput,
  initialEntry,
  judgeFormFields,
  readEntry,
  type Entry,
  type TimerState,
} from "@camporee-conductor/judge-form";
import {
  ActivitySchema,
  CommonFieldSetSchema,
  FIELD_KINDS,
  FIELD_TYPES,
  type Activity,
  type Competition,
} from "@camporee-conductor/schema";
import { entryTotal, mergeCommonFields } from "@camporee-conductor/scoring";
import { useState, type ReactNode } from "react";
import { client, data } from "../api.ts";
import {
  addField,
  duplicateField,
  moveField,
  removeField,
  setKind,
  setPrimary,
  setType,
  sorted,
  updateField,
  type Field,
} from "../scoring-fields.ts";
import { omit } from "../draft.ts";
import { ui } from "../ui.ts";

const TYPE_LABELS: Record<Field["type"], string> = {
  number: "Number",
  stopwatch: "Stopwatch (m:ss)",
  text: "Short text",
  textarea: "Long text",
  checkbox: "Checkbox",
  select: "Pick one",
};
const KIND_LABELS: Record<Field["kind"], string> = {
  points: "Points (adds)",
  penalty: "Penalty (subtracts)",
  metric: "Measure (time, count…)",
  info: "Info (not scored)",
};

/**
 * The Activity's scoring (#6 PR 5): its scoring type and fields. Add, copy, move and remove fields; set each
 * one's type, kind, audience, weight, min/max, options and placeholder; pick the primary metric and its
 * direction (ADR-0019). Edits the same draft as the rest of the page, saved with it.
 */
export function ScoringCard({
  draft,
  onChange,
}: {
  draft: Activity;
  onChange: (activity: Activity) => void;
}) {
  const fields = sorted(draft.scoring.fields);
  const setFields = (next: Field[]) =>
    onChange({ ...draft, scoring: { ...draft.scoring, fields: next } });
  return (
    <section className={`${ui.card} space-y-4`} aria-label="Scoring">
      <h2 className={ui.h2}>Scoring</h2>
      <label className={`${ui.label} max-w-xs`}>
        Scoring type
        <select
          className={ui.input}
          value={draft.scoringType}
          onChange={(e) =>
            onChange({
              ...draft,
              scoringType: e.target.value as Activity["scoringType"],
            })
          }
        >
          <option value="ranked">Ranked: counts toward standings</option>
          <option value="exhibition">Exhibition: recognition only</option>
        </select>
      </label>
      <p className={ui.muted}>
        Points add up and penalties subtract, each times its weight. A measure
        (a time or a count) can be the primary metric: entries are listed by it,
        and you say whether higher or lower wins.
      </p>
      <ol className="space-y-3">
        {fields.map((field, index) => (
          <FieldEditor
            key={index}
            field={field}
            index={index}
            count={fields.length}
            onField={(change) => setFields(updateField(fields, index, change))}
            onType={(type) => setFields(setType(fields, index, type))}
            onKind={(kind) => setFields(setKind(fields, index, kind))}
            onPrimary={(direction) =>
              setFields(setPrimary(fields, index, direction))
            }
            onMove={(step) => setFields(moveField(fields, index, step))}
            onDuplicate={() => setFields(duplicateField(fields, index))}
            onRemove={() => setFields(removeField(fields, index))}
          />
        ))}
      </ol>
      <button
        type="button"
        className={ui.buttonQuiet}
        onClick={() => setFields(addField(fields))}
      >
        + Add field
      </button>
    </section>
  );
}

function FieldEditor({
  field,
  index,
  count,
  onField,
  onType,
  onKind,
  onPrimary,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: Field;
  index: number;
  count: number;
  onField: (change: (field: Field) => Field) => void;
  onType: (type: Field["type"]) => void;
  onKind: (kind: Field["kind"]) => void;
  onPrimary: (direction: "higher-wins" | "lower-wins" | null) => void;
  onMove: (step: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const name = `field ${index + 1}`;
  const config = field.config ?? {};
  /** Sets one `config` entry, or removes it when blank; an empty config goes too. */
  const setConfig = <K extends keyof typeof config>(
    key: K,
    value: (typeof config)[K] | undefined,
  ) =>
    onField((f) => {
      const next = Object.fromEntries(
        Object.entries(f.config ?? {}).filter(([k]) => k !== key),
      ) as typeof config;
      if (value !== undefined && value !== "") next[key] = value;
      return Object.keys(next).length > 0
        ? { ...f, config: next }
        : omit(f, "config");
    });
  const numberOrBlank = (text: string) =>
    text.trim() === "" ? undefined : Number(text);
  const canBePrimary =
    field.kind === "metric" &&
    (field.type === "number" || field.type === "stopwatch");
  const small =
    "rounded border border-stone-300 px-1.5 text-xs hover:bg-stone-100 disabled:opacity-40";

  return (
    <li
      className="space-y-3 rounded-md border border-stone-200 p-3"
      aria-label={`Scoring ${name}: ${field.label}`}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Labeled label="Label" grow>
          <input
            className={ui.input}
            aria-label={`Label of ${name}`}
            value={field.label}
            onChange={(e) => onField((f) => ({ ...f, label: e.target.value }))}
          />
        </Labeled>
        <Labeled label="Id">
          <input
            className={`${ui.input} w-40 font-mono text-sm`}
            aria-label={`Id of ${name}`}
            value={field.id}
            onChange={(e) => onField((f) => ({ ...f, id: e.target.value }))}
          />
        </Labeled>
        <span className="flex gap-1 pb-1">
          <button
            type="button"
            className={small}
            aria-label={`Move ${name} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className={small}
            aria-label={`Move ${name} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className={small}
            aria-label={`Duplicate ${name}`}
            onClick={onDuplicate}
          >
            Copy
          </button>
          <button
            type="button"
            className={`${small} text-red-700`}
            aria-label={`Remove ${name}`}
            onClick={onRemove}
          >
            ✕
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Labeled label="Type">
          <select
            className={ui.input}
            aria-label={`Type of ${name}`}
            value={field.type}
            onChange={(e) => onType(e.target.value as Field["type"])}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Kind">
          <select
            className={ui.input}
            aria-label={`Kind of ${name}`}
            value={field.kind}
            onChange={(e) => onKind(e.target.value as Field["kind"])}
          >
            {FIELD_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Labeled>
        <Labeled label="Who enters it">
          <select
            className={ui.input}
            aria-label={`Who enters ${name}`}
            value={field.audience}
            onChange={(e) =>
              onField((f) => ({
                ...f,
                audience: e.target.value as Field["audience"],
              }))
            }
          >
            <option value="judge">Judge</option>
            <option value="official">Official</option>
          </select>
        </Labeled>
        {(field.kind === "points" || field.kind === "penalty") && (
          <Labeled label="Weight">
            <input
              className={`${ui.input} w-20`}
              aria-label={`Weight of ${name}`}
              type="number"
              min={0}
              step="any"
              value={field.weight ?? 1}
              onChange={(e) =>
                onField((f) => ({
                  ...f,
                  weight: numberOrBlank(e.target.value) ?? 1,
                }))
              }
            />
          </Labeled>
        )}
        <label className="flex items-center gap-1 pb-2 text-sm text-stone-700">
          <input
            type="checkbox"
            aria-label={`${name} required`}
            checked={field.required === true}
            onChange={(e) =>
              onField((f) => {
                return e.target.checked
                  ? { ...f, required: true }
                  : omit(f, "required");
              })
            }
          />
          Required
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {field.type === "number" && (
          <>
            <Labeled label="Min">
              <input
                className={`${ui.input} w-24`}
                aria-label={`Min of ${name}`}
                type="number"
                step="any"
                value={config.min ?? ""}
                onChange={(e) =>
                  setConfig("min", numberOrBlank(e.target.value))
                }
              />
            </Labeled>
            <Labeled label="Max">
              <input
                className={`${ui.input} w-24`}
                aria-label={`Max of ${name}`}
                type="number"
                step="any"
                value={config.max ?? ""}
                onChange={(e) =>
                  setConfig("max", numberOrBlank(e.target.value))
                }
              />
            </Labeled>
          </>
        )}
        {field.type !== "checkbox" && (
          <Labeled label="Placeholder" grow>
            <input
              className={ui.input}
              aria-label={`Placeholder of ${name}`}
              value={config.placeholder ?? ""}
              onChange={(e) => setConfig("placeholder", e.target.value)}
            />
          </Labeled>
        )}
        {canBePrimary && (
          <Labeled label="Primary metric">
            <select
              className={ui.input}
              aria-label={`Primary metric: ${name}`}
              value={field.primary?.direction ?? ""}
              onChange={(e) =>
                onPrimary(
                  e.target.value === ""
                    ? null
                    : (e.target.value as "higher-wins" | "lower-wins"),
                )
              }
            >
              <option value="">No</option>
              <option value="higher-wins">Yes: higher wins</option>
              <option value="lower-wins">Yes: lower wins</option>
            </select>
          </Labeled>
        )}
      </div>
      {field.type === "select" && (
        <Labeled label="Options, one per line">
          <textarea
            className={`${ui.input} text-sm`}
            aria-label={`Options of ${name}`}
            rows={3}
            value={(config.options ?? []).join("\n")}
            onChange={(e) =>
              setConfig(
                "options",
                e.target.value === "" ? undefined : e.target.value.split("\n"),
              )
            }
          />
        </Labeled>
      )}
    </li>
  );
}

function Labeled({
  label,
  grow = false,
  children,
}: {
  label: string;
  grow?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`${ui.label} ${grow ? "min-w-48 flex-1" : ""}`}>
      <span>{label}</span>
      {children}
    </div>
  );
}

/**
 * The judge's form for this draft, as a Judge's phone shows it (ADR-0029 item 6): the shared judge form, with
 * the Competition's Common Fields applied and variables filled. Try values and check them with packages/scoring's
 * own rules; nothing is sent anywhere.
 */
export function ScoringPreview({
  eventId,
  draft,
  competition,
}: {
  eventId: string;
  draft: Activity;
  competition: Competition | undefined;
}) {
  const sets = useQuery({
    queryKey: ["events", eventId, "common-field-sets"],
    queryFn: () =>
      data(
        client.api.events[":eventId"]["common-field-sets"].$get({
          param: { eventId },
        }),
      ),
  });
  const parsed = ActivitySchema.safeParse(draft);
  let body: ReactNode;
  if (!competition) {
    body = <p className={ui.muted}>This Event doesn't list this Activity.</p>;
  } else if (sets.isPending) {
    body = <p className={ui.muted}>Loading…</p>;
  } else if (sets.isError) {
    body = <p className={ui.error}>{sets.error.message}</p>;
  } else if (!parsed.success) {
    body = (
      <p className={ui.muted}>
        Fix the problems listed at the bottom of the page to see the preview.
      </p>
    );
  } else {
    const commonFieldSets = sets.data.map((s) => CommonFieldSetSchema.parse(s));
    const fields = judgeFormFields(parsed.data, competition, commonFieldSets);
    const scored = mergeCommonFields(parsed.data, competition, commonFieldSets);
    const officialOnly = scored.filter((f) => f.audience === "official");
    body = (
      <>
        {officialOnly.length > 0 && (
          <p className={ui.muted}>
            Not on the Judge's form (Officials enter them):{" "}
            {officialOnly.map((f) => f.label).join(", ")}.
          </p>
        )}
        {/* A new key when the form changes starts the preview afresh. */}
        <PreviewForm
          key={JSON.stringify(fields)}
          fields={fields}
          total={(values) => entryTotal(scored, values)}
        />
      </>
    );
  }
  return (
    <section className={`${ui.card} space-y-3`} aria-label="Judge's form">
      <h2 className={ui.h2}>Judge's form</h2>
      <p className={ui.muted}>
        What a Judge sees, with this Competition's Common Fields. It follows
        your changes before you save.
      </p>
      {body}
    </section>
  );
}

function PreviewForm({
  fields,
  total,
}: {
  fields: ReturnType<typeof judgeFormFields>;
  total: (values: Record<string, number | string | boolean>) => number;
}) {
  const [entry, setEntry] = useState<Entry>(() => initialEntry(fields));
  const [timers, setTimers] = useState<Record<string, TimerState>>({});
  const [checked, setChecked] = useState<
    { ok: true; total: number } | { ok: false; problems: string[] } | null
  >(null);
  if (fields.length === 0) {
    return (
      <p className={ui.muted}>This Activity has nothing for Judges to enter.</p>
    );
  }
  return (
    <div className="mx-auto max-w-sm space-y-4 rounded-2xl border-4 border-stone-300 bg-stone-50 p-4">
      {fields.map((field) => (
        <FieldInput
          key={field.id}
          field={field}
          value={entry[field.id]}
          timer={timers[field.id]}
          disabled={false}
          onChange={(value) => {
            setEntry((e) => ({ ...e, [field.id]: value }));
            setChecked(null);
          }}
          onTimer={(timer, value) => {
            setTimers((t) => ({ ...t, [field.id]: timer }));
            if (value !== undefined) {
              setEntry((e) => ({ ...e, [field.id]: value }));
            }
            setChecked(null);
          }}
        />
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={ui.button}
          onClick={() => {
            const read = readEntry(fields, entry);
            setChecked(
              read.ok ? { ok: true, total: total(read.values) } : read,
            );
          }}
        >
          Check entry
        </button>
        <button
          type="button"
          className={ui.buttonQuiet}
          onClick={() => {
            setEntry(initialEntry(fields));
            setTimers({});
            setChecked(null);
          }}
        >
          Clear
        </button>
      </div>
      {checked?.ok === false && (
        <ul role="alert" className={`${ui.error} list-disc pl-6`}>
          {checked.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {checked?.ok === true && (
        <p role="status" className={ui.success}>
          The Collator would accept this entry: {checked.total} points.
        </p>
      )}
    </div>
  );
}
