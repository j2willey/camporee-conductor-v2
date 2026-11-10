import type {
  ExhibitionResultsView,
  ExhibitionRow,
  JudgeLabels,
  OfficialRoster,
} from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { ApiError, errorMessage, newId, officialApi } from "../api.ts";
import { clock } from "../format.ts";
import { ui } from "../ui.ts";

/** A row being edited; `key` keeps React's rows steady while they're moved and removed. */
type EditRow = ExhibitionRow & { key: string };

const blankRow = (): EditRow => ({
  key: newId(),
  participantName: "",
  group: "",
  team: "",
  place: "",
  notes: "",
});

const plain = (r: EditRow): ExhibitionRow => ({
  participantName: r.participantName,
  group: r.group,
  team: r.team,
  place: r.place,
  notes: r.notes,
});
const asEditRows = (rows: ExhibitionRow[]): EditRow[] =>
  rows.map((r) => ({ ...r, key: newId() }));
const same = (a: ExhibitionRow[], b: ExhibitionRow[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * An Exhibition's results (#42 PR 7, ADR-0027): the Official's list of who placed, saved as a whole. The save's id
 * and `clientCreatedAt` are made once per set of edits and kept, so a retry resends exactly the same save and the
 * box answers "repeat" even if the first landed and only the reply was lost.
 */
export function ExhibitionResultsPage({
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
  const [view, setView] = useState<ExhibitionResultsView | null>(null);
  const [roster, setRoster] = useState<OfficialRoster | null>(null);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The save being sent, kept across retries; dropped when the rows change. */
  const [attempt, setAttempt] = useState<{
    id: string;
    clientCreatedAt: string;
  } | null>(null);

  const load = async () => {
    const v = await officialApi.exhibition(email, activityId);
    setView(v);
    setRows(asEditRows(v.rows));
    setAttempt(null);
    setStale(false);
    setProblem(null);
  };

  useEffect(() => {
    let current = true;
    Promise.all([
      officialApi.exhibition(email, activityId),
      officialApi.roster(email).catch(() => null),
    ]).then(
      ([v, r]) => {
        if (!current) return;
        setView(v);
        setRows(asEditRows(v.rows));
        setRoster(r);
      },
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email, activityId]);

  if (!view) {
    return (
      <section className="flex flex-col gap-4">
        <button className={ui.link} onClick={onBack}>
          ← Overview
        </button>
        {problem ? (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        ) : (
          <p className={ui.muted}>Loading…</p>
        )}
      </section>
    );
  }

  const dirty = !same(rows.map(plain), view.rows);
  /** Any edit makes a new save, so the next press gets a new id. */
  const edit = (next: EditRow[]) => {
    setRows(next);
    setAttempt(null);
  };
  const change = (key: string, patch: Partial<ExhibitionRow>) =>
    edit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    if (!row) return;
    next.splice(i + by, 0, row);
    edit(next);
  };

  const save = async () => {
    const made = attempt ?? {
      id: newId(),
      clientCreatedAt: new Date().toISOString(),
    };
    setAttempt(made);
    setBusy(true);
    setProblem(null);
    try {
      await officialApi.saveExhibition(email, activityId, made.id, {
        rows: rows.map(plain),
        replacesId: view.saveId,
        clientCreatedAt: made.clientCreatedAt,
      });
      await load();
    } catch (e) {
      setProblem(errorMessage(e));
      setStale(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  };

  const groupList = `groups-${activityId}`;
  const teamList = `teams-${activityId}`;
  const names = (xs: { name: string }[] | undefined) => [
    ...new Set((xs ?? []).map((x) => x.name)),
  ];

  return (
    <section className="flex flex-col gap-4">
      <button className={`${ui.link} self-start`} onClick={onBack}>
        ← Overview
      </button>
      <div>
        <h1 className={ui.h1}>{view.activity.title}</h1>
        <p className={ui.muted}>
          Exhibition results.{" "}
          {view.savedBy && view.savedAt
            ? `Saved by ${view.savedBy}, ${clock(view.savedAt, true)}`
            : "Not saved yet"}
        </p>
      </div>
      <datalist id={groupList}>
        {names(roster?.groups).map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id={teamList}>
        {names(roster?.teams).map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-600">
            <tr>
              <th className="px-2 py-2 font-medium">Name</th>
              <th className="px-2 py-2 font-medium">{labels.group}</th>
              <th className="px-2 py-2 font-medium">{labels.team}</th>
              <th className="px-2 py-2 font-medium">Place</th>
              <th className="px-2 py-2 font-medium">Notes</th>
              <th className="px-2 py-2 font-medium">Row</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} className="border-t border-stone-100">
                <td className="px-2 py-1">
                  <input
                    className={`${ui.input} w-full`}
                    aria-label={`Name, row ${i + 1}`}
                    value={r.participantName}
                    onChange={(e) =>
                      change(r.key, { participantName: e.target.value })
                    }
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className={`${ui.input} w-full`}
                    aria-label={`${labels.group}, row ${i + 1}`}
                    list={groupList}
                    value={r.group}
                    onChange={(e) => change(r.key, { group: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className={`${ui.input} w-full`}
                    aria-label={`${labels.team}, row ${i + 1}`}
                    list={teamList}
                    value={r.team}
                    onChange={(e) => change(r.key, { team: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className={`${ui.input} w-28`}
                    aria-label={`Place, row ${i + 1}`}
                    value={r.place}
                    onChange={(e) => change(r.key, { place: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className={`${ui.input} w-full`}
                    aria-label={`Notes, row ${i + 1}`}
                    value={r.notes}
                    onChange={(e) => change(r.key, { notes: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1 whitespace-nowrap">
                  <button
                    className={ui.link}
                    aria-label={`Move row ${i + 1} up`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>{" "}
                  <button
                    className={ui.link}
                    aria-label={`Move row ${i + 1} down`}
                    disabled={i === rows.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>{" "}
                  <button
                    className={ui.link}
                    aria-label={`Remove row ${i + 1}`}
                    onClick={() => edit(rows.filter((x) => x.key !== r.key))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-stone-500" colSpan={6}>
                  No results yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          className={ui.buttonQuiet}
          onClick={() => edit([...rows, blankRow()])}
        >
          Add row
        </button>
        <button
          className={ui.button}
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save results"}
        </button>
      </div>
      {dirty && <p className={ui.note}>You have unsaved changes.</p>}
      {problem && (
        <div className="flex flex-col gap-2" role="alert">
          <p className={ui.error}>{problem}</p>
          {stale && (
            <div className="flex flex-col gap-2">
              <p className={ui.warning}>
                Reloading discards the changes you haven't saved.
              </p>
              <button
                className={`${ui.buttonQuiet} self-start`}
                onClick={() =>
                  void load().catch((e) => setProblem(errorMessage(e)))
                }
              >
                Reload
              </button>
            </div>
          )}
        </div>
      )}
      <section className="flex flex-col gap-1">
        <h2 className={ui.h2}>History</h2>
        {view.history.length === 0 ? (
          <p className={ui.muted}>Nothing saved yet.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {view.history.map((h) => (
              <li key={h.saveId}>
                {h.by}, {clock(h.at, true)}: {h.rowCount}{" "}
                {h.rowCount === 1 ? "result" : "results"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
