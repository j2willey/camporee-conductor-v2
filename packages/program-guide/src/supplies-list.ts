import type { Activity, Event } from "@camporee-conductor/schema";
import { activityGuideNumbers } from "./activity-guide.ts";
import { escapeHtml } from "./render.ts";

// The supplies list (ADR-0028 item 10, #44 PR 3): v1's printSupplies, per Activity, from the design. Quantities
// are free text, so nothing is added up.

export type SuppliesListLine =
  | { kind: "group"; text: string }
  | { kind: "item"; text: string; sub: boolean };

export interface SuppliesList {
  /** The Event's title. */
  title: string;
  /** One per Activity, in the order given. */
  entries: { number?: string; title: string; lines: SuppliesListLine[] }[];
}

/** v1 split a long Activity every 30 lines in continuous mode, since a browser doesn't say where pages break. */
const LINES_PER_PIECE = 30;

export function buildSuppliesList(
  event: Event,
  activities: Activity[],
): SuppliesList {
  const numbers = activityGuideNumbers(event);
  return {
    title: event.title,
    entries: activities.map((activity) => {
      const lines: SuppliesListLine[] = [];
      let group: string | undefined;
      for (const supply of activity.content.supplies) {
        // A new heading each time the group changes, so consecutive items of one group sit under one heading.
        if (supply.group !== undefined && supply.group !== group) {
          lines.push({ kind: "group", text: supply.group });
        }
        group = supply.group;
        lines.push({
          kind: "item",
          text:
            supply.quantity === undefined || supply.quantity.trim() === ""
              ? supply.item
              : `${supply.item} (${supply.quantity})`,
          sub: supply.group !== undefined,
        });
      }
      const number = numbers.get(activity.id);
      return {
        ...(number !== undefined && { number }),
        title: activity.title,
        lines,
      };
    }),
  };
}

/** Lines as nested lists: a group heading holds the sub-items after it. */
function renderLines(lines: SuppliesListLine[]): string {
  let html = "<ul>";
  let inGroup = false;
  for (const line of lines) {
    if (line.kind === "group" || (inGroup && !line.sub)) {
      if (inGroup) html += "</ul></li>";
      inGroup = false;
    }
    if (line.kind === "group") {
      html += `<li class="group">${escapeHtml(line.text)}<ul>`;
      inGroup = true;
    } else {
      html += `<li>${escapeHtml(line.text)}</li>`;
    }
  }
  if (inGroup) html += "</ul></li>";
  return `${html}</ul>`;
}

/** One standalone, print-ready page, no scripts. `perPage`: each Activity on its own page; else continuous. */
export function renderSuppliesListHtml(
  list: SuppliesList,
  options: { perPage?: boolean } = {},
): string {
  const perPage = options.perPage === true;
  const sections = list.entries.flatMap((entry) => {
    const heading = escapeHtml(
      entry.number === undefined
        ? entry.title
        : `${entry.number} ${entry.title}`,
    );
    const cls = perPage ? "entry per-page" : "entry";
    if (entry.lines.length === 0) {
      return [
        `<section class="${cls}"><h2>${heading}</h2><p class="none">No supplies listed.</p></section>`,
      ];
    }
    const pieces =
      perPage || entry.lines.length <= LINES_PER_PIECE
        ? [entry.lines]
        : Array.from(
            { length: Math.ceil(entry.lines.length / LINES_PER_PIECE) },
            (_, i) =>
              entry.lines.slice(i * LINES_PER_PIECE, (i + 1) * LINES_PER_PIECE),
          );
    return pieces.map((lines, i) =>
      i === 0
        ? `<section class="${cls}"><h2>${heading}</h2>${renderLines(lines)}</section>`
        : `<section class="${cls} cont"><h2>${heading} <em>(cont.)</em></h2>${renderLines(lines)}</section>`,
    );
  });
  const title = escapeHtml(list.title);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}: supplies list</title>
<style>${STYLES}</style>
</head>
<body>
<h1>Supplies list: ${title}</h1>
${sections.join("\n")}
</body>
</html>
`;
}

const STYLES = `
@page { size: letter; margin: 0.75in; }
* { box-sizing: border-box; }
html { background: #fff; color: #1c1917; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font: 11pt/1.4 Georgia, "Times New Roman", serif; margin: 0 auto; max-width: 7in; padding: 0.5in 16px; }
@media print { body { padding: 0; } }
h1 { font: 700 16pt "Helvetica Neue", Arial, sans-serif; border-bottom: 2px solid #1c1917; padding-bottom: 4pt; margin: 0 0 14pt; }
h2 { font: 700 13pt "Helvetica Neue", Arial, sans-serif; margin: 0 0 4pt; break-after: avoid; }
.cont h2 { color: #57534e; }
.cont h2 em { font-weight: 400; font-size: 11pt; }
.entry { margin-bottom: 14pt; }
.per-page { break-after: page; }
.per-page:last-child { break-after: auto; }
ul { margin: 2pt 0 0; padding-left: 1.6em; }
li { margin: 1pt 0; }
li.group { font-weight: 600; list-style: none; margin-left: -1.2em; margin-top: 4pt; }
li.group ul { font-weight: 400; list-style: circle; }
.none { color: #78716c; font-style: italic; margin-left: 1.6em; }
`;
