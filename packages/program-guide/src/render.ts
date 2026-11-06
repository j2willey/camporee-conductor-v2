import type {
  ContentSource,
  Guide,
  GuideBlock,
  GuideSection,
} from "./guide.ts";

/** Escapes text for HTML content and attribute values. Every piece of text goes through this. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const SOURCE_NAMES: Record<ContentSource, string> = {
  event: "Event details",
  venue: "the Venue Profile",
  organization: "the Organization Profile",
  theme: "the theme",
};

/**
 * The guide as one standalone, print-ready HTML document (issue #5): no scripts, no external files.
 * Print to PDF from the browser.
 */
export function renderGuideHtml(guide: Guide): string {
  const stubText = (source: ContentSource, holds: string): string =>
    source === "theme" && guide.theme === undefined
      ? `To be supplied once the theme is chosen: ${holds}.`
      : `To be supplied from ${SOURCE_NAMES[source]}: ${holds}.`;

  const renderBlock = (block: GuideBlock): string => {
    switch (block.kind) {
      case "cover":
        return [
          `<p class="cover-label">Program Guide</p>`,
          `<h1>${escapeHtml(block.title)}</h1>`,
          ...block.lines.map(
            (line) => `<p class="cover-line">${escapeHtml(line)}</p>`,
          ),
        ].join("\n");
      case "paragraph":
        return `<p>${escapeHtml(block.text)}</p>`;
      case "list":
        return `<ul>\n${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}\n</ul>`;
      case "stub":
        return `<p class="stub">${escapeHtml(stubText(block.source, block.holds))}</p>`;
    }
  };

  const renderSection = (section: GuideSection): string => {
    const id = escapeHtml(section.id);
    const body = section.blocks.map(renderBlock).join("\n");
    if (section.id === "cover") {
      return `<section id="${id}" class="cover">\n${body}\n</section>`;
    }
    const tag = section.level === 1 ? "h1" : "h2";
    return [
      `<section id="${id}" class="level-${section.level}">`,
      `<${tag}>${escapeHtml(section.heading)}</${tag}>`,
      body,
      `</section>`,
    ].join("\n");
  };

  const [cover, ...rest] = guide.sections;
  const contents = rest
    .map(
      (s) =>
        `<li class="toc-${s.level}"><a href="#${escapeHtml(s.id)}">${escapeHtml(s.heading)}</a></li>`,
    )
    .join("\n");
  const draft =
    guide.stubCount > 0
      ? `<div class="draft">DRAFT<br>${guide.stubCount} ${guide.stubCount === 1 ? "section" : "sections"} to be supplied</div>`
      : "";
  const { main, header, accent } = guide.themeColors;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(guide.title)}: Program Guide</title>
<style>
:root { --main: ${main}; --header: ${header}; --accent: ${accent}; }
${STYLES}
</style>
</head>
<body>
${draft}
${cover ? renderSection(cover) : ""}
<nav class="toc">
<h1>Contents</h1>
<ol>
${contents}
</ol>
</nav>
${rest.map(renderSection).join("\n")}
</body>
</html>
`;
}

const STYLES = `
@page { size: letter; margin: 0.75in; }
* { box-sizing: border-box; }
html { background: #fff; color: #1c1917; }
body { font: 11pt/1.45 Georgia, "Times New Roman", serif; margin: 0 auto; max-width: 7in; padding: 0.5in 16px; }
h1, h2 { font-family: "Helvetica Neue", Arial, sans-serif; color: var(--header); line-height: 1.2; }
h1 { font-size: 20pt; border-bottom: 3px solid var(--main); padding-bottom: 4pt; margin: 0 0 10pt; }
h2 { font-size: 14pt; margin: 18pt 0 6pt; }
ul { padding-left: 1.4em; }
li { margin: 2pt 0; }
.level-1 { break-before: page; }
.toc { break-before: page; }
.level-2 { break-inside: avoid; }
.cover { min-height: 8.5in; display: flex; flex-direction: column; justify-content: center; text-align: center; }
.cover h1 { font-size: 30pt; border: 0; }
.cover-label { font: 600 12pt "Helvetica Neue", Arial, sans-serif; letter-spacing: 0.2em; text-transform: uppercase; color: var(--main); }
.cover-line { font-size: 16pt; margin: 4pt 0; }
.toc ol { list-style: none; padding: 0; }
.toc a { color: inherit; text-decoration: none; }
.toc-2 { padding-left: 1.5em; font-size: 10pt; }
.stub { border: 1px dashed #a8a29e; background: #f5f5f4; color: #57534e; font-style: italic; padding: 6pt 10pt; }
.draft {
  position: fixed; top: 38%; left: 0; right: 0; z-index: 10; pointer-events: none;
  text-align: center; transform: rotate(-30deg);
  font: 700 28pt/1.1 "Helvetica Neue", Arial, sans-serif; color: rgb(198 40 40 / 0.14);
}
.draft::first-line { font-size: 96pt; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`;
