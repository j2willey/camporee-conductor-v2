import type { AwardsView } from "@camporee-conductor/collator/types";
import { useEffect, useState } from "react";
import { errorMessage, officialApi } from "../api.ts";
import { ui } from "../ui.ts";
import {
  exhibitionRowText,
  provisionalBanner,
  winnerRow,
} from "../winners-text.ts";

/**
 * Awards (#43 PR 1): who places at each Activity and who receives each Award, from the box's winners registry
 * (packages/scoring). Provisional until every Activity is final. Stickers print from here (StickersPage); the script comes later.
 */
export function AwardsPage({
  email,
  onBack,
  onStickers,
}: {
  email: string;
  onBack: () => void;
  onStickers: () => void;
}) {
  const [view, setView] = useState<AwardsView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    officialApi.awards(email).then(
      (v) => current && setView(v),
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email]);

  return (
    <section className="flex flex-col gap-4">
      <button className={`${ui.link} self-start`} onClick={onBack}>
        ← Overview
      </button>
      <h1 className={ui.h1}>Awards</h1>
      <button className={`${ui.buttonQuiet} self-start`} onClick={onStickers}>
        Print stickers
      </button>
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      {!view && !problem && <p className={ui.muted}>Loading…</p>}
      {view && (
        <p
          className={view.provisional ? "text-amber-800" : ui.muted}
          role="status"
        >
          {provisionalBanner(view)}
        </p>
      )}
      {view?.sections.map((s) => (
        <section key={s.competition.id} className="flex flex-col gap-3">
          <h2 className={ui.h2}>{s.competition.label}</h2>
          {s.groups.map((g) => (
            <div
              key={`${g.kind}-${g.id}`}
              className="rounded-lg border border-stone-200 bg-white p-3"
              data-testid={`awards-${g.kind}`}
            >
              <h3 className="font-medium">{g.title}</h3>
              {g.kind === "exhibition" ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  {g.rows.map((r, i) => {
                    const t = exhibitionRowText(r);
                    return (
                      <li key={i}>
                        <span className="inline-block w-20 font-medium">
                          {t.place}
                        </span>
                        {t.name}
                        {t.belongs && (
                          <span className={ui.muted}> ({t.belongs})</span>
                        )}
                        {t.notes && (
                          <span className={ui.muted}>: {t.notes}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                  {g.lines.map((line) => {
                    const row = winnerRow(g, line);
                    return (
                      <li
                        key={`${line.entrantId}-${line.place ?? line.rank ?? ""}`}
                      >
                        <span className="inline-block w-20 font-medium">
                          {row.place}
                        </span>
                        {row.name}
                        {row.official && (
                          <span className={ui.muted}> (Official)</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </section>
  );
}
