import { describe, expect, it } from "vitest";
import type { Guide, GuideSection } from "./guide.ts";
import { renderGuideHtml } from "./render.ts";

const section = (
  id: string,
  changes: Partial<GuideSection> = {},
): GuideSection => ({
  id,
  heading: id,
  level: 1,
  dependsOnTheme: false,
  blocks: [{ kind: "paragraph", text: `About ${id}.` }],
  ...changes,
});

const guide = (changes: Partial<Guide> = {}): Guide => ({
  title: "Spring Field Day",
  theme: "Under the Sea",
  themeColors: { main: "#C62828", header: "#1565C0", accent: "#F9A825" },
  sections: [section("cover"), section("introduction"), section("awards")],
  stubCount: 0,
  ...changes,
});

/** The text of every element with this class, tags stripped. */
const textOf = (html: string, className: string): string[] =>
  [
    ...html.matchAll(
      new RegExp(`<[a-z0-9]+ class="${className}"[^>]*>([\\s\\S]*?)</`, "g"),
    ),
  ].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, "").trim());

describe("renderGuideHtml", () => {
  it("is one complete, standalone HTML document titled after the Event", () => {
    const html = renderGuideHtml(guide());
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain("<title>Spring Field Day: Program Guide</title>");
    expect(html).not.toMatch(/<script|<link /);
  });

  describe("DRAFT banner", () => {
    it("shows the number of sections still to be supplied", () => {
      expect(
        textOf(renderGuideHtml(guide({ stubCount: 17 })), "draft"),
      ).toEqual(["DRAFT17 sections to be supplied"]);
    });

    it("says 1 section, not 1 sections", () => {
      expect(textOf(renderGuideHtml(guide({ stubCount: 1 })), "draft")).toEqual(
        ["DRAFT1 section to be supplied"],
      );
    });

    it("is absent once nothing is left to supply", () => {
      expect(renderGuideHtml(guide({ stubCount: 0 }))).not.toContain(
        'class="draft"',
      );
    });

    it("repeats on every printed page (fixed position)", () => {
      expect(renderGuideHtml(guide({ stubCount: 3 }))).toMatch(
        /\.draft\s*\{[^}]*position:\s*fixed/,
      );
    });
  });

  it("lists every section after the cover in the table of contents, linked to its anchor", () => {
    const html = renderGuideHtml(guide());
    expect([...html.matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1])).toEqual(
      ["introduction", "awards"],
    );
    expect(html).toContain('<section id="introduction"');
  });

  it("starts each top-level section on a new printed page", () => {
    const html = renderGuideHtml(
      guide({
        sections: [
          section("cover"),
          section("day-2"),
          section("skills", { level: 2 }),
        ],
      }),
    );
    expect(html).toContain('<section id="day-2" class="level-1">');
    expect(html).toContain('<section id="skills" class="level-2">');
    expect(html).toMatch(/\.level-1\s*\{[^}]*break-before:\s*page/);
  });

  it("uses the Event's theme colors", () => {
    expect(renderGuideHtml(guide())).toContain("--header: #1565C0");
  });

  describe("stubs", () => {
    const withStub = (source: "venue" | "theme", theme?: string) =>
      renderGuideHtml(
        guide({
          theme,
          stubCount: 1,
          sections: [
            section("cover"),
            section("directions", {
              blocks: [{ kind: "stub", source, holds: "how to get there" }],
            }),
          ],
        }),
      );

    it("names where the content will come from", () => {
      expect(textOf(withStub("venue"), "stub")).toEqual([
        "To be supplied from the Venue Profile: how to get there.",
      ]);
    });

    it("says a theme stub waits for the theme to be chosen when there's no theme", () => {
      expect(textOf(withStub("theme"), "stub")).toEqual([
        "To be supplied once the theme is chosen: how to get there.",
      ]);
      expect(textOf(withStub("theme", "Under the Sea"), "stub")).toEqual([
        "To be supplied from the theme: how to get there.",
      ]);
    });
  });

  it("escapes every piece of text", () => {
    const html = renderGuideHtml(
      guide({
        title: 'Fish & <Chips> "Day"',
        sections: [
          section("cover"),
          section("introduction", {
            heading: "<img src=x onerror=alert(1)>",
            blocks: [{ kind: "list", items: ["<b>bold</b> & 'quoted'"] }],
          }),
        ],
      }),
    );
    expect(html).toContain(
      "<title>Fish &amp; &lt;Chips&gt; &quot;Day&quot;: Program Guide</title>",
    );
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt; &amp; &#39;quoted&#39;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
  });
});
