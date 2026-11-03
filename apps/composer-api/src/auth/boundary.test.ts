import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("..", import.meta.url).pathname;

describe("the auth module boundary (ADR-0014)", () => {
  it("keeps every Clerk import inside src/auth/", () => {
    const outside = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts") && !f.startsWith(`auth/`))
      .filter((f) =>
        /from\s+["']@clerk\//.test(readFileSync(join(SRC, f), "utf8")),
      )
      .map((f) => relative(SRC, join(SRC, f)));
    expect(outside).toEqual([]);
  });
});
