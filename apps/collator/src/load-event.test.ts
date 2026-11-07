import { describe, expect, it } from "vitest";
import { loadedEvent, loadEventCartridge } from "./load-event.ts";
import { recordGroup, recordScore } from "./roster-and-scores.ts";
import {
  CIRCUS_EVENT_ID,
  circusCartridge,
  GROUP_ACTIVITY,
  OTHER_EVENT_ID,
  testDb,
} from "./test-support.ts";

const loaded = (result: ReturnType<typeof loadEventCartridge>) => {
  if (!result.ok) throw new Error(result.issues.join("\n"));
  return result;
};

/** A Group and one score for it, so the box holds event-day data. */
function scoreSomething(db: ReturnType<typeof testDb>) {
  recordGroup(db, { id: "g-1", name: "Troop 101" });
  recordScore(db, {
    id: "s-1",
    judge: { id: "j-1", name: "Alex Judge", email: "alex@example.com" },
    activityId: GROUP_ACTIVITY,
    entrantId: "g-1",
    values: {},
    phoneCreatedAt: "2027-05-15T09:00:00Z",
  });
}

describe("loading an event-day cartridge (issue #40)", () => {
  it("loads the Circus 2026 event-day cartridge", () => {
    const db = testDb();
    const result = loaded(loadEventCartridge(db, circusCartridge()));

    expect(result.event).toMatchObject({
      id: CIRCUS_EVENT_ID,
      slug: "coyote-creek-camporee-2026",
    });
    const event = loadedEvent(db);
    expect(event?.bundle.event.id).toBe(CIRCUS_EVENT_ID);
    expect(event?.bundle.activities).toHaveLength(33);
    expect(event?.bundle.officials?.officials).toHaveLength(2);
  });

  it("is empty until a cartridge is loaded", () => {
    expect(loadedEvent(testDb())).toBeUndefined();
  });

  it("refuses a design cartridge: it has no Officials (ADR-0027 item 5)", () => {
    const db = testDb();
    const result = loadEventCartridge(
      db,
      circusCartridge({ profile: "design" }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join("\n")).toMatch(/profile/);
    expect(loadedEvent(db)).toBeUndefined();
  });

  it("refuses something that isn't a zip, and loads nothing", () => {
    const db = testDb();
    const result = loadEventCartridge(db, new TextEncoder().encode("hello"));
    expect(result).toEqual({ ok: false, issues: ["not a zip file"] });
    expect(loadedEvent(db)).toBeUndefined();
  });

  it("reloads the same Event: the design is replaced, roster and scores are kept", () => {
    const db = testDb();
    loaded(loadEventCartridge(db, circusCartridge()));
    scoreSomething(db);

    const again = loaded(loadEventCartridge(db, circusCartridge()));

    expect(again.event.id).toBe(CIRCUS_EVENT_ID);
    expect(loadedEvent(db)?.bundle.activities).toHaveLength(33);
    // The score is still there: resending it is a repeat, not a new entry.
    expect(
      recordScore(db, {
        id: "s-1",
        judge: { id: "j-1", name: "Alex Judge", email: "alex@example.com" },
        activityId: GROUP_ACTIVITY,
        entrantId: "g-1",
        values: {},
        phoneCreatedAt: "2027-05-15T09:00:00Z",
      }),
    ).toMatchObject({ ok: true, status: "repeat" });
  });

  it("loads a different Event while the box holds no roster or scores", () => {
    const db = testDb();
    loaded(loadEventCartridge(db, circusCartridge()));
    const other = loaded(
      loadEventCartridge(db, circusCartridge({ eventId: OTHER_EVENT_ID })),
    );
    expect(other.event.id).toBe(OTHER_EVENT_ID);
    expect(loadedEvent(db)?.bundle.event.id).toBe(OTHER_EVENT_ID);
  });

  it("refuses a different Event while roster or scores exist, and keeps the loaded one", () => {
    const db = testDb();
    loaded(loadEventCartridge(db, circusCartridge()));
    recordGroup(db, { id: "g-1", name: "Troop 101" });

    const result = loadEventCartridge(
      db,
      circusCartridge({ eventId: OTHER_EVENT_ID }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.join("\n")).toMatch(
      /different Event.*roster or scores/,
    );
    expect(loadedEvent(db)?.bundle.event.id).toBe(CIRCUS_EVENT_ID);
  });
});
