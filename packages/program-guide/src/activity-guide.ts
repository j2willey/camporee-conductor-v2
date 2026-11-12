import {
  isActivityEnabled,
  type Activity,
  type Event,
} from "@camporee-conductor/schema";
import { renderInlineMarkdown, renderMarkdown } from "./markdown.ts";
import { escapeHtml } from "./render.ts";

/**
 * Activity guides (ADR-0028, issue #44): v1's Game Guides, generated from the design. A guide is a plain
 * model (`buildActivityGuide`) and one print-ready HTML page for any number of guides
 * (`renderActivityGuidesHtml`).
 */

export type ActivityGuideBlock =
  /** Activity text: Markdown subset. */
  | { kind: "markdown"; text: string }
  /** Rules: one per item, inline Markdown. */
  | { kind: "list"; items: string[] }
  /** Supplies in their `group` headings; `group` is left out for items without one. */
  | {
      kind: "supplies";
      groups: {
        group?: string;
        items: { item: string; quantity?: string }[];
      }[];
    }
  /** Fallback text, shown in italics. */
  | { kind: "note"; text: string };

export interface ActivityGuideSection {
  heading: string;
  blocks: ActivityGuideBlock[];
}

export type ActivityGuidePartKind = "script" | "playbook" | "logistics";

export interface ActivityGuidePart {
  kind: ActivityGuidePartKind;
  heading: string;
  /** Who this part is written for. */
  audience: string;
  sections: ActivityGuideSection[];
}

export interface ActivityGuide {
  id: string;
  title: string;
  /** The Activity's number in its Event, e.g. "P3" (ADR-0028 item 7); left out when the Event doesn't list it. */
  number?: string;
  /** The Competition's label, e.g. "Patrol Games"; "" when the Event doesn't list the Activity. */
  competitionLabel: string;
  tags: string[];
  parts: ActivityGuidePart[];
}

const hasText = (text: string): boolean => text.trim() !== "";
const markdown = (text: string): ActivityGuideBlock => ({
  kind: "markdown",
  text,
});
const note = (text: string): ActivityGuideBlock => ({ kind: "note", text });
/** The text as a Markdown block, or a note when it's blank. */
const textOr = (text: string, fallback: string): ActivityGuideBlock =>
  hasText(text) ? markdown(text) : note(fallback);

/** Consecutive supplies with the same `group` form one group, in the Activity's order. */
function groupSupplies(
  supplies: Activity["content"]["supplies"],
): Extract<ActivityGuideBlock, { kind: "supplies" }>["groups"] {
  const groups: Extract<ActivityGuideBlock, { kind: "supplies" }>["groups"] =
    [];
  for (const supply of supplies) {
    const item =
      supply.quantity === undefined
        ? { item: supply.item }
        : { item: supply.item, quantity: supply.quantity };
    const last = groups[groups.length - 1];
    if (last && last.group === supply.group) last.items.push(item);
    else if (supply.group === undefined) groups.push({ items: [item] });
    else groups.push({ group: supply.group, items: [item] });
  }
  return groups;
}

/**
 * Each Activity's number (ADR-0028 item 7): its Competition's initial and its place in that Competition
 * (`P3`). When two Competitions share an initial, or a label has none, every Activity uses its
 * Competition's position instead (`1-3`).
 */
export function activityGuideNumbers(event: Event): Map<string, string> {
  const initials = event.competitions.map(
    (c) => /[\p{L}\p{N}]/u.exec(c.label)?.[0]?.toUpperCase() ?? "",
  );
  const clash = initials.some(
    (initial, i) => initial === "" || initials.indexOf(initial) !== i,
  );
  const numbers = new Map<string, string>();
  event.competitions.forEach((competition, index) => {
    const prefix = clash ? `${index + 1}-` : (initials[index] ?? "");
    event.activities
      .filter((a) => a.competitionId === competition.id && isActivityEnabled(a))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach((entry, place) => {
        numbers.set(entry.activityId, `${prefix}${place + 1}`);
      });
  });
  return numbers;
}

export function buildActivityGuide(
  event: Event,
  activity: Activity,
  options: { number?: string } = {},
): ActivityGuide {
  const number = options.number ?? activityGuideNumbers(event).get(activity.id);
  const { content } = activity;
  const entry = event.activities.find((a) => a.activityId === activity.id);
  const competition = event.competitions.find(
    (c) => c.id === entry?.competitionId,
  );
  const labels = event.terminology.labels;
  const audienceLabel =
    competition?.level === "group"
      ? (labels?.group ?? "Group")
      : (labels?.team ?? "Team");

  const script: ActivityGuideSection[] = [
    { heading: "Background", blocks: [markdown(content.story)] },
    { heading: "The Objective", blocks: [markdown(content.objective)] },
    { heading: "Instructions", blocks: [markdown(content.description)] },
  ];
  if (content.rules.length > 0) {
    script.push({
      heading: "Rules & Constraints",
      blocks: [{ kind: "list", items: content.rules }],
    });
  }

  const playbook: ActivityGuideSection[] = [
    { heading: "Scoring Overview", blocks: [markdown(content.timeAndScoring)] },
  ];
  if (hasText(content.notes)) {
    playbook.push({
      heading: "Notes & Background",
      blocks: [markdown(content.notes)],
    });
  }
  for (const custom of content.customSections ?? []) {
    playbook.push({ heading: custom.title, blocks: [markdown(custom.body)] });
  }
  playbook.push({
    heading: "Station Reset",
    blocks: [textOr(content.reset, "No specific reset required.")],
  });

  const logistics: ActivityGuideSection[] = [
    {
      heading: "Supplies",
      blocks:
        content.supplies.length > 0
          ? [{ kind: "supplies", groups: groupSupplies(content.supplies) }]
          : [note("No supplies listed.")],
    },
    {
      heading: "Staffing",
      blocks: [textOr(content.staffing, "Not given.")],
    },
    {
      heading: "Setup Instructions",
      blocks: [textOr(content.setup, "Not given.")],
    },
  ];

  const guide: ActivityGuide = {
    id: activity.id,
    title: activity.title,
    competitionLabel: competition?.label ?? "",
    tags: activity.tags ?? [],
    parts: [
      {
        kind: "script",
        heading: "The script",
        audience: `Read this to the ${audienceLabel} on arrival.`,
        sections: script,
      },
      {
        kind: "playbook",
        heading: "The Judge's playbook",
        audience: "Preparation and running notes for the Judge.",
        sections: playbook,
      },
      {
        kind: "logistics",
        heading: "Logistics and setup",
        audience: "Equipment and layout for the setup team.",
        sections: logistics,
      },
    ],
  };
  if (number !== undefined) guide.number = number;
  return guide;
}

function renderBlock(block: ActivityGuideBlock): string {
  switch (block.kind) {
    case "markdown":
      return renderMarkdown(block.text);
    case "list":
      return `<ul>${block.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`;
    case "note":
      return `<p class="note">${escapeHtml(block.text)}</p>`;
    case "supplies":
      return block.groups
        .map((group) => {
          const caption =
            group.group === undefined
              ? ""
              : `<caption>${escapeHtml(group.group)}</caption>`;
          const rows = group.items
            .map(
              (i) =>
                `<tr><td>${escapeHtml(i.item)}</td><td>${escapeHtml(i.quantity ?? "")}</td></tr>`,
            )
            .join("");
          return `<table class="supplies">${caption}<thead><tr><th>Item</th><th>Quantity</th></tr></thead><tbody>${rows}</tbody></table>`;
        })
        .join("\n");
  }
}

function renderGuide(guide: ActivityGuide): string {
  const heading =
    guide.number === undefined
      ? guide.title
      : `${guide.number}. ${guide.title}`;
  const meta = [
    ...(guide.competitionLabel === "" ? [] : [guide.competitionLabel]),
    ...guide.tags.map((tag) => `#${tag}`),
  ];
  const parts = guide.parts
    .map((part) =>
      [
        `<section class="part part-${part.kind}">`,
        `<h2>${escapeHtml(part.heading)}</h2>`,
        `<p class="audience">${escapeHtml(part.audience)}</p>`,
        ...part.sections.map((section) =>
          [
            `<h3>${escapeHtml(section.heading)}</h3>`,
            ...section.blocks.map(renderBlock),
          ].join("\n"),
        ),
        `</section>`,
      ].join("\n"),
    )
    .join("\n");
  return `<article class="activity-guide" id="guide-${escapeHtml(guide.id)}">
<header>
<h1>${escapeHtml(heading)}</h1>
${meta.length > 0 ? `<p class="meta">${meta.map(escapeHtml).join(" &middot; ")}</p>` : ""}
</header>
${parts}
<footer>Generated by Camporee Conductor</footer>
</article>`;
}

/**
 * For each guide but the last, whether a blank page must follow it so the next guide starts on an odd
 * (right-hand) page (ADR-0028 item 9). `partPages` has, for each guide, the page count of each of its
 * parts; every part starts a new page, and the first guide starts on page 1.
 *
 * Self-contained plain JavaScript once printed: the page embeds this function's own source and runs it,
 * so it must not use imports, outer names or anything the runtime can't evaluate on its own.
 */
export const blankPagesAfter: (partPages: number[][]) => boolean[] = function (
  partPages,
) {
  const blanks = [];
  let next = 1;
  for (let i = 0; i < partPages.length - 1; i++) {
    for (const pages of partPages[i] ?? []) next += pages;
    const blank = next % 2 === 0;
    if (blank) next += 1;
    blanks.push(blank);
  }
  return blanks;
};

/** The printed page: Letter with this margin all round (CSS `@page` and the script's page size agree). */
const PAGE_MARGIN_IN = 0.75;
const PX_PER_IN = 96;
const CONTENT_WIDTH_PX = (8.5 - 2 * PAGE_MARGIN_IN) * PX_PER_IN;
const CONTENT_HEIGHT_PX = (11 - 2 * PAGE_MARGIN_IN) * PX_PER_IN;

/**
 * The two-sided script (ADR-0028 item 9), the page's only script. Measures each guide's parts at the
 * printed width, then puts a blank page after each guide that needs one. Runs on load and before
 * printing; the second run does nothing.
 */
const TWO_SIDED_SCRIPT = `(function () {
var blankPagesAfter = (${blankPagesAfter.toString()});
function run() {
  var body = document.body;
  if (body.getAttribute("data-two-sided-ready") === "true") return;
  var saved = body.getAttribute("style");
  body.style.width = "${CONTENT_WIDTH_PX}px";
  body.style.maxWidth = "none";
  body.style.padding = "0";
  var articles = Array.prototype.slice.call(document.querySelectorAll("article.activity-guide"));
  var counts = articles.map(function (article) {
    var top = article.getBoundingClientRect().top;
    var parts = Array.prototype.slice.call(article.querySelectorAll("section.part"));
    var bottom = article.getBoundingClientRect().bottom;
    var starts = [top].concat(parts.slice(1).map(function (p) { return p.getBoundingClientRect().top; }), [bottom]);
    var pages = [];
    for (var i = 0; i + 1 < starts.length; i++) {
      pages.push(Math.max(1, Math.ceil((starts[i + 1] - starts[i]) / ${CONTENT_HEIGHT_PX})));
    }
    return pages;
  });
  if (saved === null) body.removeAttribute("style"); else body.setAttribute("style", saved);
  var blanks = blankPagesAfter(counts);
  articles.forEach(function (article, i) {
    article.setAttribute("data-pages", String(counts[i].reduce(function (a, b) { return a + b; }, 0)));
    if (blanks[i]) {
      var blank = document.createElement("div");
      blank.className = "blank-page";
      article.parentNode.insertBefore(blank, article.nextSibling);
    }
  });
  body.setAttribute("data-two-sided-ready", "true");
}
window.addEventListener("load", run);
window.addEventListener("beforeprint", run);
if (document.readyState === "complete") run();
})();`;

/**
 * The guides as one standalone, print-ready HTML document, no external files. No script unless
 * `twoSided`, which adds the one script that starts each guide on a right-hand page.
 */
export function renderActivityGuidesHtml(
  event: Event,
  guides: ActivityGuide[],
  options: { twoSided?: boolean } = {},
): string {
  const twoSided = options.twoSided === true;
  const [only] = guides;
  const title =
    guides.length === 1 && only
      ? `${only.title}: guide`
      : `${event.title}: guides`;
  const { main, header } = event.presentation.themeColors;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { --main: ${main}; --header: ${header}; }
${STYLES}
</style>
</head>
<body${twoSided ? " data-two-sided" : ""}>
${guides.map(renderGuide).join("\n")}
${twoSided ? `<script>${TWO_SIDED_SCRIPT}</script>` : ""}
</body>
</html>
`;
}

const STYLES = `
@page { size: letter; margin: ${PAGE_MARGIN_IN}in; }
* { box-sizing: border-box; }
html { background: #fff; color: #1c1917; }
body { font: 11pt/1.45 Georgia, "Times New Roman", serif; margin: 0 auto; max-width: 7in; padding: 0.5in 16px; }
h1, h2, h3 { font-family: "Helvetica Neue", Arial, sans-serif; color: var(--header); line-height: 1.2; }
h1 { font-size: 20pt; border-bottom: 3px solid var(--main); padding-bottom: 4pt; margin: 0 0 6pt; }
h2 { font-size: 14pt; margin: 0 0 2pt; }
h3 { font-size: 11.5pt; margin: 12pt 0 3pt; break-after: avoid; }
p { margin: 4pt 0; }
ul, ol { margin: 4pt 0; padding-left: 1.4em; }
li { margin: 2pt 0; }
.meta { font: 10pt "Helvetica Neue", Arial, sans-serif; color: #57534e; margin: 0 0 12pt; }
.audience, .note { font-style: italic; color: #57534e; }
.activity-guide ~ .activity-guide { break-before: page; }
.blank-page { height: 0; break-before: page; break-after: page; }
@media print { body { padding: 0; } }
.part + .part { break-before: page; }
.supplies { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 10pt; break-inside: avoid; }
.supplies caption { text-align: left; font: 600 10.5pt "Helvetica Neue", Arial, sans-serif; padding: 2pt 0; }
.supplies th, .supplies td { border: 1px solid #a8a29e; padding: 2pt 6pt; text-align: left; vertical-align: top; }
.supplies th { background: #f5f5f4; }
footer { margin-top: 18pt; font: 9pt "Helvetica Neue", Arial, sans-serif; color: #78716c; text-align: center; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
