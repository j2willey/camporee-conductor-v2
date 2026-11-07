import type { JudgeActivity } from "@camporee-conductor/collator/types";
import { describe, expect, it } from "vitest";
import { competitionTabs, shownTab } from "./activity-tabs.ts";

// #41 PR 5: the Activity list shows one Competition at a time (Patrol Games in the morning, Troop
// Challenges in the afternoon), and the phone remembers which.

const activity = (id: string, competitionId: string, label: string) =>
  ({
    id,
    title: id,
    competition: { id: competitionId, label, level: "team" },
    fields: [],
  }) as unknown as JudgeActivity;

const activities = [
  activity("clown-car", "games", "Patrol Games"),
  activity("high-wire", "challenges", "Troop Challenges"),
  activity("juggling", "games", "Patrol Games"),
  activity("unicycle", "exhibitions", "Exhibition Events"),
];

describe("competitionTabs", () => {
  const competitions = [
    { id: "games", label: "Patrol Games", level: "team" as const },
    { id: "exhibitions", label: "Exhibition Events", level: "team" as const },
    { id: "empty", label: "Nothing here", level: "team" as const },
    { id: "challenges", label: "Troop Challenges", level: "group" as const },
  ];

  it("is one tab per Competition with Activities, in the event's Competition order, with how many each", () => {
    expect(competitionTabs(activities, competitions)).toEqual([
      { id: "games", label: "Patrol Games", count: 2 },
      { id: "exhibitions", label: "Exhibition Events", count: 1 },
      { id: "challenges", label: "Troop Challenges", count: 1 },
    ]);
  });

  it("follows the Activities' order when the event kept on the phone predates the Competition list", () => {
    expect(competitionTabs(activities, undefined).map((t) => t.id)).toEqual([
      "games",
      "challenges",
      "exhibitions",
    ]);
  });
});

describe("shownTab", () => {
  const tabs = competitionTabs(activities, undefined);

  it("is the one the phone remembers", () => {
    expect(shownTab(tabs, "challenges")).toBe("challenges");
  });

  it("is the first when nothing is remembered, or the remembered one isn't in this event", () => {
    expect(shownTab(tabs, null)).toBe("games");
    expect(shownTab(tabs, "gone")).toBe("games");
  });

  it("is none for an event with no Activities", () => {
    expect(shownTab([], "games")).toBeUndefined();
  });
});
