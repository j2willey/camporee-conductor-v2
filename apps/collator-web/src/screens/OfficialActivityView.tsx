import type {
  JudgeLabels,
  OfficialActivity,
} from "@camporee-conductor/collator/types";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError, errorMessage, newId, officialApi } from "../api.ts";
import { clock, entrantLabel, levelLabel, ordinal } from "../format.ts";
import { ui } from "../ui.ts";

type MatrixRow = OfficialActivity["matrix"][number];

type FieldInfo = OfficialActivity["fields"][number];
type FieldValue = number | string | boolean | null;

/**
 * An Official confirming something on one row: a DQ or reinstatement, a field correction, the revert of one, or
 * the choice of which entry counts.
 * Only one is open at a time. The id and `clientCreatedAt` are made once and kept, so a retry resends exactly
 * the same action and the box answers "repeat", even if the first send landed and only the reply was lost.
 * Changing the value or the reason makes it a new action, with a new id.
 */
type Pending = {
  entrantId: string;
  id: string;
  clientCreatedAt: string;
  reason: string;
  busy: boolean;
  problem: string | null;
  /** The box refused a choice made on a stale view (409): Reload, then choose again. */
  stale?: boolean;
} & (
  | { kind: "dq"; disqualified: boolean }
  | {
      kind: "correct";
      entryId: string;
      field: FieldInfo;
      input: string | boolean;
    }
  | { kind: "revert"; entryId: string; field: FieldInfo }
  | { kind: "choose"; entryId: string; newestEntryId: string }
);

const fresh = () => ({
  id: newId(),
  clientCreatedAt: new Date().toISOString(),
});

/** What the editor starts with: the value now counting. */
const inputOf = (field: FieldInfo, value: FieldValue | undefined) =>
  field.type === "checkbox"
    ? value === true
    : value === null || value === undefined
      ? ""
      : String(value);

/**
 * What the box is sent for an editor's input: a number field's text as a number when it reads as one, null when
 * blank, and otherwise as typed, so the box's message explains the problem.
 */
function valueOf(field: FieldInfo, input: string | boolean): FieldValue {
  if (typeof input === "boolean") return input;
  if (input.trim() === "") return null;
  if (field.type !== "number") return input;
  const n = Number(input);
  return Number.isFinite(n) ? n : input;
}

const show = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "blank"
    : String(value);

const judgeText = (j: { name: string; homeGroup?: string }) =>
  j.homeGroup ? `${j.name} (${j.homeGroup})` : j.name;

/**
 * One Activity for an Official (#42 PR 2a): the score matrix, then every score entry received. The matrix is
 * the box's, from packages/scoring, shown in the order given; nothing is re-sorted or re-totalled here. An
 * Official can DQ or reinstate a row (PR 2b) and correct a field's value (PR 3): each logs an action on the box
 * and the matrix is read again.
 */
export function OfficialActivityView({
  email,
  activityId,
  labels,
  onBack,
}: {
  email: string;
  activityId: string;
  labels: JudgeLabels;
  onBack: () => void;
}) {
  const [view, setView] = useState<OfficialActivity | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    let current = true;
    officialApi.activity(email, activityId).then(
      (v) => current && setView(v),
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email, activityId]);

  const confirm = async (p: Pending) => {
    setPending({ ...p, busy: true, problem: null });
    const notes = p.reason.trim();
    const base = {
      activityId,
      entrantId: p.entrantId,
      ...(notes !== "" && { notes }),
    };
    try {
      await officialApi.act(email, p.id, {
        action:
          p.kind === "dq"
            ? { type: "disqualify", ...base, disqualified: p.disqualified }
            : p.kind === "correct"
              ? {
                  type: "set-field-value",
                  ...base,
                  entryId: p.entryId,
                  fieldId: p.field.id,
                  value: valueOf(p.field, p.input),
                }
              : p.kind === "choose"
                ? {
                    type: "choose-entry",
                    ...base,
                    entryId: p.entryId,
                    newestEntryId: p.newestEntryId,
                  }
                : {
                    type: "revert-field-value",
                    ...base,
                    entryId: p.entryId,
                    fieldId: p.field.id,
                  },
        clientCreatedAt: p.clientCreatedAt,
      });
      setView(await officialApi.activity(email, activityId));
      setPending(null);
    } catch (e) {
      // The id stays, so a retry resends the same action (safe).
      setPending({
        ...p,
        busy: false,
        problem: errorMessage(e),
        stale: p.kind === "choose" && e instanceof ApiError && e.status === 409,
      });
    }
  };

  const reload = async () => {
    setPending(null);
    setView(await officialApi.activity(email, activityId));
  };

  /** The Reason box and Confirm / Cancel buttons, shared by every kind of confirmation. */
  const confirmBar = (p: Pending, confirmText: string, before?: ReactNode) => (
    <div className="flex min-w-40 flex-col gap-2">
      {before}
      <label className={ui.label}>
        Reason (optional)
        <input
          className={ui.input}
          value={p.reason}
          disabled={p.busy}
          onChange={(e) =>
            setPending({ ...p, reason: e.target.value, ...fresh() })
          }
        />
      </label>
      {p.problem && (
        <p className={ui.error} role="alert">
          {p.problem}
        </p>
      )}
      {p.stale && (
        <button className={ui.button} onClick={() => void reload()}>
          Reload
        </button>
      )}
      <div className="flex gap-2">
        <button
          className={ui.button}
          disabled={p.busy}
          onClick={() => void confirm(p)}
        >
          {confirmText}
        </button>
        <button
          className={ui.buttonQuiet}
          disabled={p.busy}
          onClick={() => setPending(null)}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  const officialCell = (r: MatrixRow) => {
    if (pending?.kind === "dq" && pending.entrantId === r.entrantId) {
      return confirmBar(
        pending,
        `Confirm ${pending.disqualified ? "DQ" : "reinstate"}`,
      );
    }
    if (!r.onRoster || !r.scored) return null;
    const disqualified = !r.disqualified;
    return (
      <button
        className={ui.buttonQuiet}
        onClick={() =>
          setPending({
            kind: "dq",
            entrantId: r.entrantId,
            disqualified,
            ...fresh(),
            reason: "",
            busy: false,
            problem: null,
          })
        }
      >
        {disqualified ? "DQ" : "Reinstate"}
      </button>
    );
  };

  const revertPending = (
    r: MatrixRow,
    field: FieldInfo,
    entryId: string,
    reason = "",
  ): Pending => ({
    kind: "revert",
    entrantId: r.entrantId,
    entryId,
    field,
    ...fresh(),
    reason,
    busy: false,
    problem: null,
  });

  /** A value cell: a button that opens the correction editor in place, and "was …" under a corrected value. */
  const valueCell = (r: MatrixRow, f: FieldInfo) => {
    const value = r.values?.[f.id];
    if (
      pending?.kind === "correct" &&
      pending.entrantId === r.entrantId &&
      pending.field.id === f.id
    ) {
      const set = (input: string | boolean) =>
        setPending({ ...pending, input, ...fresh() });
      const name = `${f.label} for ${entrantLabel(r.entrantId, r.entrant)}`;
      return confirmBar(
        pending,
        "Confirm correction",
        f.type === "checkbox" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label={name}
              checked={pending.input === true}
              disabled={pending.busy}
              onChange={(e) => set(e.target.checked)}
            />
            {f.label}
          </label>
        ) : f.type === "select" ? (
          <select
            className={ui.input}
            aria-label={name}
            value={String(pending.input)}
            disabled={pending.busy}
            onChange={(e) => set(e.target.value)}
          >
            <option value=""></option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`${ui.input} text-right`}
            aria-label={name}
            value={String(pending.input)}
            disabled={pending.busy}
            onChange={(e) => set(e.target.value)}
          />
        ),
      );
    }
    const text = value === null || value === undefined ? "" : String(value);
    const correction = r.corrections[f.id];
    if (!r.onRoster || r.entryId === null) return text;
    const entryId = r.entryId;
    return (
      <>
        <button
          className="min-w-8 rounded px-1 underline decoration-dotted underline-offset-2 hover:bg-stone-100"
          aria-label={`Correct ${f.label} for ${entrantLabel(r.entrantId, r.entrant)}`}
          onClick={() =>
            setPending({
              kind: "correct",
              entrantId: r.entrantId,
              entryId,
              field: f,
              input: inputOf(f, value),
              ...fresh(),
              reason: "",
              busy: false,
              problem: null,
            })
          }
        >
          {text || "\u00a0"}
        </button>
        {correction && (
          <p className="text-xs text-stone-500">
            was {show(correction.original)}
          </p>
        )}
      </>
    );
  };

  /** The lines under an entrant's name about corrections: made ones (with Revert) and superseded ones (Dismiss). */
  const correctionLines = (r: MatrixRow) => (
    <>
      {Object.entries(r.corrections).map(([fieldId, c]) => {
        const field = view?.fields.find((f) => f.id === fieldId);
        if (!field || r.entryId === null) return null;
        const entryId = r.entryId;
        const reverting =
          pending?.kind === "revert" &&
          pending.entrantId === r.entrantId &&
          pending.field.id === fieldId;
        return (
          <div key={fieldId} className="mt-1 text-xs">
            <p className="text-stone-700">
              Corrected {field.label}: {show(c.original)} →{" "}
              {show(r.values?.[fieldId])} by {c.by}, {clock(c.at)}
              {c.notes && `: ${c.notes}`}
            </p>
            {c.warning && (
              <p className="font-medium text-amber-900">{c.warning}</p>
            )}
            {reverting ? (
              confirmBar(pending, "Confirm revert")
            ) : (
              <button
                className={ui.link}
                onClick={() => setPending(revertPending(r, field, entryId))}
              >
                Revert
              </button>
            )}
          </div>
        );
      })}
      {r.superseded.map((s) => {
        const field = view?.fields.find((f) => f.id === s.fieldId);
        const dismissing =
          pending?.kind === "revert" &&
          pending.entrantId === r.entrantId &&
          pending.entryId === s.entryId &&
          pending.field.id === s.fieldId;
        return (
          <div
            key={`${s.entryId} ${s.fieldId}`}
            className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900"
          >
            <p>
              {s.by}'s correction of {s.label} to {show(s.value)} was on an
              older entry; a newer entry counts now.
            </p>
            {dismissing
              ? confirmBar(pending, "Confirm dismiss")
              : field && (
                  <button
                    className={ui.link}
                    onClick={() => {
                      const p = revertPending(r, field, s.entryId);
                      setPending(p);
                      void confirm(p);
                    }}
                  >
                    Dismiss
                  </button>
                )}
          </div>
        );
      })}
      {r.notCounting.map((n) => (
        <p
          key={`${n.entryId} ${n.fieldId}`}
          className="mt-1 rounded bg-stone-100 px-2 py-1 text-xs text-stone-700"
        >
          {n.by}'s correction of {n.label} is on an entry that doesn't count
        </p>
      ))}
      {r.held.map((h) => (
        <p
          key={`${h.entryId} ${h.fieldId}`}
          className="mt-1 rounded bg-stone-100 px-2 py-1 text-xs text-stone-700"
        >
          {h.by}'s correction of {h.label} to {show(h.value)} waits until the
          Activity is unfinalized
        </p>
      ))}
    </>
  );

  /** Who scored each candidate entry, with Use this entry; the choice confirms in place like any other action. */
  const choiceLines = (r: MatrixRow) => {
    const newest = r.candidates.find((c) => c.newest);
    const choosing =
      pending?.kind === "choose" && pending.entrantId === r.entrantId
        ? pending
        : null;
    return (
      <>
        {r.choice?.state === "applied" && r.conflict === "resolved" && (
          <p className="mt-1 rounded bg-stone-100 px-2 py-1 text-xs text-stone-700">
            Resolved: {r.choice.by} chose {judgeText(r.choice.judge)}'s entry,{" "}
            {clock(r.choice.at)}
            {r.choice.notes && `: ${r.choice.notes}`}
          </p>
        )}
        {r.choice?.state === "reopened" && r.conflict === "reopened" && (
          <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
            A newer entry arrived after {r.choice.by}'s choice: the newest
            counts until an Official chooses again.
          </p>
        )}
        {r.conflict !== "none" && newest && (
          <ul className="mt-1 flex flex-col gap-1 text-xs">
            {r.candidates.map((c) => {
              const chosenNow = c.counts && r.choice?.state === "applied";
              const confirming = choosing?.entryId === c.entryId;
              return (
                <li key={c.entryId}>
                  <p>
                    {judgeText(c.judge)}, {clock(c.receivedAt)}
                    {c.counts && <strong> counts</strong>}
                  </p>
                  {confirming && choosing
                    ? confirmBar(choosing, "Confirm choice")
                    : !chosenNow && (
                        <button
                          className={ui.link}
                          onClick={() =>
                            setPending({
                              kind: "choose",
                              entrantId: r.entrantId,
                              entryId: c.entryId,
                              newestEntryId: newest.entryId,
                              ...fresh(),
                              reason: "",
                              busy: false,
                              problem: null,
                            })
                          }
                        >
                          Use this entry
                        </button>
                      )}
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  };

  const back = (
    <button className={`${ui.link} self-start`} onClick={onBack}>
      ← All Activities
    </button>
  );
  if (problem) {
    return (
      <section className="flex flex-col gap-4">
        {back}
        <p className={ui.error} role="alert">
          {problem}
        </p>
      </section>
    );
  }
  if (!view) return <p className={ui.muted}>Loading…</p>;

  const entrantWord = levelLabel(view.activity.competition.level, labels);
  const fieldLabel = new Map(view.fields.map((f) => [f.id, f.label]));
  return (
    <section className="flex flex-col gap-4">
      {back}
      <header>
        <h1 className={ui.h1}>{view.activity.title}</h1>
        <p className={ui.muted}>{view.activity.competition.label}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className={ui.h2}>Scores</h2>
        {view.matrix.some((r) => r.conflict !== "none") && (
          <p className={ui.warning}>
            A {entrantWord.toLowerCase()} marked Conflict was scored by more
            than one Judge: the newest counts until an Official resolves it with
            Use this entry.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Place
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  {entrantWord}
                </th>
                {view.fields.map((f) => (
                  <th
                    key={f.id}
                    scope="col"
                    className="py-1 pr-2 text-right font-medium"
                  >
                    {f.label}
                  </th>
                ))}
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Judge
                </th>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Received
                </th>
                <th scope="col" className="py-1 font-medium">
                  Official
                </th>
              </tr>
            </thead>
            <tbody>
              {view.matrix.map((r) => (
                <tr
                  key={r.entrantId}
                  className={`border-t border-stone-200 ${
                    r.conflict === "unresolved" ||
                    r.conflict === "reopened" ||
                    !r.onRoster
                      ? "bg-amber-50"
                      : r.scored
                        ? ""
                        : "text-stone-400"
                  }`}
                >
                  <td className="py-2 pr-2">
                    {r.disqualified
                      ? "DQ"
                      : r.place === null
                        ? "—"
                        : ordinal(r.place)}
                  </td>
                  <th scope="row" className="py-2 pr-2 font-normal">
                    {entrantLabel(r.entrantId, r.entrant)}
                    {!r.onRoster && (
                      <p className="text-xs font-medium text-amber-900">
                        Not on roster
                      </p>
                    )}
                    {choiceLines(r)}
                    {correctionLines(r)}
                    {r.dq && (
                      <p className="text-xs font-medium text-red-800">
                        DQ by {r.dq.by}, {clock(r.dq.at)}
                        {r.dq.notes && `: ${r.dq.notes}`}
                      </p>
                    )}
                    {(r.conflict === "unresolved" ||
                      r.conflict === "reopened") && (
                      <p className="text-xs font-medium text-amber-900">
                        Conflict: scored by{" "}
                        {r.judges.map(judgeText).join(" and ")}
                      </p>
                    )}
                    {r.entryCount > 1 && (
                      <p className="text-xs text-stone-500">
                        {r.entryCount} versions
                      </p>
                    )}
                  </th>
                  {r.scored ? (
                    <>
                      {view.fields.map((f) => (
                        <td
                          key={f.id}
                          className="py-2 pr-2 text-right align-top tabular-nums"
                        >
                          {valueCell(r, f)}
                        </td>
                      ))}
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {r.total}
                      </td>
                      <td className="py-2 pr-2">
                        {r.judge && judgeText(r.judge)}
                      </td>
                      <td className="py-2 pr-2 tabular-nums">
                        {r.receivedAt && clock(r.receivedAt)}
                      </td>
                    </>
                  ) : (
                    <td colSpan={view.fields.length + 3} className="py-2">
                      Not scored
                    </td>
                  )}
                  <td className="py-2 align-top">{officialCell(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={ui.h2}>Judges' closures</h2>
        {view.closures.length === 0 ? (
          <p className={ui.muted}>No Judge has closed this Activity yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.closures.map((c, i) => (
              <li
                key={i}
                className={
                  c.missing.length > 0 || c.scoredSince > 0
                    ? ui.warning
                    : ui.note
                }
              >
                <p>
                  <strong>{c.judge.name}</strong>
                  {c.judge.homeGroup && ` (${c.judge.homeGroup})`} closed it
                  with{" "}
                  {c.scoreCount === 1 ? "1 score" : `${c.scoreCount} scores`}
                  {c.missing.length === 0 &&
                    c.scoredSince === 0 &&
                    ": all here."}
                </p>
                {c.missing.length > 0 && (
                  <p>
                    {c.missing.length === 1
                      ? "1 of them hasn't reached the box."
                      : `${c.missing.length} of them haven't reached the box.`}
                  </p>
                )}
                {c.scoredSince > 0 && (
                  <p>Then scored {c.scoredSince} more: reopened.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={ui.h2}>Score entries received</h2>
        {view.entries.length === 0 && (
          <p className={ui.muted}>None received yet.</p>
        )}
        <ol className="flex flex-col gap-2">
          {view.entries.map((e) => (
            <li key={e.id} className={ui.card}>
              <p className="font-medium">
                {entrantLabel(e.entrantId, e.entrant)}
              </p>
              <p className={ui.muted}>
                #{e.receivedSeq} from {e.judge.name}
                {e.judge.homeGroup && ` (${e.judge.homeGroup})`}
                {!e.counts &&
                  " · another entry for this " + entrantWord + " counts"}
              </p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                {Object.entries(e.values).map(([id, value]) => (
                  <div key={id} className="contents">
                    <dt className="text-stone-600">
                      {fieldLabel.get(id) ?? id}
                    </dt>
                    <dd className="text-right tabular-nums">
                      {value === null ? "" : String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
