import { describe, expect, it } from "vitest";
import { OfficialsSchema, type Officials } from "./officials.ts";
import { issuesOf } from "./test-support.ts";

const valid = (): Officials => ({
  schemaVersion: "4.0",
  kind: "officials",
  id: "0196cfa2-4c00-7000-8000-000000000200",
  slug: "spring-field-day-2027-officials",
  title: "Spring Field Day 2027 Officials",
  eventId: "0196cfa2-4c00-7000-8000-000000000100",
  officials: [
    { email: "director@example.com", name: "Pat Organizer", role: "director" },
    { email: "judge.lead@example.com", role: "official" },
  ],
});

describe("OfficialsSchema (ADR-0027 item 5: event-day cartridge only)", () => {
  it("accepts a list of Officials for one Event", () => {
    expect(OfficialsSchema.parse(valid())).toEqual(valid());
  });

  it("allows an empty list (the Director adds Officials on site)", () => {
    expect(issuesOf(OfficialsSchema, { ...valid(), officials: [] })).toEqual(
      [],
    );
  });

  it("needs a valid email and a known role", () => {
    expect(
      issuesOf(OfficialsSchema, {
        ...valid(),
        officials: [{ email: "not-an-email", role: "judge" }],
      }),
    ).toEqual([
      "officials.0.email: Invalid email address",
      'officials.0.role: Invalid option: expected one of "director"|"official"',
    ]);
  });

  it("rejects the same email twice, ignoring case: one person, one entry", () => {
    expect(
      issuesOf(OfficialsSchema, {
        ...valid(),
        officials: [
          { email: "Pat@Example.com", role: "director" },
          { email: "pat@example.com", role: "official" },
        ],
      }),
    ).toEqual(["officials.1.email: duplicate email pat@example.com"]);
  });

  it("holds only Officials: no rosters or other contacts (ADR-0026)", () => {
    expect(issuesOf(OfficialsSchema, { ...valid(), judges: [] })).toContain(
      'Unrecognized key: "judges"',
    );
    expect(
      issuesOf(OfficialsSchema, {
        ...valid(),
        officials: [{ email: "a@example.com", role: "official", phone: "555" }],
      }),
    ).toContain('officials.0: Unrecognized key: "phone"');
  });
});
