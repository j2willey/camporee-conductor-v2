import { readdirSync, readFileSync } from "node:fs";
import {
  ActivitySchema,
  EventSchema,
  type Activity,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import {
  buildSuppliesList,
  renderSuppliesListHtml,
  type SuppliesList,
} from "./supplies-list.ts";

// The supplies list (ADR-0028 item 10): v1's printSupplies, per Activity, from the design.

const FIXTURE = new URL("../../schema/fixtures/circus-2026/", import.meta.url);
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));
const circus = EventSchema.parse(readJson("event.json"));
const activities = readdirSync(new URL("activities/", FIXTURE)).map((file) =>
  ActivitySchema.parse(readJson(`activities/${file}`)),
);
const bySlug = (slug: string): Activity => {
  const found = activities.find((a) => a.slug === slug);
  if (!found) throw new Error(`no Activity ${slug}`);
  return found;
};

const clownCar = bySlug("clown-car");
const bigTopDown = bySlug("the-big-top-goes-down"); // grouped: JUDGE SUPPLIES, PATROL USE, SCENE PROPS
const showtime = bySlug("showtime-in-the-center-ring"); // no supplies

/** An Activity with `n` ungrouped supplies, for the continuous split. */
const withSupplies = (n: number): Activity => ({
  ...clownCar,
  content: {
    ...clownCar.content,
    supplies: Array.from({ length: n }, (_, i) => ({ item: `Item ${i + 1}` })),
  },
});

describe("buildSuppliesList", () => {
  it("lists each Activity in the order given, with its number and title", () => {
    const list = buildSuppliesList(circus, [bigTopDown, clownCar]);
    expect(list.title).toBe(circus.title);
    expect(list.entries.map((e) => e.title)).toEqual([
      bigTopDown.title,
      clownCar.title,
    ]);
    expect(list.entries[1]?.number).toBe("P12");
  });

  it('writes an item as "item (quantity)", or the item alone', () => {
    const [entry] = buildSuppliesList(circus, [clownCar]).entries;
    expect(entry?.lines[0]).toEqual({
      kind: "item",
      text: "Garbage can lid (1)",
      sub: false,
    });
    const plain = buildSuppliesList(circus, [withSupplies(1)]).entries[0];
    expect(plain?.lines).toEqual([
      { kind: "item", text: "Item 1", sub: false },
    ]);
  });

  it("puts grouped supplies under their group heading, as sub-items, in the Activity's order", () => {
    const [entry] = buildSuppliesList(circus, [bigTopDown]).entries;
    const lines = entry?.lines ?? [];
    const groups = lines.filter((l) => l.kind === "group").map((l) => l.text);
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups).toEqual(
      expect.arrayContaining(["JUDGE SUPPLIES", "PATROL USE", "SCENE PROPS"]),
    );
    // Every item after a group heading is a sub-item; there's one line per supply plus one per group run.
    const firstGroup = lines.findIndex((l) => l.kind === "group");
    for (const line of lines.slice(firstGroup)) {
      if (line.kind === "item") expect(line.sub).toBe(true);
    }
    expect(lines.filter((l) => l.kind === "item")).toHaveLength(
      bigTopDown.content.supplies.length,
    );
  });

  it("gives an Activity with no supplies no lines", () => {
    expect(buildSuppliesList(circus, [showtime]).entries[0]?.lines).toEqual([]);
  });
});

describe("renderSuppliesListHtml", () => {
  const html = (list: SuppliesList, perPage = false) =>
    renderSuppliesListHtml(list, { perPage });

  it("is one standalone page with no scripts, titled for the Event", () => {
    const page = html(buildSuppliesList(circus, [clownCar]));
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain(`<title>${circus.title}: supplies list</title>`);
    expect(page).not.toContain("<script");
    expect(page).toContain("P12 Clown Car");
    expect(page).toContain("Garbage can lid (1)");
  });

  it('says "No supplies listed." for an Activity with none', () => {
    expect(html(buildSuppliesList(circus, [showtime]))).toContain(
      "No supplies listed.",
    );
  });

  it("nests sub-items under their group heading", () => {
    const page = html(buildSuppliesList(circus, [bigTopDown]));
    expect(page).toMatch(/<li class="group">JUDGE SUPPLIES<ul>/);
  });

  it("escapes every name", () => {
    const evil = {
      ...withSupplies(0),
      title: "<b>x</b>",
      content: {
        ...clownCar.content,
        supplies: [{ item: "<img src=x>", quantity: '"2"' }],
      },
    };
    const page = html(buildSuppliesList(circus, [evil]));
    expect(page).not.toContain("<img");
    expect(page).not.toContain("<b>x</b>");
    expect(page).toContain("&lt;img src=x&gt; (&quot;2&quot;)");
  });

  it("one Activity per page: each entry breaks after; continuous: none do", () => {
    const list = buildSuppliesList(circus, [clownCar, bigTopDown]);
    expect(html(list, true)).toContain('class="entry per-page"');
    expect(html(list, false)).not.toContain("per-page");
  });

  it("continuous: splits an Activity every 30 lines, headed (cont.)", () => {
    const page = html(buildSuppliesList(circus, [withSupplies(65)]));
    expect(page.match(/<section class="entry/g)).toHaveLength(3);
    expect(page.match(/\(cont\.\)/g)).toHaveLength(2);
    expect(page).toContain("Item 30</li></ul>");
    expect(page.indexOf("Item 31")).toBeGreaterThan(page.indexOf("(cont.)"));
  });

  it("one Activity per page: never split", () => {
    const page = html(buildSuppliesList(circus, [withSupplies(65)]), true);
    expect(page.match(/<section class="entry/g)).toHaveLength(1);
    expect(page).not.toContain("(cont.)");
  });
});
