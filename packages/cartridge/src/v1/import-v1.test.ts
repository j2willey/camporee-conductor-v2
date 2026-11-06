import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import {
  defaultV1ImportOptions,
  importV1Cartridge,
  V1ImportError,
  type V1ImportOptions,
} from "./import-v1.ts";
import type { V1Camporee, V1Cartridge, V1Game, V1Input } from "./types.ts";

// A small made-up v1 event, in the shapes v1's own code writes (src/servers/composer.js save,
// public/js/apps/composer.js exportCamporee).

const style = { font: "Georgia, serif", size: "10pt", bold: true };

const camporee = (): V1Camporee => ({
  schemaVersion: "3.0",
  meta: {
    title: "Spring Field Day 2027",
    theme: "Under the Sea",
    year: 2027,
    director: "Pat Organizer",
    camporeeId: "5d5a6a80-c9e1-4551-8e15-000000000001",
    theme_colors: { main: "#112233", header: "#445566", accent: "#778899" },
    awards_config: {
      line1: "Field Day 2027",
      line2: "Under the Sea",
      sync: true,
      styles: { "1": style, "2": style, "3": style, "4": style },
    },
  },
  terminology: {
    unit: "Club",
    subunit: "Squad",
    member: "Student",
    event: "Field Day",
    organizer: "Director",
  },
  leagues: [
    {
      id: "squad-games",
      label: "Squad Games",
      tier: "subunit",
      registration: "registered",
    },
    {
      id: "club-challenges",
      label: "Club Challenges",
      tier: "unit",
      registration: "registered",
    },
    {
      id: "exhibition",
      label: "Exhibitions",
      tier: "subunit",
      registration: "open",
    },
  ],
  type_defaults: {
    "squad-games": { prefix: ["p_yell", "off_score"], suffix: ["off_notes"] },
    "club-challenges": { prefix: ["final_rank"], suffix: ["overall_points"] },
    exhibition: { prefix: [], suffix: [] },
  },
  playlist: [
    { gameId: "relay", order: 1 },
    { gameId: "archery", order: 2 },
    { gameId: "tug", order: 3 },
  ],
  officials: [],
  sessions: [],
  rosters: { units: [], subunits: [], individuals: [] },
});

const presets = (): V1Input[] => [
  {
    id: "p_yell",
    label: "Squad Yell",
    type: "number",
    kind: "points",
    audience: "judge",
    sortOrder: 10,
    weight: 5,
    config: { min: 0, max: 5, placeholder: "0-5 Points" },
    tier: "subunit",
    position: "prefix",
  },
  {
    id: "off_notes",
    label: "Official notes on {{station_name}}",
    type: "textarea",
    kind: "info",
    audience: "admin",
    sortOrder: 90,
    weight: 0,
    tier: "subunit",
    position: "suffix",
  },
  ...["off_score", "final_rank", "overall_points", "bracket_result"].map(
    (id): V1Input => ({
      id,
      label: id,
      type: "number",
      kind: "points",
      audience: "admin",
      weight: 1,
    }),
  ),
];

const relay = (): V1Game => ({
  id: "relay",
  league: "squad-games",
  library_uuid: "lib-relay",
  library_title: "Relay (library)",
  variables: { station_name: "Relay" },
  content: {
    title: "The Relay ",
    story: "Once upon a tide.",
    challenge: "Run the relay.",
    description: "Each runner carries the shell.",
    rules: ["No pushing.", "", "  Stay in lane.  "],
    time_and_scoring: "Fastest time wins.",
    setup: "Cones.",
    reset: "Reset cones.",
    staffing: "1 judge.",
    supplies_text:
      "CONES:\nOrange cone: 10\n  (spares in the shed)\nStopwatch: 1\nWhistle",
    notes: "",
    instructions: "Line up.",
    scoring_notes: "  ",
    tags: ["#running"],
  },
  scoring_model: {
    method: "timed_asc",
    inputs: [
      {
        id: "elapsed_time",
        label: "Time",
        type: "stopwatch",
        kind: "metric",
        audience: "judge",
        sortOrder: 10,
        weight: 10,
      },
      {
        id: "field_1778195167953 ",
        label: "Dropped the shell",
        type: "number",
        kind: "penalty",
        audience: "judge",
        weight: 0.5,
        required: true,
        config: { defaultValue: false },
      },
    ],
  },
  bracketMode: false,
  match_label: "",
  session: null,
  sortOrder: 10,
});

const archery = (): V1Game => ({
  id: "archery",
  league: "exhibition",
  content: {
    title: "Archery",
    story: "Aim true.",
    challenge: "Hit the target.",
    description: "Three arrows.",
    rules: [],
    time_and_scoring: "Not scored.",
  },
  scoring_model: { method: "points_desc", inputs: [] },
});

const tug = (): V1Game => ({
  id: "tug",
  league: "club-challenges",
  content: {
    title: "Tug of War",
    story: "Pull.",
    challenge: "Pull harder.",
    description: "Rope.",
    rules: ["Gloves on."],
    time_and_scoring: "Last one standing.",
  },
  scoring_model: {
    method: "points_desc",
    inputs: [
      {
        id: "pulls_won",
        label: "Pulls won",
        type: "number",
        kind: "points",
        audience: "judge",
        sortOrder: 10,
        weight: 1,
      },
    ],
  },
});

const cartridge = (changes: Partial<V1Cartridge> = {}): V1Cartridge => ({
  camporee: camporee(),
  presets: presets(),
  games: [relay(), archery(), tug()],
  ...changes,
});

const options = (): V1ImportOptions => defaultV1ImportOptions(camporee().meta);

const run = (changes: Partial<V1Cartridge> = {}) =>
  importV1Cartridge(cartridge(changes), options());

const activity = (slug: string) => {
  const found = run().activities.find((a) => a.slug === slug);
  if (!found) throw new Error(`no activity ${slug}`);
  return found;
};

describe("importV1Cartridge: documents", () => {
  it("gives an Event, a Common Field set and one Activity per playlist game, all valid v2 documents", () => {
    const result = run();
    expect(EventSchema.safeParse(result.event).success).toBe(true);
    expect(CommonFieldSetSchema.safeParse(result.commonFieldSet).success).toBe(
      true,
    );
    expect(
      result.activities.map((a) => ActivitySchema.safeParse(a).success),
    ).toEqual([true, true, true]);
    expect(result.activities.map((a) => a.slug)).toEqual([
      "archery",
      "relay",
      "tug",
    ]);
  });

  it("derives stable ids: the same cartridge gets the same ids, another namespace gets others", () => {
    const ids = (r: ReturnType<typeof run>) => [
      r.event.id,
      r.commonFieldSet.id,
      ...r.activities.map((a) => a.id),
    ];
    expect(ids(run())).toEqual(ids(run()));
    const elsewhere = importV1Cartridge(cartridge(), {
      ...options(),
      idNamespace: "another-org",
    });
    expect(ids(elsewhere).filter((id) => ids(run()).includes(id))).toEqual([]);
  });

  it("defaults the namespace, slugs and set title from the v1 event", () => {
    expect(options()).toEqual({
      idNamespace: "v1:5d5a6a80-c9e1-4551-8e15-000000000001",
      idTimestamp: Date.UTC(2027, 0, 1),
      eventSlug: "spring-field-day-2027",
      commonFieldSet: {
        slug: "spring-field-day-2027-common-fields",
        title: "Spring Field Day 2027 Common Fields",
      },
    });
    const { event, commonFieldSet } = run();
    expect([event.slug, commonFieldSet.slug, commonFieldSet.title]).toEqual([
      "spring-field-day-2027",
      "spring-field-day-2027-common-fields",
      "Spring Field Day 2027 Common Fields",
    ]);
  });
});

describe("importV1Cartridge: the Event", () => {
  it("maps meta, terminology, presentation and v1's dense tie numbering", () => {
    const { event } = run();
    expect(event).toMatchObject({
      kind: "event",
      title: "Spring Field Day 2027",
      theme: "Under the Sea",
      year: 2027,
      organizerName: "Pat Organizer",
      terminology: {
        pack: "scouting",
        labels: {
          group: "Club",
          team: "Squad",
          participant: "Student",
          event: "Field Day",
        },
      },
      presentation: {
        themeColors: { main: "#112233", header: "#445566", accent: "#778899" },
        awardLabel: {
          line1: "Field Day 2027",
          line2: "Under the Sea",
          syncFonts: true,
          styles: {
            line1: style,
            line2: style,
            activityName: style,
            winner: style,
          },
        },
      },
      tieNumbering: "dense",
      legacy: { v1Id: "5d5a6a80-c9e1-4551-8e15-000000000001" },
    });
    expect(event).not.toHaveProperty("awards");
  });

  it("maps leagues to Competitions: unit → group, subunit → team", () => {
    expect(
      run().event.competitions.map(({ slug, label, level, registration }) => ({
        slug,
        label,
        level,
        registration,
      })),
    ).toEqual([
      {
        slug: "squad-games",
        label: "Squad Games",
        level: "team",
        registration: "registered",
      },
      {
        slug: "club-challenges",
        label: "Club Challenges",
        level: "group",
        registration: "registered",
      },
      {
        slug: "exhibition",
        label: "Exhibitions",
        level: "team",
        registration: "open",
      },
    ]);
  });

  it("applies Common Fields per Competition, without the dropped Official presets", () => {
    const { event, commonFieldSet } = run();
    const [squad, club, exhibition] = event.competitions;
    expect(squad?.commonFields).toEqual({
      setId: commonFieldSet.id,
      before: ["p_yell"],
      after: ["off_notes"],
    });
    // Only final_rank and overall_points: both dropped, so no Common Fields at all.
    expect(club).not.toHaveProperty("commonFields");
    expect(exhibition).not.toHaveProperty("commonFields");
  });

  it("lists Activities in playlist order, under their league's Competition", () => {
    const { event, activities } = run();
    const slugById = new Map(activities.map((a) => [a.id, a.slug]));
    const competitionSlug = new Map(
      event.competitions.map((c) => [c.id, c.slug]),
    );
    expect(
      event.activities.map((e) => [
        e.sortOrder,
        slugById.get(e.activityId),
        competitionSlug.get(e.competitionId),
      ]),
    ).toEqual([
      [1, "relay", "squad-games"],
      [2, "archery", "exhibition"],
      [3, "tug", "club-challenges"],
    ]);
  });

  it("leaves out a game the playlist disables, as v1's Collator did, as info, not a skip", () => {
    const disabled = camporee();
    disabled.playlist = [
      { gameId: "relay", order: 1, enabled: true },
      { gameId: "archery", order: 2, enabled: false },
      { gameId: "tug", order: 3 },
    ];
    const result = run({ camporee: disabled });
    expect(result.activities.map((a) => a.slug)).toEqual(["relay", "tug"]);
    expect(result.event.activities.map((e) => e.sortOrder)).toEqual([1, 3]);
    expect(result.skipped).toEqual([]);
    expect(result.notes).toContain(
      "Left out 1 game the v1 playlist disables: archery.",
    );
  });

  it("leaves out a game file the playlist doesn't list, as info", () => {
    const shortList = camporee();
    shortList.playlist = shortList.playlist.filter((e) => e.gameId !== "tug");
    const result = run({ camporee: shortList });
    expect(result.skipped).toEqual([]);
    expect(result.notes).toContain(
      "Left out 1 game file not in the v1 playlist: tug.",
    );
  });
});

describe("importV1Cartridge: Activities", () => {
  it("maps content, renaming v1's challenge and time_and_scoring", () => {
    const a = activity("relay");
    expect(a.title).toBe("The Relay ");
    expect(a.scoringType).toBe("ranked");
    expect(a.content).toMatchObject({
      story: "Once upon a tide.",
      objective: "Run the relay.",
      description: "Each runner carries the shell.",
      timeAndScoring: "Fastest time wins.",
      setup: "Cones.",
      reset: "Reset cones.",
      staffing: "1 judge.",
      notes: "",
    });
    expect(a.variables).toEqual({ station_name: "Relay" });
    expect(a.tags).toEqual(["#running"]);
  });

  it("trims rules and drops empty ones", () => {
    expect(activity("relay").content.rules).toEqual([
      "No pushing.",
      "Stay in lane.",
    ]);
  });

  it("keeps only non-empty instructions, scoring notes and references, as custom sections", () => {
    expect(activity("relay").content.customSections).toEqual([
      { title: "Instructions", body: "Line up." },
    ]);
    expect(activity("archery").content).not.toHaveProperty("customSections");
  });

  it("turns v1's free-text supplies into items with groups and quantities", () => {
    expect(activity("relay").content.supplies).toEqual([
      {
        group: "CONES",
        item: "Orange cone (spares in the shed)",
        quantity: "10",
      },
      { group: "CONES", item: "Stopwatch", quantity: "1" },
      { group: "CONES", item: "Whistle" },
    ]);
    expect(activity("archery").content.supplies).toEqual([]);
  });

  it("makes exhibition-league games exhibition Activities, the rest ranked", () => {
    expect(run().activities.map((a) => [a.slug, a.scoringType])).toEqual([
      ["archery", "exhibition"],
      ["relay", "ranked"],
      ["tug", "ranked"],
    ]);
  });

  it("records v1 ids, scoring method and library origin in legacy, library only when present (the zip has none)", () => {
    expect(activity("relay").legacy).toEqual({
      v1Id: "relay",
      v1ScoringMethod: "timed_asc",
      v1LibraryUuid: "lib-relay",
      v1LibraryTitle: "Relay (library)",
    });
    expect(activity("archery").legacy).toEqual({
      v1Id: "archery",
      v1ScoringMethod: "points_desc",
    });
  });
});

describe("importV1Cartridge: scoring fields", () => {
  const fields = () => activity("relay").scoring.fields;

  it("trims ids, numbers a missing sortOrder by position, and turns a boolean default into a number", () => {
    expect(fields()[1]).toEqual({
      id: "field_1778195167953",
      label: "Dropped the shell",
      type: "number",
      kind: "penalty",
      audience: "judge",
      sortOrder: 20,
      weight: 1,
      required: true,
      config: { defaultValue: 0 },
      legacy: { v1Weight: 0.5 },
    });
  });

  it("sets weight 1 and keeps v1's weight in legacy: v1 never applied weight", () => {
    expect(fields().map((f) => [f.weight, f.legacy?.v1Weight])).toEqual([
      [1, 10],
      [1, 0.5],
    ]);
  });

  it("maps the Common Fields, renaming audience admin → official", () => {
    expect(
      run().commonFieldSet.fields.map((f) => [f.id, f.audience, f.weight]),
    ).toEqual([
      ["p_yell", "judge", 1],
      ["off_notes", "official", 1],
    ]);
  });
});

describe("importV1Cartridge: refusals", () => {
  const refusal = (changes: Partial<V1Cartridge>): string[] => {
    try {
      run(changes);
    } catch (e) {
      if (e instanceof V1ImportError) return e.issues;
      throw e;
    }
    throw new Error("expected the import to be refused");
  };

  it("refuses a bracket-mode game: v2 has no bracket mode", () => {
    const bracket = tug();
    bracket.bracketMode = true;
    expect(refusal({ games: [relay(), archery(), bracket] })).toEqual([
      "game tug: bracket mode isn't supported in v2; turn it off in v1's Composer",
    ]);
  });

  it("refuses a playlist game with no game file, and a game in an unknown league", () => {
    expect(refusal({ games: [relay(), archery()] })).toEqual([
      "playlist: no game file for tug",
    ]);
    const lost = tug();
    lost.league = "nowhere";
    expect(refusal({ games: [relay(), archery(), lost] })).toEqual([
      "game tug: league \"nowhere\" isn't one of the cartridge's leagues",
    ]);
  });
});

describe("importV1Cartridge: unfinished games (designs change until about April)", () => {
  const unfinished = () => {
    const game = tug();
    game.scoring_model.inputs = [];
    return game;
  };

  it("skips a game that isn't a valid Activity yet, with the reason, and imports the rest", () => {
    const result = run({ games: [relay(), archery(), unfinished()] });
    expect(result.activities.map((a) => a.slug)).toEqual(["archery", "relay"]);
    expect(result.event.activities.map((e) => e.sortOrder)).toEqual([1, 2]);
    expect(result.skipped).toEqual([
      {
        game: "tug",
        reason:
          "unfinished: scoring.fields: a ranked Activity needs at least one scoring field",
      },
    ]);
  });

  it("refuses instead when strict, listing every unfinished game, but not disabled ones (for the final pre-event import)", () => {
    const disabled = camporee();
    disabled.playlist = disabled.playlist.map((e) =>
      e.gameId === "archery" ? { ...e, enabled: false } : e,
    );
    expect(() =>
      importV1Cartridge(
        cartridge({
          camporee: disabled,
          games: [relay(), archery(), unfinished()],
        }),
        options(),
        { strict: true },
      ),
    ).toThrow(
      expect.objectContaining({
        issues: [
          "strict: tug would be skipped (unfinished: scoring.fields: a ranked Activity needs at least one scoring field)",
        ],
      }),
    );
    expect(
      importV1Cartridge(cartridge({ camporee: disabled }), options(), {
        strict: true,
      }).skipped,
    ).toEqual([]);
  });
});

describe("importV1Cartridge: notes on what didn't come across", () => {
  it("carries the v1 Officials into an Officials document for the event-day cartridge (ADR-0027 item 5)", () => {
    const withOfficials = camporee();
    withOfficials.officials = [
      {
        user_id: "user_1",
        display_name: "Ann Director",
        email: "ann@example.com",
        role: "director",
      },
      {
        user_id: "user_2",
        display_name: null,
        email: "bob@example.com",
        role: "official",
      },
    ];
    const result = run({ camporee: withOfficials });
    expect(result.officials).toEqual({
      schemaVersion: "4.0",
      kind: "officials",
      id: expect.any(String),
      slug: "spring-field-day-2027-officials",
      title: "Spring Field Day 2027 Officials",
      eventId: result.event.id,
      officials: [
        { email: "ann@example.com", name: "Ann Director", role: "director" },
        { email: "bob@example.com", role: "official" },
      ],
    });
    expect(result.notes).toEqual([]);
  });

  it("leaves out an Official with no email, saying how many but not who", () => {
    const withOfficials = camporee();
    withOfficials.officials = [
      {
        user_id: "user_1",
        display_name: "Ann",
        email: "ann@example.com",
        role: "director",
      },
      {
        user_id: "user_2",
        display_name: "No Email",
        email: null,
        role: "official",
      },
    ];
    const result = run({ camporee: withOfficials });
    expect(result.officials?.officials.map((o) => o.email)).toEqual([
      "ann@example.com",
    ]);
    expect(result.notes).toEqual([
      "Left out 1 Official with no valid email: they can't sign in on the Collator.",
    ]);
    expect(result.notes.join("\n")).not.toContain("No Email");
  });

  it("merges an Official listed twice, keeping Director", () => {
    const withOfficials = camporee();
    withOfficials.officials = [
      { email: "ann@example.com", role: "official" },
      { email: "Ann@Example.com", role: "director" },
    ];
    expect(run({ camporee: withOfficials }).officials?.officials).toEqual([
      { email: "ann@example.com", role: "director" },
    ]);
  });

  it("makes no Officials document when the v1 cartridge lists none", () => {
    expect(run().officials).toBeUndefined();
  });

  it("notes assets it can't import yet (#7)", () => {
    expect(run({ assetNames: ["map.png", "logo.svg"] }).notes).toContain(
      "Skipped 2 assets: v2 has no asset import yet (#7).",
    );
  });

  it("notes a Common Field label that uses a variable the Competition's Activities don't define", () => {
    expect(run().notes).toEqual([]);
    const withoutVariable = relay();
    delete withoutVariable.variables;
    expect(run({ games: [withoutVariable, archery(), tug()] }).notes).toEqual([
      "Common Field off_notes uses {{station_name}}, which 1 Activity in Squad Games doesn't define: relay.",
    ]);
  });
});
