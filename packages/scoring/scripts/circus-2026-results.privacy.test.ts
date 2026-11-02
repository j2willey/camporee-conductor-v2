import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { REDACTED } from "./collator-export.ts";

const DIR = new URL("../fixtures/circus-2026-results/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const text = files
  .map((f) => readFileSync(new URL(f, DIR), "utf8"))
  .join("\n")
  .toLowerCase();

describe("Circus 2026 results fixtures stay anonymous", () => {
  it("names judges only as Judge 1, Judge 2…", () => {
    const judges = JSON.parse(
      readFileSync(new URL("judges.json", DIR), "utf8"),
    ) as { id: number; name: string }[];
    expect(judges.map((j) => j.name)).toEqual(
      judges.map((_, i) => `Judge ${i + 1}`),
    );
  });

  it("contains nothing shaped like an email address", () => {
    expect(text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).toEqual([]);
  });

  it("redacts free text", () => {
    expect(text).toContain(REDACTED);
  });

  // Runs only where the real database is available, e.g.
  //   CIRCUS_2026_DB=~/data2/collator/collator/camporee.db pnpm test
  // so the names it checks for are never written into the repo.
  const dbPath = process.env["CIRCUS_2026_DB"];
  it.skipIf(!dbPath)(
    "contains no judge name or email from the real database",
    () => {
      const db = new DatabaseSync(dbPath ?? "", { readOnly: true });
      const judges = db.prepare("select name, email from judges").all() as {
        name: string;
        email: string;
      }[];
      db.close();
      // Whole words only: a short name can occur inside an unrelated word, such as an Activity slug.
      const asWord = (secret: string): RegExp =>
        new RegExp(
          `(?<![a-z0-9])${secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`,
        );
      const leaks = judges
        .flatMap((j) => [j.name, j.email])
        .map((secret) => secret.trim().toLowerCase())
        .filter((secret) => secret.length > 0)
        .filter((secret) => asWord(secret).test(text));
      expect(leaks.length, "fixtures contain a real judge name or email").toBe(
        0,
      );
    },
  );
});
