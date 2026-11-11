import type {
  JudgeEvent,
  OfficialEvent,
  OfficialRoster,
} from "@camporee-conductor/collator/types";
import { useEffect, useMemo, useState } from "react";
import { api, errorMessage, officialApi } from "../api.ts";
import {
  sheetColumns,
  rowCount,
  sheetRows,
  withDuplex,
  type SheetColumn,
} from "../scoresheet.ts";
import { ui } from "../ui.ts";

/** v1's scoresheet CSS (utils.js printScoresheets): landscape, small type, a grid to write in. */
const PRINT_CSS = `
.sheet { font-family: Arial, sans-serif; font-size: 9pt; color: #000; background: #fff; margin-bottom: 0.3in; }
.sheet { overflow-x: auto; }
.sheet-title { font-size: 13pt; font-weight: bold; }
.sheet-meta { font-size: 8pt; color: #666; margin-bottom: 6px; }
.sheet table { table-layout: fixed; width: 100%; border-collapse: collapse; }
.sheet th { font-size: 7.5pt; text-align: center; vertical-align: bottom; border: 1px solid #999; padding: 2px 3px; }
.sheet th .hint { display: block; font-size: 7pt; font-weight: normal; opacity: 0.65; }
.sheet td { height: 30px; border: 1px solid #bbb; padding: 0 4px; overflow: hidden; }
.sheet td.num { color: #999; text-align: center; }
.sheet tbody tr:nth-child(even) { background: #f7f7f7; }
@media print {
  @page { size: landscape; margin: 0.4in; }
  body { background: #fff !important; }
  .sheet { overflow: visible; margin-bottom: 0; page-break-after: always; break-after: page; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
}`;

type Entrant = { group: string; team?: string };

/**
 * Paper scoresheets (#43 PR 5, ADR-0027): the fallback when phones fail. One landscape sheet per picked Activity.
 * The columns are the judge view's fields for the Activity (already merged with Common Fields, in the phone's
 * order); the rows are the roster in the judge picker's order, then blanks. Nothing is merged or ranked here.
 */
export function ScoresheetsPage({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [judge, setJudge] = useState<JudgeEvent | null>(null);
  const [official, setOfficial] = useState<OfficialEvent | null>(null);
  const [roster, setRoster] = useState<OfficialRoster | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  // What's typed in the Rows box; the sheets use rowCount() of it, so typing isn't snapped mid-number.
  const [rowsTyped, setRowsTyped] = useState("20");
  const rows = rowCount(rowsTyped);
  const [fill, setFill] = useState(true);
  const [twoSided, setTwoSided] = useState(false);

  useEffect(() => {
    let current = true;
    Promise.all([
      api.event(),
      officialApi.event(email),
      // Sheets can be printed before check-in; a roster that can't be read just means blank rows.
      officialApi.roster(email).catch(() => null),
    ]).then(
      ([j, o, r]) => {
        if (!current) return;
        setJudge(j);
        setOfficial(o);
        setRoster(r);
      },
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email]);

  const scoringType = useMemo(
    () =>
      new Map((official?.activities ?? []).map((a) => [a.id, a.scoringType])),
    [official],
  );

  const entrants = (level: "team" | "group"): Entrant[] => {
    if (!fill || !roster) return [];
    const groupName = (id: string) =>
      roster.groups.find((g) => g.id === id)?.name ?? "";
    // The roster as the box serves it: the same order the judge picker lists.
    return level === "team"
      ? roster.teams.map((t) => ({ group: groupName(t.groupId), team: t.name }))
      : roster.groups.map((g) => ({ group: g.name }));
  };

  const picked = (judge?.activities ?? []).filter((a) => !unchecked.has(a.id));
  const labels = judge?.event.labels;
  const sheets = (twoSided ? withDuplex(picked) : picked).flatMap((a) => {
    if (!labels) return [];
    const columns = sheetColumns(
      {
        scoringType: scoringType.get(a.id) ?? "ranked",
        level: a.competition.level,
        fields: a.fields,
      },
      labels,
    );
    const isExhibition = (scoringType.get(a.id) ?? "ranked") === "exhibition";
    return [
      {
        activity: a,
        columns,
        rows: sheetRows(
          isExhibition ? [] : entrants(a.competition.level),
          rows,
        ),
      },
    ];
  });
  const printed = new Date().toLocaleDateString();

  const setAll = (ids: string[], on: boolean) =>
    setUnchecked((was) => {
      const next = new Set(was);
      for (const id of ids) {
        if (on) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  const toggle = (id: string) => setAll([id], unchecked.has(id));

  return (
    <section className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div
        className="flex flex-col gap-4 print:hidden"
        data-testid="scoresheet-controls"
      >
        <button className={`${ui.link} self-start`} onClick={onBack}>
          ← Overview
        </button>
        <h1 className={ui.h1}>Paper scoresheets</h1>
        {problem && (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        )}
        {!judge && !problem && <p className={ui.muted}>Loading…</p>}
        {judge && (
          <>
            <div className="flex flex-col gap-3">
              {judge.competitions.map((c) => {
                const ids = judge.activities
                  .filter((a) => a.competition.id === c.id)
                  .map((a) => a.id);
                return (
                  <div key={c.id} className="flex flex-col gap-1">
                    <div className="mb-1 font-medium">
                      {c.label}{" "}
                      <button
                        className={ui.link}
                        onClick={() => setAll(ids, true)}
                        aria-label={`All ${c.label}`}
                      >
                        All
                      </button>{" "}
                      <button
                        className={ui.link}
                        onClick={() => setAll(ids, false)}
                        aria-label={`None of ${c.label}`}
                      >
                        None
                      </button>
                    </div>
                    {judge.activities
                      .filter((a) => a.competition.id === c.id)
                      .map((a) => (
                        <label key={a.id} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!unchecked.has(a.id)}
                            onChange={() => toggle(a.id)}
                          />
                          {a.title}
                        </label>
                      ))}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <label className={ui.label}>
                Rows
                <input
                  className={`${ui.input} w-24`}
                  type="number"
                  min={5}
                  max={60}
                  value={rowsTyped}
                  onChange={(e) => setRowsTyped(e.target.value)}
                  onBlur={() => setRowsTyped(String(rows))}
                />
              </label>
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={fill}
                  onChange={(e) => setFill(e.target.checked)}
                />
                Fill in the roster
              </label>
              <label className="flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={twoSided}
                  onChange={(e) => setTwoSided(e.target.checked)}
                />
                Two-sided (each sheet twice)
              </label>
              <button
                className={ui.buttonQuiet}
                onClick={() => window.print()}
                disabled={picked.length === 0}
              >
                Print
              </button>
            </div>
          </>
        )}
      </div>
      {judge && picked.length === 0 && (
        <p className={ui.muted}>Pick at least one Activity to print.</p>
      )}
      {judge &&
        sheets.map(({ activity, columns, rows: sheetBody }, i) => (
          <div
            key={`${activity.id}-${i}`}
            className="sheet"
            data-testid="scoresheet"
          >
            <div className="sheet-title">{activity.title}</div>
            <div className="sheet-meta">
              {activity.competition.label} · {judge.event.title} · Printed{" "}
              {printed}
            </div>
            <table>
              <colgroup>
                {columns.map((c) => (
                  <col key={c.key} style={c.width ? { width: c.width } : {}} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key}>
                      {c.label}
                      {c.hint && <span className="hint">{c.hint}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetBody.map((entrant, r) => (
                  <tr key={r}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.key === "#" ? "num" : ""}>
                        {cell(c, r, entrant)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </section>
  );
}

function cell(column: SheetColumn, row: number, entrant: Entrant | null) {
  if (column.key === "#") return row + 1;
  if (column.key === "group") return entrant?.group ?? "";
  if (column.key === "team") return entrant?.team ?? "";
  return "";
}
