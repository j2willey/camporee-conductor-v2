import { readdirSync, readFileSync } from "node:fs";
import {
  ActivitySchema,
  EventSchema,
  type Activity,
  type Event,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import {
  buildActivityGuide,
  renderActivityGuidesHtml,
  type ActivityGuide,
} from "./activity-guide.ts";

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
const competitionOf = (activity: Activity) => {
  const entry = circus.activities.find((a) => a.activityId === activity.id);
  return circus.competitions.find((c) => c.id === entry?.competitionId);
};

const clownCar = bySlug("clown-car"); // Patrol Games: team-level
const part = (guide: ActivityGuide, kind: string) => {
  const found = guide.parts.find((p) => p.kind === kind);
  if (!found) throw new Error(`no part ${kind}`);
  return found;
};
const headings = (guide: ActivityGuide, kind: string) =>
  part(guide, kind).sections.map((s) => s.heading);
const section = (guide: ActivityGuide, kind: string, heading: string) => {
  const found = part(guide, kind).sections.find((s) => s.heading === heading);
  if (!found) throw new Error(`no section ${heading}`);
  return found;
};
const withContent = (
  activity: Activity,
  content: Partial<Activity["content"]>,
): Activity => ({ ...activity, content: { ...activity.content, ...content } });

describe("buildActivityGuide", () => {
  it("has the header facts: id, title, Competition label, tags", () => {
    const guide = buildActivityGuide(circus, clownCar);
    expect(guide.id).toBe(clownCar.id);
    expect(guide.title).toBe("Clown Car");
    expect(guide.competitionLabel).toBe("Patrol Games");
    expect(guide.tags).toEqual(clownCar.tags ?? []);
    expect(guide.number).toBeUndefined();
    expect(buildActivityGuide(circus, clownCar, { number: "P3" }).number).toBe(
      "P3",
    );
  });

  it("has three parts in order, each with a heading and an audience", () => {
    const guide = buildActivityGuide(circus, clownCar);
    expect(guide.parts.map((p) => [p.kind, p.heading, p.audience])).toEqual([
      ["script", "The script", "Read this to the Patrol on arrival."],
      [
        "playbook",
        "The Judge's playbook",
        "Preparation and running notes for the Judge.",
      ],
      [
        "logistics",
        "Logistics and setup",
        "Equipment and layout for the setup team.",
      ],
    ]);
  });

  it("names the audience by the Competition's level: Team, or Group", () => {
    const troopChallenge = activities.find(
      (a) => competitionOf(a)?.level === "group",
    );
    if (!troopChallenge) throw new Error("fixture has no group-level Activity");
    expect(competitionOf(troopChallenge)?.label).toBe("Troop Challenges");
    expect(
      part(buildActivityGuide(circus, troopChallenge), "script").audience,
    ).toBe("Read this to the Troop on arrival.");
  });

  it("falls back to the default labels when the Event doesn't relabel", () => {
    const plain: Event = {
      ...circus,
      terminology: { pack: "generic" },
    };
    expect(part(buildActivityGuide(plain, clownCar), "script").audience).toBe(
      "Read this to the Team on arrival.",
    );
  });

  it("treats an Activity outside the Event's list as team-level with no label", () => {
    const stray = buildActivityGuide({ ...circus, activities: [] }, clownCar);
    expect(stray.competitionLabel).toBe("");
    expect(part(stray, "script").audience).toBe(
      "Read this to the Patrol on arrival.",
    );
  });

  it("puts the script's sections in order, from the Activity's text", () => {
    const guide = buildActivityGuide(circus, clownCar);
    expect(headings(guide, "script")).toEqual([
      "Background",
      "The Objective",
      "Instructions",
      "Rules & Constraints",
    ]);
    expect(section(guide, "script", "Background").blocks).toEqual([
      { kind: "markdown", text: clownCar.content.story },
    ]);
    expect(section(guide, "script", "Rules & Constraints").blocks).toEqual([
      { kind: "list", items: clownCar.content.rules },
    ]);
  });

  it("leaves out Rules & Constraints when there are no rules", () => {
    const guide = buildActivityGuide(
      circus,
      withContent(clownCar, { rules: [] }),
    );
    expect(headings(guide, "script")).not.toContain("Rules & Constraints");
  });

  it("puts custom sections in the playbook, in order, before Station Reset", () => {
    const guide = buildActivityGuide(
      circus,
      withContent(clownCar, {
        notes: "Mind the gap.",
        customSections: [
          { title: "Second Thoughts", body: "B" },
          { title: "First Thoughts", body: "A" },
        ],
      }),
    );
    expect(headings(guide, "playbook")).toEqual([
      "Scoring Overview",
      "Notes & Background",
      "Second Thoughts",
      "First Thoughts",
      "Station Reset",
    ]);
    expect(section(guide, "playbook", "Second Thoughts").blocks).toEqual([
      { kind: "markdown", text: "B" },
    ]);
  });

  it("omits Notes & Background when blank, and shows the real custom sections", () => {
    const guide = buildActivityGuide(
      circus,
      withContent(clownCar, { notes: "  \n", customSections: undefined }),
    );
    expect(headings(guide, "playbook")).toEqual([
      "Scoring Overview",
      "Station Reset",
    ]);
    const real = buildActivityGuide(circus, clownCar);
    expect(headings(real, "playbook")).toContain("Scoring Notes");
  });

  it("falls back for a missing reset, staffing, setup and supplies", () => {
    const guide = buildActivityGuide(
      circus,
      withContent(clownCar, {
        reset: "",
        staffing: " ",
        setup: "",
        supplies: [],
      }),
    );
    expect(section(guide, "playbook", "Station Reset").blocks).toEqual([
      { kind: "note", text: "No specific reset required." },
    ]);
    expect(section(guide, "logistics", "Supplies").blocks).toEqual([
      { kind: "note", text: "No supplies listed." },
    ]);
    expect(section(guide, "logistics", "Staffing").blocks).toEqual([
      { kind: "note", text: "Not given." },
    ]);
    expect(section(guide, "logistics", "Setup Instructions").blocks).toEqual([
      { kind: "note", text: "Not given." },
    ]);
  });

  it("groups supplies, keeping order: consecutive same-group items together", () => {
    const guide = buildActivityGuide(
      circus,
      withContent(clownCar, {
        supplies: [
          { item: "Rope", quantity: "1" },
          { group: "Props", item: "Hat" },
          { group: "Props", item: "Nose", quantity: "2" },
          { item: "Tape" },
          { group: "Props", item: "Shoe" },
        ],
      }),
    );
    expect(section(guide, "logistics", "Supplies").blocks).toEqual([
      {
        kind: "supplies",
        groups: [
          { items: [{ item: "Rope", quantity: "1" }] },
          {
            group: "Props",
            items: [{ item: "Hat" }, { item: "Nose", quantity: "2" }],
          },
          { items: [{ item: "Tape" }] },
          { group: "Props", items: [{ item: "Shoe" }] },
        ],
      },
    ]);
  });
});

describe("renderActivityGuidesHtml", () => {
  const html = (a: Activity = clownCar, number?: string) =>
    renderActivityGuidesHtml(circus, [
      buildActivityGuide(circus, a, number ? { number } : undefined),
    ]);

  it("is one standalone page with no scripts or external files", () => {
    const page = html();
    expect(page).toMatch(/^<!doctype html>/);
    expect(page).toContain('<meta charset="utf-8">');
    expect(page).toContain('name="viewport"');
    expect(page).not.toMatch(/<script|<link |<img|src=|href=/);
  });

  it("titles the page after the Activity for one guide, the Event for several", () => {
    expect(html()).toContain("<title>Clown Car: guide</title>");
    const two = renderActivityGuidesHtml(circus, [
      buildActivityGuide(circus, clownCar),
      buildActivityGuide(circus, bySlug("archery")),
    ]);
    expect(two).toContain(
      "<title>Coyote Creek District Camporee 2026: guides</title>",
    );
    expect(two.match(/<article class="activity-guide"/g)).toHaveLength(2);
  });

  it("has the header, the meta line, the three parts and the footer", () => {
    const page = html(clownCar, "P3");
    expect(page).toContain("<h1>P3. Clown Car</h1>");
    expect(page).toContain("Patrol Games");
    for (const kind of ["script", "playbook", "logistics"]) {
      expect(page).toContain(`<section class="part part-${kind}">`);
    }
    expect(page).toContain("<h2>The Judge&#39;s playbook</h2>");
    expect(page).toContain("<h3>Rules &amp; Constraints</h3>");
    expect(page).toContain("Read this to the Patrol on arrival.");
    expect(page).toContain("Generated by Camporee Conductor");
    expect(html()).toContain("<h1>Clown Car</h1>");
  });

  it("shows tags as #tags", () => {
    const tagged = { ...clownCar, tags: ["balance", "teamwork"] };
    expect(html(tagged)).toContain("#balance");
    expect(html(tagged)).toContain("#teamwork");
  });

  it("renders supplies as a table with the group as a caption", () => {
    const page = html(
      withContent(clownCar, {
        supplies: [{ group: "Scene Props", item: "Hat", quantity: "3" }],
      }),
    );
    expect(page).toContain("<caption>Scene Props</caption>");
    expect(page).toContain("<th>Item</th>");
    expect(page).toContain("<th>Quantity</th>");
    expect(page).toContain("<td>Hat</td>");
    expect(page).toContain("<td>3</td>");
  });

  it("renders Markdown in the Activity's text, and the rules inline", () => {
    const page = html(
      withContent(clownCar, {
        description: "1. **Go** now\n2. Stop",
        rules: ["No *running*"],
      }),
    );
    expect(page).toContain("<ol><li><strong>Go</strong> now</li>");
    expect(page).toContain("<li>No <em>running</em></li>");
  });

  it("escapes everything, including a malicious title and tag", () => {
    const page = html({
      ...withContent(clownCar, { story: "<script>alert(2)</script>" }),
      title: "<script>alert(1)</script>",
      tags: ['"><b>'],
    });
    expect(page).not.toContain("<script");
    expect(page).not.toContain("<b>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("starts each part after the first, and each guide after the first, on a new page", () => {
    const page = html();
    expect(page).toMatch(/\.part \+ \.part\s*\{[^}]*break-before:\s*page/);
    expect(page).toMatch(
      /\.activity-guide \+ \.activity-guide\s*\{[^}]*break-before:\s*page/,
    );
    expect(page).toContain("@page { size: letter; margin: 0.75in; }");
  });
});
