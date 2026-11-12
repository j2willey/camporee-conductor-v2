import { EventSchema, type Event } from "@camporee-conductor/schema";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addAward,
  addCompetition,
  addDivision,
  moveCompetition,
  newUuid7,
  removeCompetition,
  setRuleType,
  slugify,
} from "./competitions.ts";

const circus = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/schema/fixtures/circus-2026/event.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Event;
const valid = (event: Event) => EventSchema.safeParse(event).success;

describe("ids and slugs", () => {
  it("makes UUID v7s, time first", () => {
    const id = newUuid7(new Date("2026-11-12T10:00:00Z"));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(id.slice(0, 8)).toBe(
      Date.parse("2026-11-12T10:00:00Z")
        .toString(16)
        .padStart(12, "0")
        .slice(0, 8),
    );
  });
  it("slugifies a label", () => {
    expect(slugify("Troop Challenges!")).toBe("troop-challenges");
    expect(slugify("  ")).toBe("item");
  });
});

describe("Competitions", () => {
  it("adds a valid Competition last, with a slug nobody has", () => {
    const added = addCompetition(circus, "Patrol Games");
    expect(valid(added)).toBe(true);
    expect(added.competitions.at(-1)).toMatchObject({
      slug: "patrol-games-2",
      label: "Patrol Games",
      level: "team",
      registration: "registered",
      divisions: [],
    });
  });

  it("moves a Competition up or down", () => {
    const moved = moveCompetition(circus, 1, -1);
    expect(moved.competitions.map((c) => c.slug)).toEqual([
      "exhibition",
      "patrol-games",
      "troop-challenges",
    ]);
  });

  it("won't remove a Competition that has Activities", () => {
    const result = removeCompetition(circus, circus.competitions[0]?.id ?? "");
    expect(result).toEqual({
      ok: false,
      problem: expect.stringMatching(/18 Activities/),
    });
  });

  it("removes an empty Competition and its Awards", () => {
    const withEmpty = addCompetition(circus, "Spare");
    const spare = withEmpty.competitions.at(-1)?.id ?? "";
    const withAward = addAward(withEmpty, spare);
    const result = removeCompetition(withAward, spare);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.competitions.map((c) => c.id)).not.toContain(spare);
    expect(result.event.awards).toEqual(circus.awards);
    expect(valid(result.event)).toBe(true);
  });
});

describe("Divisions and Awards", () => {
  it("adds a Division with an id and a free slug", () => {
    const once = addDivision(circus, 0);
    const twice = addDivision(once, 0);
    expect(twice.competitions[0]?.divisions.map((d) => d.slug)).toEqual([
      "division-1",
      "division-2",
    ]);
    expect(valid(twice)).toBe(true);
  });

  it("adds a valid Award for a Competition: the top three places", () => {
    const added = addAward(circus, circus.competitions[2]?.id ?? "");
    expect(valid(added)).toBe(true);
    expect(added.awards?.at(-1)).toMatchObject({
      label: "New award",
      scope: "event",
      rule: { type: "places", names: ["1st", "2nd", "3rd"] },
    });
  });

  it("switches an Award's rule with a sensible start for each type", () => {
    expect(setRuleType({ type: "manual" }, "places")).toEqual({
      type: "places",
      names: ["1st", "2nd", "3rd"],
    });
    expect(setRuleType({ type: "manual" }, "top-percent")).toEqual({
      type: "top-percent",
      percent: 25,
    });
    const places = { type: "places" as const, names: ["Gold"] };
    expect(setRuleType(places, "places")).toBe(places);
  });
});
