import type { AwardsView } from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { errorMessage, officialApi } from "../api.ts";
import { ui } from "../ui.ts";
import {
  announcerExhibitionRow,
  announcerRow,
  provisionalBanner,
} from "../winners-text.ts";

/** v1's announcer sheet (conductor.css .announcer-block): a block per Activity or Award, kept together on a page. */
const PRINT_CSS = `
.announcer-block { break-inside: avoid; margin-bottom: 0.4in; border-left: 4px solid #000; padding-left: 0.2in; }
.announcer-title { font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #000; margin-bottom: 0.08in; }
.announcer-table { width: 100%; border-collapse: collapse; }
.announcer-table td { padding: 0.03in 0.1in 0.03in 0; vertical-align: top; }
.announcer-table .place { width: 1in; font-weight: bold; white-space: nowrap; }
.announcer-table .who { font-weight: bold; }
.announcer-table .score { width: 0.8in; text-align: right; color: #666; white-space: nowrap; }
.announcer-sheet { color: #000; background: #fff; }
@media print {
  @page { margin: 0.5in; }
  body { background: #fff !important; }
}`;

/**
 * Announcer script (#43 PR 4, ADR-0027): the Awards view as a print page for whoever reads the results out. Nothing is
 * ranked, summed or sorted here: the Awards view's order and scores are shown as given.
 */
export function AnnouncerPage({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [awards, setAwards] = useState<AwardsView | null>(null);
  const [competition, setCompetition] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    officialApi.awards(email).then(
      (a) => current && setAwards(a),
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email]);

  const sections = (awards?.sections ?? []).filter(
    (s) =>
      (competition === "" || s.competition.id === competition) &&
      s.groups.length > 0,
  );

  return (
    <section className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div
        className="flex flex-col gap-4 print:hidden"
        data-testid="announcer-controls"
      >
        <button className={`${ui.link} self-start`} onClick={onBack}>
          ← Awards
        </button>
        <h1 className={ui.h1}>Announcer script</h1>
        {problem && (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        )}
        {!awards && !problem && <p className={ui.muted}>Loading…</p>}
        {awards && (
          <div className="flex flex-wrap items-end gap-3">
            <label className={ui.label}>
              Competition
              <select
                className={ui.input}
                value={competition}
                onChange={(e) => setCompetition(e.target.value)}
              >
                <option value="">All</option>
                {awards.sections.map((s) => (
                  <option key={s.competition.id} value={s.competition.id}>
                    {s.competition.label}
                  </option>
                ))}
              </select>
            </label>
            <button className={ui.buttonQuiet} onClick={() => window.print()}>
              Print
            </button>
          </div>
        )}
      </div>
      {awards && (
        <div className="announcer-sheet" data-testid="announcer-sheet">
          {awards.provisional && (
            <p
              className="mb-4 font-semibold text-amber-800 print:text-black"
              data-testid="announcer-provisional"
            >
              {provisionalBanner(awards)}
            </p>
          )}
          {sections.length === 0 ? (
            <p className={ui.muted}>There are no results to read out yet.</p>
          ) : (
            sections.map((s) => (
              <div key={s.competition.id}>
                <h2 className={`${ui.h2} mb-3`}>{s.competition.label}</h2>
                {s.groups.map((g) => (
                  <div
                    key={`${g.kind}-${g.id}`}
                    className="announcer-block"
                    data-testid="announcer-block"
                  >
                    <div className="announcer-title">{g.title}</div>
                    <table className="announcer-table">
                      <tbody>
                        {g.kind === "exhibition"
                          ? g.rows.map((r, i) => {
                              const t = announcerExhibitionRow(r);
                              return (
                                <tr key={i}>
                                  <td className="place">{t.place}</td>
                                  <td>
                                    <span className="who">{t.name}</span>
                                    {t.belongs && ` (${t.belongs})`}
                                    {t.notes && `: ${t.notes}`}
                                  </td>
                                </tr>
                              );
                            })
                          : g.lines.map((line) => {
                              const row = announcerRow(g, line);
                              return (
                                <tr
                                  key={`${line.entrantId}-${line.place ?? line.rank ?? ""}`}
                                >
                                  <td className="place">{row.place}</td>
                                  <td className="who">{row.name}</td>
                                  <td className="score">{row.score}</td>
                                </tr>
                              );
                            })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
