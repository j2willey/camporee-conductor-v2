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
