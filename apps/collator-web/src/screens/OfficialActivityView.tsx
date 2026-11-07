import type {
  JudgeEvent,
  OfficialActivity,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { errorMessage, officialApi } from "../api.ts";
import { entrantLabel, ordinal } from "../format.ts";
import { ui } from "../ui.ts";

/**
 * One Activity for an Official: its ranking, then every score entry received. The ranking is the box's,
 * from packages/scoring, shown in the order given; nothing is re-sorted or re-totalled here.
 */
export function OfficialActivityView({
  email,
  activityId,
  labels,
  onBack,
}: {
  email: string;
  activityId: string;
  labels: JudgeEvent["event"]["labels"];
  onBack: () => void;
}) {
  const [view, setView] = useState<OfficialActivity | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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

  const entrantWord =
    view.activity.competition.level === "team" ? labels.team : labels.group;
  const fieldLabel = new Map(view.fields.map((f) => [f.id, f.label]));
  return (
    <section className="flex flex-col gap-4">
      {back}
      <header>
        <h1 className={ui.h1}>{view.activity.title}</h1>
        <p className={ui.muted}>{view.activity.competition.label}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className={ui.h2}>Ranking</h2>
        {view.ranking.length === 0 ? (
          <p className={ui.muted}>No scores yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-1 pr-2 font-medium">Place</th>
                <th className="py-1 pr-2 font-medium">{entrantWord}</th>
                <th className="py-1 text-right font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {view.ranking.map((r) => (
                <tr key={r.entrantId} className="border-t border-stone-200">
                  <td className="py-2 pr-2">
                    {r.place === null ? "DQ" : ordinal(r.place)}
                  </td>
                  <td className="py-2 pr-2">
                    {entrantLabel(r.entrantId, r.entrant)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
