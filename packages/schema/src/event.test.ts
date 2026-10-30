import { describe, expect, it } from "vitest";
import { EventSchema, TemplateSchema, type Event } from "./event.ts";
import { issuesOf } from "./test-support.ts";

const COMPETITION = "0196cfa2-4c00-7000-8000-000000000020";
const SET = "0196cfa2-4c00-7000-8000-000000000010";
const ACTIVITY = "0196cfa2-4c00-7000-8000-000000000001";

const validEvent = (): Event => ({
  schemaVersion: "4.0",
  kind: "event",
  id: "0196cfa2-4c00-7000-8000-000000000100",
  slug: "coyote-creek-camporee-2026",
  title: "Coyote Creek District Camporee 2026",
  theme: "The Circus",
  year: 2026,
  terminology: {
    pack: "scouting",
    labels: { group: "Troop", team: "Patrol", participant: "Scout" },
  },
  presentation: {
    themeColors: { main: "#C62828", header: "#1565C0", accent: "#F9A825" },
    awardLabel: {
      line1: "Coyote Creek Camporee 2026",
      line2: "The Circus",
      syncFonts: true,
      styles: {
        line1: { font: "Georgia, serif", size: "10pt", bold: true },
        line2: { font: "Georgia, serif", size: "10pt", bold: true },
        activityName: { font: "Georgia, serif", size: "10pt", bold: true },
        winner: { font: "Georgia, serif", size: "10pt", bold: true },
      },
    },
  },
  competitions: [
    {
      id: COMPETITION,
      slug: "patrol-games",
      label: "Patrol Games",
      level: "team",
      registration: "registered",
      divisions: [],
      commonFields: { setId: SET, before: ["p_yell"], after: [] },
    },
  ],
  activities: [
    { activityId: ACTIVITY, competitionId: COMPETITION, sortOrder: 1 },
  ],
});

describe("EventSchema", () => {
  it("accepts a valid Event", () => {
    expect(EventSchema.parse(validEvent())).toEqual(validEvent());
  });

  it("does not accept rosters (ADR-0026: rosters are Collator-only)", () => {
    expect(
      issuesOf(EventSchema, { ...validEvent(), rosters: { groups: [] } }),
    ).toContain('Unrecognized key: "rosters"');
  });

  it("requires hex theme colors", () => {
    const event = validEvent();
    const presentation = {
      ...event.presentation,
      themeColors: { ...event.presentation.themeColors, main: "red" },
    };
    expect(issuesOf(EventSchema, { ...event, presentation })).toContain(
      "presentation.themeColors.main: must be a hex color like #C62828",
    );
  });

  it("uses generic levels for Competitions: team or group", () => {
    const event = validEvent();
    const competitions = [{ ...event.competitions[0], level: "subunit" }];
    expect(issuesOf(EventSchema, { ...event, competitions })).toContain(
      'competitions.0.level: Invalid option: expected one of "team"|"group"',
    );
  });

  it("rejects an activity entry whose Competition isn't in this Event", () => {
    const event = validEvent();
    const activities = [
      {
        activityId: ACTIVITY,
        competitionId: "0196cfa2-4c00-7000-8000-0000000000aa",
        sortOrder: 1,
      },
    ];
    expect(issuesOf(EventSchema, { ...event, activities })).toContain(
      "activities.0.competitionId: no Competition with this id in the Event",
    );
  });

  it("rejects the same Activity listed twice", () => {
    const event = validEvent();
    const entry = event.activities[0];
    expect(
      issuesOf(EventSchema, {
        ...event,
        activities: [entry, { ...entry, sortOrder: 2 }],
      }),
    ).toContain(`activities.1.activityId: duplicate activity id "${ACTIVITY}"`);
  });

  it("rejects duplicate Competition ids and duplicate sort orders", () => {
    const event = validEvent();
    const competition = event.competitions[0];
    expect(
      issuesOf(EventSchema, {
        ...event,
        competitions: [competition, competition],
      }),
    ).toContain(`competitions.1.id: duplicate competition id "${COMPETITION}"`);
    const entry = event.activities[0];
    expect(
      issuesOf(EventSchema, {
        ...event,
        activities: [
          entry,
          { ...entry, activityId: "0196cfa2-4c00-7000-8000-000000000002" },
        ],
      }),
    ).toContain("activities.1.sortOrder: duplicate sort order 1");
  });

  it("rejects an end date before the start date", () => {
    expect(
      issuesOf(EventSchema, {
        ...validEvent(),
        startDate: "2027-05-16",
        endDate: "2027-05-14",
      }),
    ).toContain("endDate: must not be before startDate (2027-05-16)");
  });
});

describe("TemplateSchema", () => {
  it("accepts an Event-shaped document with kind 'template' and attribution", () => {
    const template = {
      ...validEvent(),
      kind: "template",
      lineage: {
        attribution: [{ text: "Coyote Creek District, Circus 2026" }],
      },
    };
    expect(TemplateSchema.safeParse(template).success).toBe(true);
  });

  it("is not an Event, and an Event is not a Template", () => {
    expect(
      issuesOf(TemplateSchema, { ...validEvent(), kind: "event" }),
    ).toContain('kind: Invalid input: expected "template"');
    expect(
      issuesOf(EventSchema, { ...validEvent(), kind: "template" }),
    ).toContain('kind: Invalid input: expected "event"');
  });

  it("applies the same cross-checks as an Event", () => {
    const template = { ...validEvent(), kind: "template", competitions: [] };
    expect(issuesOf(TemplateSchema, template)).toContain(
      "activities.0.competitionId: no Competition with this id in the Event",
    );
  });
});
