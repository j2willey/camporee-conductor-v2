import { describe, expect, it } from "vitest";
import { renderInlineMarkdown, renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  it("is empty for empty or blank text", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("  \n \n")).toBe("");
  });

  it("makes blank-line-separated paragraphs", () => {
    expect(renderMarkdown("One.\n\nTwo.")).toBe("<p>One.</p>\n<p>Two.</p>");
  });

  it("turns a single newline inside a paragraph into a line break", () => {
    expect(renderMarkdown("a\nb")).toBe("<p>a<br>b</p>");
  });

  it.each(["-", "*", "+"])(
    "makes a bulleted list from lines starting %s",
    (m) => {
      expect(renderMarkdown(`${m} a\n${m} b`)).toBe(
        "<ul><li>a</li><li>b</li></ul>",
      );
    },
  );

  it.each(["1.", "1)", "12.   "])("makes a numbered list from %s", (m) => {
    expect(renderMarkdown(`${m} a\n2. b`)).toBe(
      "<ol><li>a</li><li>b</li></ol>",
    );
  });

  it("nests an indented list inside the previous item, one level", () => {
    expect(renderMarkdown("- a\n  - a1\n  - a2\n- b")).toBe(
      "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>",
    );
    expect(renderMarkdown("1. a\n   * x")).toBe(
      "<ol><li>a<ul><li>x</li></ul></li></ol>",
    );
  });

  it("ends a paragraph at a list that follows it directly", () => {
    expect(renderMarkdown("Scoring (100 points total):\n- a\n- b")).toBe(
      "<p>Scoring (100 points total):</p>\n<ul><li>a</li><li>b</li></ul>",
    );
  });

  it("returns to a paragraph after a list", () => {
    expect(renderMarkdown("- a\n\nAfter.")).toBe(
      "<ul><li>a</li></ul>\n<p>After.</p>",
    );
  });

  it("renders bold and italic", () => {
    expect(renderMarkdown("a **b** *c* _d_ e")).toBe(
      "<p>a <strong>b</strong> <em>c</em> <em>d</em> e</p>",
    );
  });

  it("leaves underscores inside words alone", () => {
    expect(renderMarkdown("snake_case_name")).toBe("<p>snake_case_name</p>");
  });

  it("keeps raw HTML as text", () => {
    expect(renderMarkdown("<script>alert(1)</script> & **<b>x</b>**")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; <strong>&lt;b&gt;x&lt;/b&gt;</strong></p>",
    );
    expect(renderMarkdown("- <img src=x onerror=1>")).not.toContain("<img");
  });

  it("renders Circus 2026's numbered list with bold and italic", () => {
    const html = renderMarkdown(
      "1.  **Form Your Troupe:** Your entire patrol will line up.\n2.  **Bind for Unity:** Scouts will bind their adjacent *inside* ankles together.",
    );
    expect(html).toBe(
      "<ol><li><strong>Form Your Troupe:</strong> Your entire patrol will line up.</li><li><strong>Bind for Unity:</strong> Scouts will bind their adjacent <em>inside</em> ankles together.</li></ol>",
    );
  });

  it("renders The High-Wire Fire Act's reset list after its sentence", () => {
    const html = renderMarkdown(
      "Ideally the Patrol should perform the reset. Estimated reset time: 3–5 minutes.\n* Remove ash and burned material.\n* Refill water bucket.",
    );
    expect(html).toBe(
      "<p>Ideally the Patrol should perform the reset. Estimated reset time: 3–5 minutes.</p>\n<ul><li>Remove ash and burned material.</li><li>Refill water bucket.</li></ul>",
    );
  });

  it("renders Campsite All-Around's scoring text", () => {
    const html = renderMarkdown(
      "Judges visit each campsite.\n\nScoring (100 points total):\n- Organization & Layout: 0–20 pts\n- Safety: 0–20 pts\n\nTiebreaker: Judges' discretion.",
    );
    expect(html).toBe(
      "<p>Judges visit each campsite.</p>\n<p>Scoring (100 points total):</p>\n<ul><li>Organization &amp; Layout: 0–20 pts</li><li>Safety: 0–20 pts</li></ul>\n<p>Tiebreaker: Judges&#39; discretion.</p>",
    );
  });

  it("renders an indented sub-list under a plain line's list", () => {
    const html = renderMarkdown(
      "Match Penalty:\n  - Patrol HAS fire starters: first match free\n  - Lighter used: +3 minutes flat",
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Lighter used: +3 minutes flat</li>");
  });
});

describe("renderInlineMarkdown", () => {
  it("escapes and renders bold and italic only", () => {
    expect(renderInlineMarkdown("a **b** & <i>c</i> *d*")).toBe(
      "a <strong>b</strong> &amp; &lt;i&gt;c&lt;/i&gt; <em>d</em>",
    );
    expect(renderInlineMarkdown("- not a list")).toBe("- not a list");
  });
});
