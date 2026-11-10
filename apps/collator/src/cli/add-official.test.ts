import type { CheckedBundle } from "@camporee-conductor/cartridge";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.ts";
import { loadEventCartridge } from "../load-event.ts";
import { officialsOf } from "../officials.ts";
import { loadedEvent } from "../load-event.ts";
import { circusCartridge, DIRECTOR_EMAIL } from "../test-support.ts";

const CLI = (name: string) => new URL(`./${name}.ts`, import.meta.url).pathname;

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collator-officials-"));
  dbPath = join(dir, "collator.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (cli: string, ...args: string[]) =>
  spawnSync(process.execPath, [CLI(cli), ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000,
  });
const loaded = () => {
  const result = loadEventCartridge(openDb(dbPath), circusCartridge());
  if (!result.ok) throw new Error(result.issues.join("\n"));
};
const list = () => {
  const db = openDb(dbPath);
  return officialsOf(db, loadedEvent(db)?.bundle as CheckedBundle);
};

describe("add-official CLI", () => {
  it("adds an Official and says where to sign in", () => {
    loaded();
    const result = run(
      "add-official",
      "New@Example.com",
      "--name",
      "Nia Newcomer",
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^added new@example\.com \(official\)$/m);
    expect(result.stdout).toMatch(/\/official/);
    expect(list().find((o) => o.email === "new@example.com")).toMatchObject({
      name: "Nia Newcomer",
      role: "official",
    });
  });

  it("adds a Director with --director", () => {
    loaded();
    const result = run("add-official", "boss@example.com", "--director");
    expect(result.stdout).toMatch(/^added boss@example\.com \(director\)$/m);
  });

  it("updates an Official already on the list, e.g. to fix a Director's name", () => {
    loaded();
    const result = run("add-official", DIRECTOR_EMAIL, "--name", "Patricia");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^updated director@example\.com \(director\)$/m,
    );
  });

  it("makes an existing Official a Director, and --official the other way", () => {
    loaded();
    run("add-official", "lead.judge@example.com", "--director");
    expect(list().find((o) => o.email === "lead.judge@example.com")?.role).toBe(
      "director",
    );
    run("add-official", "lead.judge@example.com", "--official");
    expect(list().find((o) => o.email === "lead.judge@example.com")?.role).toBe(
      "official",
    );
  });

  it("refuses an invalid email with exit 1", () => {
    loaded();
    const result = run("add-official", "nope");
    expect(result.status).toBe(1);
    expect(result.stderr).not.toBe("");
  });

  it("refuses when no Event is loaded, with exit 1", () => {
    const result = run("add-official", "new@example.com");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no Event/i);
  });

  it("explains its usage with exit 2: no email, both roles, an unknown flag", () => {
    for (const args of [
      [],
      ["a@example.com", "--director", "--official"],
      ["a@example.com", "--bogus"],
      ["a@example.com", "--name"],
    ]) {
      const result = run("add-official", ...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/usage/);
    }
  });
});

describe("list-officials CLI", () => {
  it("lists every effective Official with where each came from", () => {
    loaded();
    run("add-official", "new@example.com", "--name", "Nia Newcomer");
    run("add-official", DIRECTOR_EMAIL, "--name", "Patricia");
    const result = run("list-officials");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.includes("lead.judge@example.com"))).toMatch(
      /official.*cartridge/,
    );
    expect(lines.find((l) => l.includes("new@example.com"))).toMatch(
      /official\s+Nia Newcomer\s+box, added \d{4}-\d\d-\d\dT/,
    );
    expect(lines.find((l) => l.includes(DIRECTOR_EMAIL))).toMatch(
      /director\s+Patricia\s+box, added /,
    );
  });

  it("refuses when no Event is loaded", () => {
    const result = run("list-officials");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no Event/i);
  });
});
