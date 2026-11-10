import type {
  JudgeLabels,
  OfficialActivity,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { errorMessage, newId, officialApi } from "../api.ts";
import { clock, entrantLabel, levelLabel, ordinal } from "../format.ts";
import { ui } from "../ui.ts";

type MatrixRow = OfficialActivity["matrix"][number];

/** An Official confirming a DQ or reinstatement on one row. The id is kept for retries of the same click. */
interface Pending {
  entrantId: string;
  disqualified: boolean;
  id: string;
  reason: string;
  busy: boolean;
  problem: string | null;
}

const judgeText = (j: { name: string; homeGroup?: string }) =>
  j.homeGroup ? `${j.name} (${j.homeGroup})` : j.name;

/**
 * One Activity for an Official (#42 PR 2a): the score matrix, then every score entry received. The matrix is
 * the box's, from packages/scoring, shown in the order given; nothing is re-sorted or re-totalled here. An
 * Official can DQ or reinstate a row (PR 2b): that logs an action on the box and the matrix is read again.
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
    try {
      await officialApi.act(email, p.id, {
        action: {
          type: "disqualify",
          activityId,
          entrantId: p.entrantId,
          disqualified: p.disqualified,
          ...(notes !== "" && { notes }),
        },
        clientCreatedAt: new Date().toISOString(),
      });
      setView(await officialApi.activity(email, activityId));
      setPending(null);
    } catch (e) {
      // The id stays, so a retry resends the same action (safe).
      setPending({ ...p, busy: false, problem: errorMessage(e) });
    }
  };

  const officialCell = (r: MatrixRow) => {
    if (pending?.entrantId === r.entrantId) {
      const verb = pending.disqualified ? "DQ" : "reinstate";
      return (
        <div className="flex min-w-40 flex-col gap-2">
          <label className={ui.label}>
            Reason
            <input
              className={ui.input}
              value={pending.reason}
              disabled={pending.busy}
              onChange={(e) =>
                setPending({ ...pending, reason: e.target.value })
              }
            />
          </label>
          {pending.problem && (
            <p className={ui.error} role="alert">
              {pending.problem}
            </p>
          )}
          <div className="flex gap-2">
            <button
              className={ui.button}
              disabled={pending.busy}
              onClick={() => void confirm(pending)}
            >
              Confirm {verb}
            </button>
            <button
              className={ui.buttonQuiet}
              disabled={pending.busy}
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    if (!r.onRoster || !r.scored) return null;
    const disqualified = !r.disqualified;
    return (
      <button
        className={ui.buttonQuiet}
        onClick={() =>
          setPending({
            entrantId: r.entrantId,
            disqualified,
            id: newId(),
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
        {view.matrix.some((r) => r.conflict) && (
          <p className={ui.warning}>
            A {entrantWord.toLowerCase()} marked Conflict was scored by more
            than one Judge: the newest counts until an Official resolves it.
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
                    r.conflict || !r.onRoster
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
                    {r.dq && (
                      <p className="text-xs font-medium text-red-800">
                        DQ by {r.dq.by}, {clock(r.dq.at)}
                        {r.dq.notes && `: ${r.dq.notes}`}
                      </p>
                    )}
                    {r.conflict && (
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
                      {view.fields.map((f) => {
                        const value = r.values?.[f.id];
                        return (
                          <td
                            key={f.id}
                            className="py-2 pr-2 text-right tabular-nums"
                          >
                            {value === null || value === undefined
                              ? ""
                              : String(value)}
                          </td>
                        );
                      })}
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
                  " · a newer entry for this " + entrantWord + " counts"}
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
