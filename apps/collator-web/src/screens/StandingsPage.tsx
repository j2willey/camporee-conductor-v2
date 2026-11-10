import type {
  CompetitionStandingsView,
  JudgeLabels,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { errorMessage, newId, officialApi } from "../api.ts";
import { clock, entrantLabel, levelLabel, ordinal } from "../format.ts";
import { ui } from "../ui.ts";

type Row = CompetitionStandingsView["rows"][number];

/**
 * An Official confirming something on one row: an overall DQ or reinstatement, or an overall rank. One at a time.
 * The id and `clientCreatedAt` are made once and kept, so a retry resends exactly the same action (safe);
 * changing the number or the reason makes it a new action.
 */
type Pending = {
  competitionId: string;
  entrantId: string;
  id: string;
  clientCreatedAt: string;
  reason: string;
  busy: boolean;
  problem: string | null;
} & ({ kind: "dq"; disqualified: boolean } | { kind: "rank"; input: string });

const fresh = () => ({
  id: newId(),
  clientCreatedAt: new Date().toISOString(),
});

/** A typed number as a number; as typed when it isn't one, so the box's message explains. */
const numberOf = (input: string): number | string => {
  const n = Number(input);
  return Number.isFinite(n) ? n : input;
};

/**
 * Standings (#42 PR 4): one table per Competition, from the box. An Activity that isn't finalized counts as it
 * stands and is marked provisional (ADR-0019). Officials DQ an entrant overall or set an overall rank here.
 * Loads when opened and after each action; no polling.
 */
export function StandingsPage({
  email,
  labels,
  onBack,
}: {
  email: string;
  labels: JudgeLabels;
  onBack: () => void;
}) {
  const [view, setView] = useState<CompetitionStandingsView[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    let current = true;
    officialApi.standings(email).then(
      (v) => current && setView(v),
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email]);

  const confirm = async (p: Pending) => {
    setPending({ ...p, busy: true, problem: null });
    if (p.kind === "rank" && p.input.trim() === "") {
      setPending({ ...p, busy: false, problem: "Enter a number" });
      return;
    }
    const notes = p.reason.trim();
    const base = {
      entrantId: p.entrantId,
      ...(notes !== "" && { notes }),
    };
    try {
      await officialApi.act(email, p.id, {
        action:
          p.kind === "dq"
            ? { type: "disqualify", ...base, disqualified: p.disqualified }
            : {
                type: "set-overall-rank",
                competitionId: p.competitionId,
                ...base,
                rank: numberOf(p.input),
              },
        clientCreatedAt: p.clientCreatedAt,
      });
      setView(await officialApi.standings(email));
      setPending(null);
    } catch (e) {
      setPending({ ...p, busy: false, problem: errorMessage(e) });
    }
  };

  const confirmBar = (
    p: Pending,
    confirmText: string,
    before?: React.ReactNode,
  ) => (
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

  const officialCell = (competitionId: string, r: Row) => {
    const name = entrantLabel(r.entrantId, r.entrant);
    const start = (
      rest:
        { kind: "dq"; disqualified: boolean } | { kind: "rank"; input: string },
    ): Pending => ({
      competitionId,
      entrantId: r.entrantId,
      ...fresh(),
      reason: "",
      busy: false,
      problem: null,
      ...rest,
    });
    if (
      pending?.entrantId === r.entrantId &&
      pending.competitionId === competitionId
    ) {
      if (pending.kind === "dq") {
        return confirmBar(
          pending,
          `Confirm ${pending.disqualified ? "DQ" : "reinstate"}`,
        );
      }
      return confirmBar(
        pending,
        "Confirm rank",
        <input
          className={`${ui.input} text-right`}
          type="number"
          inputMode="numeric"
          aria-label={`Overall rank for ${name}`}
          min={1}
          step={1}
          value={pending.input}
          disabled={pending.busy}
          onChange={(e) =>
            setPending({ ...pending, input: e.target.value, ...fresh() })
          }
        />,
      );
    }
    return (
      <div className="flex flex-wrap gap-1">
        <button
          className={ui.buttonQuiet}
          aria-label={`${r.disqualified ? "Reinstate" : "DQ"} ${name} overall`}
          onClick={() =>
            setPending(start({ kind: "dq", disqualified: !r.disqualified }))
          }
        >
          {r.disqualified ? "Reinstate" : "DQ"}
        </button>
        {!r.disqualified && (
          <button
            className={ui.buttonQuiet}
            aria-label={`Overall rank for ${name}`}
            onClick={() => setPending(start({ kind: "rank", input: "" }))}
          >
            Rank
          </button>
        )}
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <button className={`${ui.link} self-start`} onClick={onBack}>
        ← Overview
      </button>
      <h1 className={ui.h1}>Standings</h1>
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      {!view && !problem && <p className={ui.muted}>Loading…</p>}
      {view?.map((c) => (
        <section key={c.competition.id} className="flex flex-col gap-2">
          <h2 className={ui.h2}>{c.competition.label}</h2>
          <p className={ui.muted}>
            {c.finalizedCount} of {c.activities.length} Activities final
          </p>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-stone-600">
                <tr>
                  <th className="px-3 py-2 font-medium">Rank</th>
                  <th className="px-3 py-2 font-medium">
                    {levelLabel(c.competition.level, labels)}
                  </th>
                  {c.activities.map((a) => (
                    <th key={a.id} className="px-3 py-2 font-medium">
                      {a.title}
                      {!a.finalized && " (provisional)"}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2 font-medium">Official</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr
                    key={r.entrantId}
                    className="border-t border-stone-100 align-top"
                  >
                    <td className="px-3 py-2">
                      {r.rank === null ? "DQ" : ordinal(r.rank)}
                      {r.rankOverride && r.provisionalRank !== null && (
                        <span className={`${ui.muted} block`}>
                          (auto {ordinal(r.provisionalRank)})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {entrantLabel(r.entrantId, r.entrant)}
                      {r.dq && (
                        <p className="text-xs text-amber-800">
                          DQ overall by {r.dq.by}, {clock(r.dq.at)}
                          {r.dq.notes && `: ${r.dq.notes}`}
                        </p>
                      )}
                      {r.rankOverride && (
                        <p className={`${ui.muted} text-xs`}>
                          Rank set to {r.rankOverride.rank} by{" "}
                          {r.rankOverride.by}, {clock(r.rankOverride.at)}
                          {r.rankOverride.notes && `: ${r.rankOverride.notes}`}
                        </p>
                      )}
                    </td>
                    {c.activities.map((a) => (
                      <td key={a.id} className="px-3 py-2">
                        {r.points[a.id] ?? ""}
                      </td>
                    ))}
                    <td className="px-3 py-2">{r.total}</td>
                    <td className="px-3 py-2">
                      {officialCell(c.competition.id, r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </section>
  );
}
