import type {
  AwardLabel,
  AwardLabelView,
  AwardsView,
} from "@camporee-conductor/collator/types";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { errorMessage, newId, officialApi } from "../api.ts";
import { ui } from "../ui.ts";
import {
  provisionalBanner,
  stickerExhibitionLine,
  stickerRows,
  stickerWinnerLine,
} from "../winners-text.ts";

// The fonts v1 offered: system fonts only, so the page loads nothing from outside the box (ADR-0027). The box
// checks saves against the same list (apps/collator/src/award-label.ts).
const FONTS = [
  "Arial, sans-serif",
  "'Times New Roman', serif",
  "Georgia, serif",
  "'Courier New', monospace",
  "'Brush Script MT', cursive",
  "'Comic Sans MS', cursive",
  "Impact, sans-serif",
];

type StyleName = keyof AwardLabel["styles"];
const LINES: { name: StyleName; heading: string }[] = [
  { name: "line1", heading: "Line 1" },
  { name: "line2", heading: "Line 2" },
  { name: "activityName", heading: "Activity or Award name" },
  { name: "winner", heading: "Winner" },
];

const sizeNumber = (size: string) => Number.parseInt(size, 10);

/**
 * v1's sheet: 3 stickers across, a row of 3 kept together on a page, a gap after each Activity/Award. Each column is a
 * third of the page (about 2.5in portrait, as printed in May; 3.3in landscape), and a sticker is at most 1.5in tall,
 * padding included (Jim, 2026-11-11): 0.1in above and below, so 1.3in of lines.
 */
const PRINT_CSS = `
.sticker-table { table-layout: fixed; width: 100%; border-collapse: collapse; }
.sticker-table td { width: 33.33%; padding: 0.1in 0.15in; vertical-align: middle; }
.sticker-table .sticker { max-height: 1.3in; overflow: hidden; }
@media screen {
  /* On screen, the portrait page's printable width, so what's measured here is what prints. */
  .sticker-table { width: 7.5in; }
  .sticker-table .sticker[data-too-tall] { outline: 2px solid #dc2626; outline-offset: 2px; }
}
.sticker-table tbody { break-inside: avoid; }
.sticker-table .sticker-gap td { height: 0.15in; padding: 0; }
@media print {
  @page { margin: 0.5in; }
  body { background: #fff !important; }
}`;

/** One sticker's lines; line 1 and 2 are left out when empty. */
interface Sticker {
  key: string;
  title: string;
  winner: string;
}

/**
 * Award stickers (#43 PR 3, ADR-0027): the Awards view as a sheet to print from the laptop's browser. The label's
 * lines and fonts are set here and saved on the box. Nothing is ranked or sorted: the Awards view's order is kept.
 */
export function StickersPage({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  const [awards, setAwards] = useState<AwardsView | null>(null);
  const [saved, setSaved] = useState<AwardLabelView | null>(null);
  const [label, setLabel] = useState<AwardLabel | null>(null);
  const [competition, setCompetition] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // How many stickers their fonts make taller than 1.5in: they're cut off in print, so the page says so first.
  const sheetRef = useRef<HTMLTableElement>(null);
  const [tooTall, setTooTall] = useState(0);
  // Made once per set of edits and kept, so a retry resends exactly the same save.
  const [attempt, setAttempt] = useState<{
    id: string;
    clientCreatedAt: string;
    json: string;
  } | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([
      officialApi.awards(email),
      officialApi.awardLabel(email),
    ]).then(
      ([a, l]) => {
        if (!current) return;
        setAwards(a);
        setSaved(l);
        setLabel(l.label);
      },
      (e: unknown) => current && setProblem(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [email]);

  const unsaved =
    saved !== null &&
    label !== null &&
    JSON.stringify(label) !== JSON.stringify(saved.label);

  const save = async () => {
    if (!label) return;
    const json = JSON.stringify(label);
    const made =
      attempt?.json === json
        ? attempt
        : { id: newId(), clientCreatedAt: new Date().toISOString(), json };
    setAttempt(made);
    setBusy(true);
    setProblem(null);
    try {
      await officialApi.saveAwardLabel(email, made.id, {
        label,
        clientCreatedAt: made.clientCreatedAt,
      });
      setSaved(await officialApi.awardLabel(email));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const change = (edit: (l: AwardLabel) => AwardLabel) =>
    setLabel((l) => (l ? edit(l) : l));
  const setStyle = (
    name: StyleName,
    part: Partial<AwardLabel["styles"][StyleName]>,
  ) =>
    change((l) => ({
      ...l,
      styles: { ...l.styles, [name]: { ...l.styles[name], ...part } },
    }));

  const sections = (awards?.sections ?? []).filter(
    (s) => competition === "" || s.competition.id === competition,
  );
  const sheet = sections.flatMap((s) =>
    s.groups.flatMap((g) => {
      const stickers: Sticker[] =
        g.kind === "exhibition"
          ? g.rows.map((r, i) => ({
              key: `${g.id}-${i}`,
              title: g.title,
              winner: stickerExhibitionLine(r),
            }))
          : g.lines.map((line) => ({
              key: `${g.id}-${line.entrantId}-${line.place ?? line.rank ?? ""}`,
              title: g.title,
              winner: stickerWinnerLine(g, line),
            }));
      return stickers.length === 0
        ? []
        : [{ id: `${g.kind}-${g.id}`, stickers }];
    }),
  );

  // After each render, mark the stickers cut off at 1.5in (their lines overflow the capped box) and count them.
  useLayoutEffect(() => {
    const stickers = sheetRef.current?.querySelectorAll<HTMLElement>(
      "[data-testid=sticker]",
    );
    let count = 0;
    for (const el of stickers ?? []) {
      const over = el.scrollHeight > el.clientHeight + 1;
      el.toggleAttribute("data-too-tall", over);
      if (over) count += 1;
    }
    setTooTall(count);
  });

  const styleOf = (name: StyleName): CSSProperties => {
    const s = label ? label.styles[label.syncFonts ? "line1" : name] : null;
    return s
      ? {
          fontFamily: s.font,
          fontSize: s.size,
          fontWeight: s.bold ? "bold" : "normal",
        }
      : {};
  };

  return (
    <section className="flex flex-col gap-4">
      <style>{PRINT_CSS}</style>
      <div
        className="flex flex-col gap-4 print:hidden"
        data-testid="sticker-controls"
      >
        <button className={`${ui.link} self-start`} onClick={onBack}>
          ← Awards
        </button>
        <h1 className={ui.h1}>Award stickers</h1>
        {problem && (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        )}
        {!(awards && label) && !problem && <p className={ui.muted}>Loading…</p>}
        {awards && (
          <p
            className={awards.provisional ? "text-amber-800" : ui.muted}
            role="status"
          >
            {provisionalBanner(awards)}
          </p>
        )}
        {awards && label && (
          <>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={ui.label}>
                Line 1
                <input
                  className={ui.input}
                  value={label.line1}
                  onChange={(e) =>
                    change((l) => ({ ...l, line1: e.target.value }))
                  }
                />
              </label>
              <label className={ui.label}>
                Line 2
                <input
                  className={ui.input}
                  value={label.line2}
                  onChange={(e) =>
                    change((l) => ({ ...l, line2: e.target.value }))
                  }
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={label.syncFonts}
                onChange={(e) =>
                  change((l) => ({ ...l, syncFonts: e.target.checked }))
                }
              />
              One font for all lines
            </label>
            <div className="flex flex-col gap-2">
              {LINES.map(({ name, heading }) => {
                const locked = label.syncFonts && name !== "line1";
                const style = label.styles[locked ? "line1" : name];
                return (
                  <fieldset
                    key={name}
                    aria-label={`${heading} style`}
                    className="flex flex-wrap items-center gap-2"
                    disabled={locked}
                  >
                    <span className="w-44 text-sm font-medium">{heading}</span>
                    <select
                      aria-label={`${heading} font`}
                      className={ui.input}
                      value={style.font}
                      onChange={(e) => setStyle(name, { font: e.target.value })}
                    >
                      {FONTS.map((f) => (
                        <option key={f} value={f}>
                          {f.split(",")[0]?.replaceAll("'", "")}
                        </option>
                      ))}
                    </select>
                    <input
                      aria-label={`${heading} size in points`}
                      type="number"
                      min={6}
                      max={36}
                      className={`${ui.input} w-20`}
                      value={
                        Number.isNaN(sizeNumber(style.size))
                          ? ""
                          : sizeNumber(style.size)
                      }
                      onChange={(e) =>
                        setStyle(name, { size: `${e.target.value}pt` })
                      }
                    />
                    <label className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={style.bold}
                        onChange={(e) =>
                          setStyle(name, { bold: e.target.checked })
                        }
                      />
                      Bold
                    </label>
                  </fieldset>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button className={ui.button} disabled={busy} onClick={save}>
                Save settings
              </button>
              <button className={ui.buttonQuiet} onClick={() => window.print()}>
                Print
              </button>
              <p className={ui.muted} data-testid="label-source">
                {unsaved
                  ? "Not saved yet. It will still print as shown."
                  : saved?.source === "box"
                    ? `Saved by ${saved.savedBy}${saved.savedAt ? ` at ${new Date(saved.savedAt).toLocaleString()}` : ""}.`
                    : "From the Event."}
              </p>
            </div>
          </>
        )}
      </div>
      {tooTall > 0 && (
        <p
          className={`${ui.error} print:hidden`}
          role="alert"
          data-testid="sticker-too-tall"
        >
          {tooTall === 1 ? "1 sticker is" : `${tooTall} stickers are`} taller
          than 1.5 in (outlined in red), so the bottom would be cut off when
          printed. Make a font smaller, or shorten line 1 or 2.
        </p>
      )}
      {awards && label && sheet.length === 0 && (
        <p className={ui.muted}>
          There are no awards to print stickers for yet.
        </p>
      )}
      {label && sheet.length > 0 && (
        <div className="overflow-x-auto print:overflow-visible">
          <table
            className="sticker-table"
            data-testid="sticker-sheet"
            ref={sheetRef}
          >
            {sheet.flatMap((g) => [
              ...stickerRows(g.stickers).map((row, r) => (
                <tbody key={`${g.id}-${r}`}>
                  <tr>
                    {[...row, ...Array<null>(3 - row.length).fill(null)].map(
                      (s, i) => (
                        <td key={s?.key ?? `empty-${i}`}>
                          {s && (
                            <div className="sticker" data-testid="sticker">
                              {label.line1 !== "" && (
                                <div style={styleOf("line1")}>
                                  {label.line1}
                                </div>
                              )}
                              {label.line2 !== "" && (
                                <div style={styleOf("line2")}>
                                  {label.line2}
                                </div>
                              )}
                              <div style={styleOf("activityName")}>
                                {s.title}
                              </div>
                              <div style={styleOf("winner")}>{s.winner}</div>
                            </div>
                          )}
                        </td>
                      ),
                    )}
                  </tr>
                </tbody>
              )),
              <tbody key={`${g.id}-gap`}>
                <tr className="sticker-gap">
                  <td colSpan={3} />
                </tr>
              </tbody>,
            ])}
          </table>
        </div>
      )}
    </section>
  );
}
