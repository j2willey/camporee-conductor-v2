import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open.ts";
import { loadedEvent } from "../load-event.ts";
import { CIRCUS_EVENT_ID, circusCartridge } from "../test-support.ts";

const CLI = new URL("./load-cartridge.ts", import.meta.url).pathname;

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "collator-load-"));
  dbPath = join(dir, "collator.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env["PATH"], DATABASE_PATH: dbPath },
    encoding: "utf8",
    timeout: 20_000,
  });

const cartridgeFile = (name: string, bytes: Uint8Array) => {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
};

describe("load-cartridge CLI", () => {
  it("loads an event-day cartridge into the Collator database", () => {
    const result = run(cartridgeFile("circus.zip", circusCartridge()));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/loaded .*coyote-creek-camporee-2026/);
    expect(loadedEvent(openDb(dbPath))?.bundle.event.id).toBe(CIRCUS_EVENT_ID);
  });

  it("refuses a design cartridge, listing why, and exits 1", () => {
    const result = run(
      cartridgeFile("design.zip", circusCartridge({ profile: "design" })),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused/);
    expect(loadedEvent(openDb(dbPath))).toBeUndefined();
  });

  it("explains its usage when no file is given", () => {
    const result = run();
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/usage/);
  });
});
