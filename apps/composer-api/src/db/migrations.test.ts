import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./open.ts";

/**
 * Migrations against a database that already holds rows, as the live Composer's does: a migration that rebuilds a
 * table must carry its rows across (#102: drizzle-kit's rebuild for 0004 copied a column the old table didn't have).
 */

const MIGRATIONS = new URL("../../drizzle", import.meta.url).pathname;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "composer-migrations-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A copy of the migrations folder that stops after the first `count` migrations. */
function migrationsUpTo(count: number): string {
  const folder = join(dir, "drizzle");
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: unknown[];
  };
  journal.entries = journal.entries.slice(0, count);
  writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

describe("0004: document visibility and curators", () => {
  it("keeps every document, now private, and every user, not a curator", () => {
    const path = join(dir, "composer.db");
    const before = new Database(path);
    migrate(drizzle(before), { migrationsFolder: migrationsUpTo(4) });
    before
      .prepare(
        "INSERT INTO organizations (id, slug, name, created_at) VALUES ('o1', 'coyote-creek', 'Coyote Creek', 0)",
      )
      .run();
    before
      .prepare(
        "INSERT INTO users (id, email, created_at) VALUES ('u1', 'ann@example.com', 0)",
      )
      .run();
    before
      .prepare(
        `INSERT INTO documents (id, kind, organization_id, slug, title, json, updated_at)
         VALUES ('d1', 'activity', 'o1', 'clown-car', 'Clown Car', '{}', 1000)`,
      )
      .run();
    before.close();

    openDb(path); // every migration, as the server does at start
    const after = new Database(path, { readonly: true });
    expect(
      after
        .prepare("SELECT id, slug, json, visibility, updated_at FROM documents")
        .all(),
    ).toEqual([
      {
        id: "d1",
        slug: "clown-car",
        json: "{}",
        visibility: "private",
        updated_at: 1000,
      },
    ]);
    expect(after.prepare("SELECT email, curator FROM users").all()).toEqual([
      { email: "ann@example.com", curator: 0 },
    ]);
    after.close();
  });
});
