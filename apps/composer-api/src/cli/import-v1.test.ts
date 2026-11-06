import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.ts";
import { documents, organizations } from "../db/schema.ts";
import { CIRCUS_2026 } from "../test-support.ts";

const CLI = new URL("./import-v1.ts", import.meta.url).pathname;
const V1_SOURCE = join(CIRCUS_2026, "v1-source");
const OVERLAY = join(CIRCUS_2026, "overlay.json");

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composer-import-v1-"));
  dbPath = join(dir, "test.db");
  openDb(dbPath)
    .insert(organizations)
    .values({
      id: "org-1",
      slug: "coyote-creek",
      name: "Coyote Creek",
      createdAt: new Date(0),
    })
    .run();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000,
  });

interface V1Json {
  playlist: { gameId: string; enabled?: boolean }[];
}
interface GameJson {
  scoring_model: { inputs: unknown[] };
}

/**
 * The Circus 2026 v1 cartridge as a zip, laid out the way v1's Composer exports it (camporee.json,
 * presets.json and games/ at the root). `camporee` edits the manifest; `game` edits a game file, or drops
 * it by returning null.
 */
function circusZip({
  camporee: editCamporee = () => {},
  game: editGame = (_id, json) => json,
}: {
  camporee?: (camporee: V1Json) => void;
  game?: (id: string, json: GameJson) => GameJson | null;
} = {}): string {
  const camporee = JSON.parse(
    readFileSync(join(V1_SOURCE, "camporee.json"), "utf8"),
  ) as V1Json;
  editCamporee(camporee);
  const files: Record<string, Uint8Array> = {
    "camporee.json": strToU8(JSON.stringify(camporee)),
    "presets.json": readFileSync(join(V1_SOURCE, "presets.json")),
  };
  for (const name of readdirSync(join(V1_SOURCE, "games"))) {
    const id = name.replace(/\.json$/, "");
    const json = editGame(
      id,
      JSON.parse(readFileSync(join(V1_SOURCE, "games", name), "utf8")),
    );
    if (json) files[`games/${name}`] = strToU8(JSON.stringify(json));
  }
  const path = join(dir, "circus.zip");
  writeFileSync(path, zipSync(files));
  return path;
}

/** circus-line with its scoring fields not written yet. */
const unfinishedCircusLine = (id: string, json: GameJson) =>
  id === "circus-line"
    ? { ...json, scoring_model: { ...json.scoring_model, inputs: [] } }
    : json;

const disableCircusLine = (c: V1Json) => {
  c.playlist = c.playlist.map((e) =>
    e.gameId === "circus-line" ? { ...e, enabled: false } : e,
  );
};

const storedEvent = () => {
  const row = openDb(dbPath)
    .select()
    .from(documents)
    .where(eq(documents.kind, "event"))
    .get();
  return row ? JSON.parse(row.json) : undefined;
};

describe("import-v1 CLI", () => {
  it("loads a v1 cartridge zip with its overlay into an Organization, and again idempotently", () => {
    const zip = circusZip();
    const first = run("coyote-creek", zip, "--overlay", OVERLAY);
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(first.stdout).toMatch(/35 created, 0 updated/);
    expect(first.stdout).not.toMatch(/SKIPPED/);
    expect(run("coyote-creek", zip, "--overlay", OVERLAY).stdout).toMatch(
      /0 created, 35 updated/,
    );
    expect(openDb(dbPath).select().from(documents).all()).toHaveLength(35);
    // The same Event as the hand-checked design fixture.
    expect(storedEvent()).toEqual(
      JSON.parse(readFileSync(join(CIRCUS_2026, "event.json"), "utf8")),
    );
  });

  it("stores the v1 cartridge's Officials as the Event's Officials document", () => {
    const zip = circusZip({
      camporee: (c) => {
        (c as V1Json & { officials: unknown[] }).officials = [
          {
            user_id: "u1",
            display_name: "Ann",
            email: "ann@example.com",
            role: "director",
          },
        ];
      },
    });
    const result = run("coyote-creek", zip, "--overlay", OVERLAY);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/36 created, 0 updated/);
    const row = openDb(dbPath)
      .select()
      .from(documents)
      .where(eq(documents.kind, "officials"))
      .get();
    expect(JSON.parse(row?.json ?? "{}")).toMatchObject({
      eventId: storedEvent().id,
      officials: [{ email: "ann@example.com", name: "Ann", role: "director" }],
    });
  });

  it("reads a v1 workspace directory too, and without an overlay keeps top-dog as an Activity", () => {
    const result = run("coyote-creek", V1_SOURCE);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/36 created, 0 updated/);
    expect(storedEvent()).not.toHaveProperty("awards");
  });

  it("prints unfinished games prominently as SKIPPED, and imports the rest", () => {
    const zip = circusZip({ game: unfinishedCircusLine });
    const result = run("coyote-creek", zip, "--overlay", OVERLAY);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SKIPPED 1 game (not imported):");
    expect(result.stdout).toContain(
      "circus-line: unfinished: scoring.fields: a ranked Activity needs at least one scoring field",
    );
    expect(result.stdout).toMatch(/34 created, 0 updated/);
  });

  it("refuses an unfinished game with --strict, importing nothing", () => {
    const zip = circusZip({ game: unfinishedCircusLine });
    const result = run("coyote-creek", zip, "--overlay", OVERLAY, "--strict");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("strict: circus-line would be skipped");
    expect(openDb(dbPath).select().from(documents).all()).toHaveLength(0);
  });

  it("lists a game the playlist disables as info, even with --strict", () => {
    const zip = circusZip({ camporee: disableCircusLine });
    const result = run("coyote-creek", zip, "--overlay", OVERLAY, "--strict");
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/SKIPPED/);
    expect(result.stdout).toContain(
      "note: Left out 1 game the v1 playlist disables: circus-line.",
    );
  });

  it("lists Activities no longer in the cartridge, with titles, on every import until they're cleaned up", () => {
    run("coyote-creek", circusZip(), "--overlay", OVERLAY);
    // jugglers: not mentioned in the overlay (removing a game the overlay names refuses the import).
    const removed = circusZip({
      camporee: (c) => {
        c.playlist = c.playlist.filter((e) => e.gameId !== "jugglers");
      },
      game: (id, json) => (id === "jugglers" ? null : json),
    });
    for (let i = 0; i < 2; i++) {
      const result = run("coyote-creek", removed, "--overlay", OVERLAY);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "1 Activity no longer in the cartridge (kept in the database, not in the Event):",
      );
      expect(result.stdout).toContain("  - Jugglers (jugglers)");
    }
  });

  it("refuses the import when the overlay names a game that's gone from the cartridge", () => {
    const removed = circusZip({
      camporee: (c) => {
        c.playlist = c.playlist.filter((e) => e.gameId !== "circus-line");
      },
      game: (id, json) => (id === "circus-line" ? null : json),
    });
    const result = run("coyote-creek", removed, "--overlay", OVERLAY);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "overlay: primaryMetrics.circus-line: no game circus-line in the cartridge",
    );
  });

  it("doesn't list a game that's still in the cartridge but disabled or unfinished", () => {
    run("coyote-creek", circusZip(), "--overlay", OVERLAY);
    for (const zip of [
      circusZip({ camporee: disableCircusLine }),
      circusZip({ game: unfinishedCircusLine }),
    ]) {
      expect(run("coyote-creek", zip, "--overlay", OVERLAY).stdout).not.toMatch(
        /no longer in the cartridge/,
      );
    }
  });

  it("refuses a zip that isn't a v1 cartridge", () => {
    const path = join(dir, "other.zip");
    writeFileSync(path, zipSync({ "readme.txt": strToU8("hello") }));
    const result = run("coyote-creek", path);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no camporee\.json/);
  });

  it("fails with a message for an unknown Organization, and prints usage without arguments", () => {
    const unknown = run("nope", V1_SOURCE);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toMatch(/no Organization with slug "nope"/);
    const usage = run();
    expect(usage.status).toBe(2);
    expect(usage.stderr).toMatch(/usage/i);
  });
});
