import { escapeHtml } from "./render.ts";

/**
 * A small Markdown subset for Activity text (ADR-0028 item 5): paragraphs, line breaks, bulleted and
 * numbered lists (one nested level), bold and italic. Text is escaped first, so raw HTML stays text.
 * No images or links yet.
 */

/** Bold and italic on already-escaped text. */
function inline(escaped: string): string {
  return escaped
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(?=[^\s*])(.+?)(?<=[^\s*])\*/g, "<em>$1</em>")
    .replace(
      /(?<![\p{L}\p{N}_])_(?=[^\s_])(.+?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu,
      "<em>$1</em>",
    );
}

/** One line of text: escaped, with bold and italic. */
export function renderInlineMarkdown(text: string): string {
  return inline(escapeHtml(text));
}

interface Item {
  indent: number;
  ordered: boolean;
  text: string;
}

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(\S.*)$/;

function parseItem(line: string): Item | null {
  const match = ITEM.exec(line);
  if (!match) return null;
  return {
    indent: (match[1] ?? "").replaceAll("\t", "    ").length,
    ordered: /^\d/.test(match[2] ?? ""),
    text: match[3] ?? "",
  };
}

const listTag = (ordered: boolean): string => (ordered ? "ol" : "ul");

/** A run of consecutive list lines: items indented 2+ spaces past the first nest in the item above. */
function renderList(items: Item[]): string {
  const base = items[0]?.indent ?? 0;
  let html = "";
  let open: boolean | null = null; // the top-level list's type while one is open
  for (let i = 0; i < items.length;) {
    const item = items[i] as Item;
    if (open !== null && open !== item.ordered) {
      html += `</${listTag(open)}>`;
      open = null;
    }
    if (open === null) {
      html += `<${listTag(item.ordered)}>`;
      open = item.ordered;
    }
    const nested: Item[] = [];
    let next = i + 1;
    while (next < items.length && (items[next] as Item).indent >= base + 2) {
      nested.push(items[next] as Item);
      next += 1;
    }
    html += `<li>${inline(escapeHtml(item.text))}`;
    if (nested.length > 0) html += renderList(nested);
    html += "</li>";
    i = next;
  }
  return open === null ? html : `${html}</${listTag(open)}>`;
}

export function renderMarkdown(text: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: Item[] = [];
  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length > 0) {
      blocks.push(renderList(list));
      list = [];
    }
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    const item = parseItem(line);
    if (item) {
      flushParagraph();
      list.push(item);
    } else {
      flushList();
      paragraph.push(inline(escapeHtml(line.trim())));
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("\n");
}
