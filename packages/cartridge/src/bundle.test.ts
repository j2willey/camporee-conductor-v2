import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkEventBundle, type EventBundle } from "./bundle.ts";

// The Circus 2026 design fixture, read as an Event bundle (event + Common Field set + Activities).
const FIXTURE = new URL("../../schema/fixtures/circus-2026/", import.meta.url);
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));
const circus = (): EventBundle => ({
  event: read("event.json"),
  commonFieldSets: [read("common-fields.json")],
  activities: readdirSync(new URL("activities/", FIXTURE))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => read(`activities/${f}`)),
});

const issues = (bundle: EventBundle): string[] => {
  const result = checkEventBundle(bundle);
  return result.ok ? [] : result.issues;
};

describe("checkEventBundle: one set of rules for Composer import and Collator load", () => {
  it("accepts the Circus 2026 design and returns the parsed documents", () => {
    const result = checkEventBundle(circus());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.event.slug).toBe("coyote-creek-camporee-2026");
    expect(result.bundle.activities).toHaveLength(33);
    expect(result.bundle.commonFieldSets).toHaveLength(1);
  });

  it("names every invalid document and what's wrong with it", () => {
    const bundle = circus();
    const [first] = bundle.activities as { slug: string; title?: string }[];
    if (first) delete first.title;
    expect(issues(bundle)).toEqual([
      "activity 3-ring-circus: title: Invalid input: expected string, received undefined",
    ]);
  });

  it("rejects an Event that lists an Activity the bundle doesn't have", () => {
    const bundle = circus();
    const removed = bundle.activities.shift() as { id: string };
    expect(issues(bundle)).toEqual([
      `event coyote-creek-camporee-2026: activities: no Activity ${removed.id} in the bundle`,
    ]);
  });

  it("rejects an Activity the Event doesn't list", () => {
    const bundle = circus();
    const event = bundle.event as { activities: { activityId: string }[] };
    const [first] = bundle.activities as { id: string; slug: string }[];
    event.activities = event.activities.filter(
      (a) => a.activityId !== first?.id,
    );
    expect(issues(bundle)).toEqual([
      "activity 3-ring-circus: not listed in the Event",
    ]);
  });

  it("rejects a Common Field set the bundle doesn't have", () => {
    const bundle = circus();
    bundle.commonFieldSets = [];
    expect(issues(bundle)).toEqual([
      expect.stringMatching(
        /^event coyote-creek-camporee-2026: competitions\.0\.commonFields\.setId: no Common Field set .+ in the bundle$/,
      ),
    ]);
  });

  describe("Common Fields (ADR-0020): applied at runtime, so they must resolve", () => {
    interface Fields {
      setId: string;
      before: string[];
      after: string[];
    }
    interface Bundle {
      event: {
        competitions: { id: string; commonFields?: Fields }[];
        activities: { activityId: string; competitionId: string }[];
      };
      commonFieldSets: { id: string; slug: string }[];
      activities: {
        id: string;
        slug: string;
        scoring: { fields: { id: string }[] };
      }[];
    }
    const bundle = () => circus() as unknown as Bundle;
    const check = (b: Bundle) => issues(b as unknown as EventBundle);
    const patrolGames = (b: Bundle): Fields => {
      const fields = b.event.competitions[0]?.commonFields;
      if (!fields) throw new Error("fixture changed");
      return fields;
    };
    /** The first Activity of Patrol Games, with one more field, given this id. */
    const addFieldTo = (b: Bundle, id: string) => {
      const competitionId = b.event.competitions[0]?.id;
      const entry = b.event.activities.find(
        (a) => a.competitionId === competitionId,
      );
      const activity = b.activities.find((a) => a.id === entry?.activityId);
      const [first] = activity?.scoring.fields ?? [];
      if (!activity || !first) throw new Error("fixture changed");
      activity.scoring.fields.push({ ...first, id });
      return activity;
    };

    it("rejects a before or after id the set doesn't have", () => {
      const b = bundle();
      patrolGames(b).before.push("no_such");
      patrolGames(b).after.unshift("nor_this");
      expect(check(b)).toEqual([
        "event coyote-creek-camporee-2026: competitions.0.commonFields.before.4: the Common Field set has no field no_such",
        "event coyote-creek-camporee-2026: competitions.0.commonFields.after.0: the Common Field set has no field nor_this",
      ]);
    });

    it("rejects a Common Field listed twice in one Competition", () => {
      const b = bundle();
      patrolGames(b).after.push("p_flag");
      expect(check(b)).toEqual([
        "event coyote-creek-camporee-2026: competitions.0.commonFields.after.2: p_flag is listed twice",
      ]);
    });

    it("rejects Competitions that use different sets: a cartridge holds one (until more are needed)", () => {
      const b = bundle();
      const [set] = b.commonFieldSets;
      const second = b.event.competitions[1];
      if (!set || !second) throw new Error("fixture changed");
      const other = {
        ...set,
        id: "0196cfa2-4c00-7000-8000-000000000301",
        slug: "other-common-fields",
      };
      b.commonFieldSets.push(other);
      second.commonFields = { setId: other.id, before: ["p_flag"], after: [] };
      expect(check(b)).toEqual([
        `event coyote-creek-camporee-2026: competitions.1.commonFields.setId: every Competition must use the same Common Field set (${set.id})`,
      ]);
    });

    it("rejects an Activity holding a field with an applied Common Field's id: no Activity contains a Common Field", () => {
      const b = bundle();
      const activity = addFieldTo(b, "unscout");
      expect(check(b)).toEqual([
        `activity ${activity.slug}: scoring.fields.${activity.scoring.fields.length - 1}.id: unscout is a Common Field of patrol-games, applied at runtime; it can't be an Activity field too`,
      ]);
    });

    it("allows that id when the Activity's Competition doesn't apply that Common Field", () => {
      const b = bundle();
      patrolGames(b).after = [];
      addFieldTo(b, "unscout");
      expect(check(b)).toEqual([]);
    });
  });

  describe("Officials (event-day only, ADR-0027 item 5)", () => {
    const officials = (eventId: string) => ({
      schemaVersion: "4.0",
      kind: "officials",
      id: "0196cfa2-4c00-7000-8000-000000000200",
      slug: "circus-officials",
      title: "Circus Officials",
      eventId,
      officials: [{ email: "director@example.com", role: "director" }],
    });
    const eventId = () => (circus().event as { id: string }).id;

    it("accepts an Officials document for this Event", () => {
      const result = checkEventBundle({
        ...circus(),
        officials: officials(eventId()),
      });
      expect(result.ok && result.bundle.officials?.officials).toEqual([
        { email: "director@example.com", role: "director" },
      ]);
    });

    it("rejects Officials of another Event, and an invalid Officials document", () => {
      expect(
        issues({
          ...circus(),
          officials: officials("0196cfa2-4c00-7000-8000-00000000ffff"),
        }),
      ).toEqual([
        "officials circus-officials: eventId: not this Event (coyote-creek-camporee-2026)",
      ]);
      expect(
        issues({
          ...circus(),
          officials: { ...officials(eventId()), officials: [{ email: "x" }] },
        }),
      ).toEqual([
        "officials circus-officials: officials.0.email: Invalid email address",
        'officials circus-officials: officials.0.role: Invalid option: expected one of "director"|"official"',
      ]);
    });
  });

  it("checks documents as given: no defaults are added to what it returns as raw", () => {
    const bundle = circus();
    const result = checkEventBundle(bundle);
    if (!result.ok) throw new Error("expected ok");
    expect(result.raw.event).toBe(bundle.event);
  });
});
