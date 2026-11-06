import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db/open.ts";
import { documents } from "../db/schema.ts";
import { CIRCUS_2026, testDb } from "../test-support.ts";
import { ImportError, importEvent, type EventBundle } from "./import-event.ts";
import { readEventBundle } from "./read-event-bundle.ts";

/** The Circus 2026 design, re-read for each test so tests can change it. */
const circus = (): EventBundle => readEventBundle(CIRCUS_2026);

const rows = (db: Db) =>
  db.select().from(documents).orderBy(documents.kind, documents.slug).all();

/** The ImportError issues from importing `bundle`, or [] if it imported. */
function issuesOf(db: Db, org: string, bundle: EventBundle): string[] {
  try {
    importEvent(db, org, bundle);
    return [];
  } catch (error) {
    if (error instanceof ImportError) return error.issues;
    throw error;
  }
}

describe("readEventBundle", () => {
  it("reads event.json, common-fields.json and activities/*.json", () => {
    const bundle = circus();
    expect(bundle.event).toMatchObject({ kind: "event" });
    expect(bundle.commonFieldSets).toHaveLength(1);
    expect(bundle.activities).toHaveLength(33);
  });
});

describe("importEvent", () => {
  let db: Db;
  beforeEach(() => {
    db = testDb("coyote-creek", "elsewhere");
  });

  it("imports the Circus 2026 design into the Organization", () => {
    const result = importEvent(db, "org-coyote-creek", circus());
    expect(result).toEqual({
      eventId: (circus().event as { id: string }).id,
      created: 35,
      updated: 0,
    });
    const stored = rows(db);
    expect(
      stored.map((r) => r.kind).filter((k) => k === "activity"),
    ).toHaveLength(33);
    expect(stored.filter((r) => r.kind === "event")).toMatchObject([
      {
        slug: "coyote-creek-camporee-2026",
        organizationId: "org-coyote-creek",
      },
    ]);
    expect(stored.filter((r) => r.kind === "common-field-set")).toHaveLength(1);
    expect(new Set(stored.map((r) => r.organizationId))).toEqual(
      new Set(["org-coyote-creek"]),
    );
  });

  it("stores each document exactly as given, with no defaults added (ADR-0012)", () => {
    const withoutDefault = circus();
    const eventDoc = { ...(withoutDefault.event as Record<string, unknown>) };
    delete eventDoc["tieNumbering"];
    withoutDefault.event = eventDoc;
    importEvent(db, "org-elsewhere", withoutDefault);
    expect(
      JSON.parse(
        db.select().from(documents).where(eq(documents.kind, "event")).get()
          ?.json ?? "{}",
      ),
    ).not.toHaveProperty("tieNumbering");
    db.delete(documents).run();

    importEvent(db, "org-coyote-creek", circus());
    const fileJson = JSON.stringify(
      JSON.parse(readFileSync(`${CIRCUS_2026}event.json`, "utf8")),
    );
    const [event] = db
      .select()
      .from(documents)
      .where(eq(documents.kind, "event"))
      .all();
    expect(event?.json).toBe(fileJson);
    const bundle = circus();
    for (const doc of [...bundle.activities, ...bundle.commonFieldSets]) {
      const { id } = doc as { id: string };
      const [row] = db
        .select()
        .from(documents)
        .where(eq(documents.id, id))
        .all();
      expect(row?.json).toBe(JSON.stringify(doc));
    }
  });

  it("stores the Event's Officials document too (event-day only, ADR-0027 item 5)", () => {
    const bundle = circus();
    const officials = {
      schemaVersion: "4.0",
      kind: "officials",
      id: "0196cfa2-4c00-7000-8000-000000000200",
      slug: "coyote-creek-camporee-2026-officials",
      title: "Coyote Creek District Camporee 2026 Officials",
      eventId: (bundle.event as { id: string }).id,
      officials: [{ email: "director@example.com", role: "director" }],
    };
    expect(
      importEvent(db, "org-coyote-creek", { ...bundle, officials }),
    ).toMatchObject({ created: 36, updated: 0 });
    const [row] = db
      .select()
      .from(documents)
      .where(eq(documents.kind, "officials"))
      .all();
    expect(row?.json).toBe(JSON.stringify(officials));
  });

  it("is idempotent: importing again updates the same documents", () => {
    importEvent(db, "org-coyote-creek", circus());
    const before = rows(db).map((r) => ({ ...r, updatedAt: null }));
    expect(importEvent(db, "org-coyote-creek", circus())).toMatchObject({
      created: 0,
      updated: 35,
    });
    expect(rows(db).map((r) => ({ ...r, updatedAt: null }))).toEqual(before);
  });

  it("rejects an invalid document, naming it, and writes nothing", () => {
    const bundle = circus();
    const [first] = bundle.activities as Record<string, unknown>[];
    bundle.activities[0] = { ...first, scoringType: "graded" };
    const issues = issuesOf(db, "org-coyote-creek", bundle);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(
      new RegExp(`^activity ${String(first?.["slug"])}: scoringType: `),
    );
    expect(rows(db)).toEqual([]);
  });

  it("rejects an Event that lists an Activity the bundle doesn't have", () => {
    const bundle = circus();
    const missing = bundle.activities.pop() as { id: string; slug: string };
    expect(issuesOf(db, "org-coyote-creek", bundle)).toEqual([
      `event coyote-creek-camporee-2026: activities: no Activity ${missing.id} in the bundle`,
    ]);
    expect(rows(db)).toEqual([]);
  });

  it("rejects an Activity the Event doesn't list", () => {
    const bundle = circus();
    const [first] = bundle.activities as { id: string; slug: string }[];
    bundle.activities.push({
      ...first,
      id: "0196cfa2-4c00-7000-8000-00000000ffff",
    });
    expect(issuesOf(db, "org-coyote-creek", bundle)).toEqual([
      `activity ${String(first?.slug)}: not listed in the Event`,
    ]);
  });

  it("rejects a Common Field set the bundle doesn't have", () => {
    const bundle = circus();
    const [set] = bundle.commonFieldSets as { id: string }[];
    bundle.commonFieldSets = [];
    const issues = issuesOf(db, "org-coyote-creek", bundle);
    expect(issues.length).toBeGreaterThan(0);
    expect(new Set(issues)).toEqual(
      new Set(
        issues.filter((i) =>
          i.endsWith(`no Common Field set ${String(set?.id)} in the bundle`),
        ),
      ),
    );
  });

  it("won't overwrite another Organization's documents, and writes nothing", () => {
    importEvent(db, "org-elsewhere", circus());
    const before = rows(db);
    const issues = issuesOf(db, "org-coyote-creek", circus());
    expect(issues).toHaveLength(35);
    expect(issues[0]).toMatch(/belongs to another Organization$/);
    expect(rows(db)).toEqual(before);
  });

  it("rejects an unknown Organization", () => {
    expect(() => importEvent(db, "org-nope", circus())).toThrow(
      /no Organization org-nope/,
    );
  });
});
