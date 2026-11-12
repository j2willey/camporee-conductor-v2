import { describe, expect, it } from "vitest";
import {
  EventSchema,
  isActivityEnabled,
  TemplateSchema,
  type Event,
} from "./event.ts";
import { issuesOf } from "./test-support.ts";

const COMPETITION = "0196cfa2-4c00-7000-8000-000000000020";
const SET = "0196cfa2-4c00-7000-8000-000000000010";
const ACTIVITY = "0196cfa2-4c00-7000-8000-000000000001";
const AWARD = "0196cfa2-4c00-7000-8000-000000000030";

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
  tieNumbering: "dense",
});

describe("EventSchema", () => {
  it("accepts a valid Event", () => {
    expect(EventSchema.parse(validEvent())).toEqual(validEvent());
  });

  it("numbers ties dense by default (ADR-0019)", () => {
    const stored: Partial<Event> = validEvent();
    delete stored.tieNumbering;
    expect(EventSchema.parse(stored).tieNumbering).toBe("dense");
  });

  it("accepts strict tie numbering and rejects anything else", () => {
    expect(
      EventSchema.parse({ ...validEvent(), tieNumbering: "strict" })
        .tieNumbering,
    ).toBe("strict");
    expect(
      issuesOf(EventSchema, { ...validEvent(), tieNumbering: "standard" }),
    ).toContain(
      'tieNumbering: Invalid option: expected one of "dense"|"strict"',
    );
  });

  describe("placement points table per Competition (ADR-0019)", () => {
    const withTable = (placementPoints: unknown) => {
      const event = validEvent();
      return {
        ...event,
        competitions: event.competitions.map((c) => ({
          ...c,
          placementPoints,
        })),
      };
    };

    it("accepts a table and leaves it out by default (scoring uses v1's table)", () => {
      const table = { places: [25, 15, 10], participation: 5 };
      expect(
        EventSchema.parse(withTable(table)).competitions[0]?.placementPoints,
      ).toEqual(table);
      expect(
        EventSchema.parse(validEvent()).competitions[0]?.placementPoints,
      ).toBeUndefined();
    });

    it("needs at least one place and no negative points", () => {
      for (const table of [
        { places: [], participation: 5 },
        { places: [10, -1], participation: 5 },
        { places: [10], participation: -5 },
        { places: [10] },
      ]) {
        expect(EventSchema.safeParse(withTable(table)).success).toBe(false);
      }
    });
  });

  describe("awards (ADR-0019 Awards amendment)", () => {
    const award = (rule: unknown, extra: object = {}) => ({
      id: AWARD,
      slug: "top-dog",
      label: "Top Dog",
      competitionId: COMPETITION,
      rule,
      ...extra,
    });
    const withAwards = (...awards: unknown[]) => ({ ...validEvent(), awards });

    it("accepts named places, top-percent and manual Awards, scope event by default", () => {
      const parsed = EventSchema.parse(
        withAwards(
          award({ type: "places", names: ["Gold Axe", "Silver Hatchet"] }),
          award(
            { type: "top-percent", percent: 25 },
            { id: "0196cfa2-4c00-7000-8000-000000000031", slug: "top-25" },
          ),
          award(
            { type: "manual" },
            { id: "0196cfa2-4c00-7000-8000-000000000032", slug: "spirit" },
          ),
        ),
      );
      expect(parsed.awards?.map((a) => [a.rule.type, a.scope])).toEqual([
        ["places", "event"],
        ["top-percent", "event"],
        ["manual", "event"],
      ]);
    });

    it("keeps division scope in the schema (ADR-0007)", () => {
      expect(
        EventSchema.safeParse(
          withAwards(award({ type: "manual" }, { scope: "division" })),
        ).success,
      ).toBe(true);
    });

    it("rejects an Award whose Competition isn't in this Event", () => {
      expect(
        issuesOf(
          EventSchema,
          withAwards(
            award(
              { type: "manual" },
              { competitionId: "0196cfa2-4c00-7000-8000-000000000099" },
            ),
          ),
        ),
      ).toContain(
        "awards.0.competitionId: no Competition with this id in the Event",
      );
    });

    it("rejects duplicate Award ids", () => {
      expect(
        issuesOf(
          EventSchema,
          withAwards(award({ type: "manual" }), award({ type: "manual" })),
        ).some((i) => i.includes("duplicate award id")),
      ).toBe(true);
    });

    it("needs at least one place name and a percent above 0 and at most 100", () => {
      for (const rule of [
        { type: "places", names: [] },
        { type: "top-percent", percent: 0 },
        { type: "top-percent", percent: 101 },
      ]) {
        expect(EventSchema.safeParse(withAwards(award(rule))).success).toBe(
          false,
        );
      }
    });
  });

  describe("Program Guide settings (#5)", () => {
    const withCompetitionGuide = (programGuide: unknown) => {
      const event = validEvent();
      return {
        ...event,
        competitions: [{ ...event.competitions[0], programGuide }],
      };
    };

    it("leaves both settings out by default, so stored documents don't change", () => {
      const parsed = EventSchema.parse(validEvent());
      expect(parsed).not.toHaveProperty("programGuide");
      expect(parsed.competitions[0]).not.toHaveProperty("programGuide");
    });

    it("accepts a per-Competition choice to list Activities or not", () => {
      for (const listActivities of [true, false]) {
        expect(
          EventSchema.parse(withCompetitionGuide({ listActivities }))
            .competitions[0]?.programGuide,
        ).toEqual({ listActivities });
      }
    });

    it("rejects a non-boolean or unknown Competition guide setting", () => {
      expect(
        issuesOf(EventSchema, withCompetitionGuide({ listActivities: "no" })),
      ).toContain(
        "competitions.0.programGuide.listActivities: Invalid input: expected boolean, received string",
      );
      expect(
        issuesOf(
          EventSchema,
          withCompetitionGuide({ listActivities: true, teaser: "story" }),
        ),
      ).toContain('competitions.0.programGuide: Unrecognized key: "teaser"');
    });

    it("accepts an authored skills list on the Event", () => {
      const skills = ["Fire starting", "First aid", "Lashings"];
      expect(
        EventSchema.parse({ ...validEvent(), programGuide: { skills } })
          .programGuide,
      ).toEqual({ skills });
    });

    it("rejects a blank skill", () => {
      expect(
        issuesOf(EventSchema, {
          ...validEvent(),
          programGuide: { skills: ["First aid", ""] },
        }),
      ).toEqual([expect.stringMatching(/^programGuide\.skills\.1: /)]);
    });
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

  it("takes `enabled` on an Activity entry; left out means enabled, with no default added (ADR-0029 item 9)", () => {
    const event = validEvent();
    const entry = event.activities[0] as Event["activities"][number];
    const disabled = { ...event, activities: [{ ...entry, enabled: false }] };
    expect(EventSchema.parse(disabled)).toEqual(disabled);
    expect(EventSchema.parse(event).activities[0]).not.toHaveProperty(
      "enabled",
    );
    expect(isActivityEnabled(entry)).toBe(true);
    expect(isActivityEnabled({ ...entry, enabled: true })).toBe(true);
    expect(isActivityEnabled({ ...entry, enabled: false })).toBe(false);
    expect(
      issuesOf(EventSchema, {
        ...event,
        activities: [{ ...entry, enabled: "no" }],
      }),
    ).toContain(
      "activities.0.enabled: Invalid input: expected boolean, received string",
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

describe("venue, introduction and contacts (ADR-0029 item 8)", () => {
  it("takes them as plain Event fields, empty strings allowed (v1 had them empty)", () => {
    const event = {
      ...validEvent(),
      venue: { name: "Camp Chesebrough", address: "" },
      introduction: "Welcome to the **Circus**!",
      contacts: [
        {
          role: "Camporee Director",
          name: "Pat Example",
          email: "pat@example.com",
          phone: "",
        },
      ],
    };
    expect(issuesOf(EventSchema, event)).toEqual([]);
    // Stored as given: nothing added.
    expect(EventSchema.parse(event).contacts).toEqual(event.contacts);
  });

  it("leaves them out by default, with nothing added", () => {
    const parsed = EventSchema.parse(validEvent());
    expect(parsed).not.toHaveProperty("venue");
    expect(parsed).not.toHaveProperty("introduction");
    expect(parsed).not.toHaveProperty("contacts");
  });

  it("rejects a contact or venue with a missing or extra field", () => {
    expect(
      issuesOf(EventSchema, {
        ...validEvent(),
        venue: { name: "Camp" },
        contacts: [
          { role: "Director", name: "Pat", email: "", phone: "", age: 9 },
        ],
      }),
    ).toEqual([
      "venue.address: Invalid input: expected string, received undefined",
      'contacts.0: Unrecognized key: "age"',
    ]);
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

  it("has no contacts: personal data never goes into a Template (ADR-0031 rule 4)", () => {
    const template = {
      ...validEvent(),
      kind: "template",
      contacts: [{ role: "Director", name: "Pat", email: "", phone: "" }],
    };
    expect(issuesOf(TemplateSchema, template)).toEqual([
      'Unrecognized key: "contacts"',
    ]);
    expect(
      TemplateSchema.safeParse({
        ...validEvent(),
        kind: "template",
        venue: { name: "Camp", address: "" },
        introduction: "Welcome",
      }).success,
    ).toBe(true);
  });

  it("applies the same cross-checks as an Event", () => {
    const template = { ...validEvent(), kind: "template", competitions: [] };
    expect(issuesOf(TemplateSchema, template)).toContain(
      "activities.0.competitionId: no Competition with this id in the Event",
    );
  });
});
