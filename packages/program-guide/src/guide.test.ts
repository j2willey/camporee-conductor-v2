import { readdirSync, readFileSync } from "node:fs";
import {
  ActivitySchema,
  EventSchema,
  type Event,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { buildGuide, type GuideSection } from "./guide.ts";

// Real data: the Circus 2026 design fixture (CLAUDE.md: use real fixtures where possible).
const FIXTURE = new URL("../../schema/fixtures/circus-2026/", import.meta.url);
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));
const circus = EventSchema.parse(readJson("event.json"));
const circusActivities = readdirSync(new URL("activities/", FIXTURE)).map(
  (file) => ActivitySchema.parse(readJson(`activities/${file}`)),
);

const section = (sections: GuideSection[], id: string): GuideSection => {
  const found = sections.find((s) => s.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
};
const listItems = (s: GuideSection): string[] =>
  s.blocks.flatMap((b) => (b.kind === "list" ? b.items : []));
const stubs = (s: GuideSection) => s.blocks.filter((b) => b.kind === "stub");

/** A copy of the Circus Event with some fields changed. */
const circusWith = (changes: Partial<Event>): Event => ({
  ...circus,
  ...changes,
});

describe("buildGuide: section order (the 2026 guide as a coverage checklist)", () => {
  it("follows the weekend in order, with Competitions inside Day 2 and Awards inside Day 3", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(sections.map((s) => `${s.level} ${s.id}`)).toEqual([
      "1 cover",
      "1 introduction",
      "2 theme",
      "1 planning",
      "1 registration",
      "1 preparing",
      "1 day-1",
      "1 day-2",
      "2 skills",
      "2 competition-patrol-games",
      "2 competition-exhibition",
      "2 competition-troop-challenges",
      "2 evening-program",
      "1 day-3",
      "2 awards",
      "1 staff-and-recognition",
      "1 communications",
      "1 support",
      "1 general-information",
      "1 emergencies",
      "1 theme-ticklers",
      "1 schedule",
      "1 directions",
    ]);
  });

  it("puts each Competition under its label, in Event order", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(
      sections
        .filter((s) => s.id.startsWith("competition-"))
        .map((s) => s.heading),
    ).toEqual(["Patrol Games", "Exhibition Events", "Troop Challenges"]);
  });
});

describe("buildGuide: listing a Competition's Activities", () => {
  it("lists Activities by title in sortOrder when the Competition doesn't say otherwise", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(listItems(section(sections, "competition-exhibition"))).toEqual([
      "The High Wire Act",
      "The Human Fly",
      "The Wild West Show",
      "William Tell No Apple",
    ]);
  });

  it("leaves a disabled Activity out of the guide (ADR-0029 item 9)", () => {
    const wildWest = circusActivities.find(
      (a) => a.title === "The Wild West Show",
    );
    const activities = circus.activities.map((e) =>
      e.activityId === wildWest?.id ? { ...e, enabled: false } : e,
    );
    const { sections } = buildGuide(
      circusWith({ activities }),
      circusActivities,
    );
    expect(listItems(section(sections, "competition-exhibition"))).toEqual([
      "The High Wire Act",
      "The Human Fly",
      "William Tell No Apple",
    ]);
  });

  it("leaves the Activities out when listActivities is false, and says they'll be announced", () => {
    const { sections } = buildGuide(circus, circusActivities);
    const patrolGames = section(sections, "competition-patrol-games");
    expect(listItems(patrolGames)).toEqual([]);
    expect(patrolGames.blocks).toEqual([
      {
        kind: "paragraph",
        text: "The Patrol Games will be announced closer to the Camporee.",
      },
    ]);
  });

  it("lists them again when listActivities is switched back on", () => {
    const competitions = circus.competitions.map((c) => ({
      ...c,
      programGuide: { listActivities: true },
    }));
    const { sections } = buildGuide(
      circusWith({ competitions }),
      circusActivities,
    );
    expect(
      listItems(section(sections, "competition-patrol-games")),
    ).toHaveLength(18);
  });
});

describe("buildGuide: skills", () => {
  it("lists the Event's authored skills", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(listItems(section(sections, "skills"))).toEqual(
      circus.programGuide?.skills,
    );
  });

  it("is a stub to be supplied from Event details when there are none", () => {
    const withoutSkills: Partial<Event> = { ...circus };
    delete withoutSkills.programGuide;
    const { sections } = buildGuide(withoutSkills as Event, circusActivities);
    expect(section(sections, "skills").blocks).toEqual([
      {
        kind: "stub",
        source: "event",
        holds: "the skills units should prepare for",
      },
    ]);
  });
});

describe("buildGuide: Awards, described from the Award rules", () => {
  it("describes Overall by place and Top Dog as the top 25% of Troops in the Troop Challenges standings", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(section(sections, "awards").blocks).toEqual([
      {
        kind: "list",
        items: [
          "Overall: by place in the Patrol Games standings: 1st, 2nd, 3rd.",
          "Top Dog: the top 25% of Troops in the Troop Challenges standings.",
        ],
      },
    ]);
  });

  it("gives each named place its ordinal, unless the name already is one", () => {
    const [overall] = circus.awards ?? [];
    if (!overall) throw new Error("the Circus design has no Overall Award");
    const event = circusWith({
      awards: [
        {
          ...overall,
          label: "Axes",
          rule: { type: "places", names: ["Gold Axe", "2nd", "Bronze Axe"] },
        },
      ],
    });
    const { sections } = buildGuide(event, circusActivities);
    expect(section(sections, "awards").blocks).toEqual([
      {
        kind: "list",
        items: [
          "Axes: by place in the Patrol Games standings: Gold Axe (1st), 2nd, Bronze Axe (3rd).",
        ],
      },
    ]);
  });
});

describe("buildGuide: stubs and the DRAFT count", () => {
  it("names the source of every stub", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(stubs(section(sections, "directions"))).toEqual([
      {
        kind: "stub",
        source: "venue",
        holds: "directions, coordinates and travel time",
      },
    ]);
  });

  it("counts the sections that still hold a stub", () => {
    const { sections, stubCount } = buildGuide(circus, circusActivities);
    expect(stubCount).toBe(sections.filter((s) => stubs(s).length > 0).length);
    expect(stubCount).toBeGreaterThan(0);
  });

  it("has fewer stubs when the Event supplies more", () => {
    const withoutSkills: Partial<Event> = { ...circus };
    delete withoutSkills.programGuide;
    expect(buildGuide(circus, circusActivities).stubCount).toBe(
      buildGuide(withoutSkills as Event, circusActivities).stubCount - 1,
    );
  });
});

describe("buildGuide: theme present or absent (no new field: absent = no theme yet)", () => {
  it("uses the theme in the cover and headings when the Event has one", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(section(sections, "planning").heading).toBe(
      "Planning for The Circus Adventure",
    );
    expect(section(sections, "cover").blocks[0]).toEqual({
      kind: "cover",
      title: "Coyote Creek District Camporee 2026",
      lines: ["The Circus", "2026", "Organizer: Jim Willey"],
    });
    expect(stubs(section(sections, "theme"))).toEqual([
      {
        kind: "stub",
        source: "theme",
        holds:
          "the theme, and how units can bring it to their campsite, costumes and campfire acts",
      },
    ]);
  });

  it("falls back to theme-free headings and theme stubs when the Event has none", () => {
    const withoutTheme: Partial<Event> = { ...circus };
    delete withoutTheme.theme;
    const guide = buildGuide(withoutTheme as Event, circusActivities);
    const { sections } = guide;
    expect(guide.theme).toBeUndefined();
    expect(section(sections, "planning").heading).toBe("Planning to Attend");
    expect(section(sections, "support").heading).toBe("Volunteer Support");
    expect(section(sections, "cover").blocks[0]).toMatchObject({
      lines: ["2026", "Organizer: Jim Willey"],
    });
    // Same stub either way; the renderer words it "once the theme is chosen" (render tests).
    expect(stubs(section(sections, "theme"))).toEqual([
      {
        kind: "stub",
        source: "theme",
        holds:
          "the theme, and how units can bring it to their campsite, costumes and campfire acts",
      },
    ]);
    // Everything that doesn't depend on the theme still renders.
    expect(listItems(section(sections, "competition-exhibition"))).toHaveLength(
      4,
    );
  });

  it("marks which sections depend on the theme", () => {
    const { sections } = buildGuide(circus, circusActivities);
    expect(sections.filter((s) => s.dependsOnTheme).map((s) => s.id)).toEqual([
      "cover",
      "theme",
      "planning",
      "preparing",
      "support",
      "theme-ticklers",
    ]);
  });
});
