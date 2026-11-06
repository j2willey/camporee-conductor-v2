import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCartridge } from "@camporee-conductor/cartridge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.ts";
import { organizations } from "../db/schema.ts";
import { importEvent } from "../import/import-event.ts";
import { readEventBundle } from "../import/read-event-bundle.ts";
import { CIRCUS_2026 } from "../test-support.ts";

const CLI = new URL("./export-cartridge.ts", import.meta.url).pathname;

let dir: string;
let dbPath: string;
const eventId = () => (readEventBundle(CIRCUS_2026).event as { id: string }).id;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composer-export-"));
  dbPath = join(dir, "test.db");
  const db = openDb(dbPath);
  db.insert(organizations)
    .values({
      id: "org-1",
      slug: "coyote-creek",
      name: "Coyote Creek",
      createdAt: new Date(0),
    })
    .run();
  importEvent(db, "org-1", readEventBundle(CIRCUS_2026));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath, INIT_CWD: dir },
    encoding: "utf8",
    timeout: 20_000,
  });

const addOfficials = (officials: unknown[]) =>
  importEvent(openDb(dbPath), "org-1", {
    ...readEventBundle(CIRCUS_2026),
    officials: {
      schemaVersion: "4.0",
      kind: "officials",
      id: "0196cfa2-4c00-7000-8000-000000000200",
      slug: "coyote-creek-camporee-2026-officials",
      title: "Coyote Creek District Camporee 2026 Officials",
      eventId: eventId(),
      officials,
    },
  });

describe("export-cartridge CLI", () => {
  it("writes the design cartridge by default, named after the Event", () => {
    const result = run("coyote-creek", "coyote-creek-camporee-2026");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const path = join(dir, "coyote-creek-camporee-2026-design.zip");
    expect(result.stdout).toContain(`wrote ${path}`);
    const loaded = loadCartridge(new Uint8Array(readFileSync(path)), {
      profile: "design",
    });
    expect(loaded.ok).toBe(true);
  });

  it("writes the event-day cartridge for the Collator, with the Officials, where --out says", () => {
    addOfficials([{ email: "director@example.com", role: "director" }]);
    const out = join(dir, "usb", "event.zip");
    const result = run(
      "coyote-creek",
      "coyote-creek-camporee-2026",
      "--profile",
      "event-day",
      "--out",
      out,
    );
    expect(result.status).toBe(0);
    const loaded = loadCartridge(new Uint8Array(readFileSync(out)), {
      profile: "event-day",
    });
    expect(loaded.ok && loaded.bundle.officials?.officials).toEqual([
      { email: "director@example.com", role: "director" },
    ]);
  });

  it("refuses an event-day cartridge without a Director, writing nothing", () => {
    const result = run(
      "coyote-creek",
      "coyote-creek-camporee-2026",
      "--profile",
      "event-day",
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("needs at least one Director");
    expect(
      existsSync(join(dir, "coyote-creek-camporee-2026-event-day.zip")),
    ).toBe(false);
  });

  it("fails with a message for an unknown Organization or Event, and prints usage without arguments", () => {
    expect(run("nope", "coyote-creek-camporee-2026").stderr).toMatch(
      /no Organization with slug "nope"/,
    );
    const noEvent = run("coyote-creek", "no-such-event");
    expect(noEvent.status).toBe(1);
    expect(noEvent.stderr).toMatch(/no Event "no-such-event" in coyote-creek/);
    const usage = run();
    expect(usage.status).toBe(2);
    expect(usage.stderr).toMatch(/usage/i);
  });
});
