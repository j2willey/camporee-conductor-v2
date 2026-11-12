import type { Event } from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_COLORS,
  setDate,
  setLabel,
  setYear,
} from "./event-details.ts";

const event = {
  title: "Camporee",
  year: 2026,
  startDate: "2026-05-15",
  terminology: { pack: "scouting", labels: { team: "Patrol", group: "Troop" } },
} as Event;

describe("event details", () => {
  it("has v1's default theme colors", () => {
    expect(DEFAULT_THEME_COLORS).toEqual({
      main: "#0d6efd",
      header: "#34495e",
      accent: "#3498db",
    });
  });

  it("sets a year from text, and removes it when blank or not a whole number", () => {
    expect(setYear(event, "2027").year).toBe(2027);
    expect(setYear(event, "")).not.toHaveProperty("year");
    expect(setYear(event, "20.5")).not.toHaveProperty("year");
  });

  it("sets or removes a date", () => {
    expect(setDate(event, "endDate", "2026-05-17").endDate).toBe("2026-05-17");
    expect(setDate(event, "startDate", "")).not.toHaveProperty("startDate");
  });

  it("sets a label, and removes a blank one (the pack's own word is used then)", () => {
    expect(setLabel(event, "participant", "Scout").terminology.labels).toEqual({
      team: "Patrol",
      group: "Troop",
      participant: "Scout",
    });
    expect(setLabel(event, "team", " ").terminology.labels).toEqual({
      group: "Troop",
    });
    const none = setLabel(setLabel(event, "team", ""), "group", "");
    expect(none.terminology).toEqual({ pack: "scouting" });
  });
});
