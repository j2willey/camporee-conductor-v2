import { describe, expect, it } from "vitest";
import { loadCircus2026AsRun } from "../scripts/circus-2026-as-run.ts";
import { scoreEvent } from "./index.ts";

/** Freezes a value and everything inside it, so any write throws (ES modules are strict). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

describe("scoreEvent is pure (ADR-0019)", () => {
  it("never changes its input, and the same input always gives the same results", () => {
    const { input } = loadCircus2026AsRun();
    const before = structuredClone(input);
    deepFreeze(input);
    const first = scoreEvent(input);
    expect(input).toEqual(before);
    expect(scoreEvent(input)).toEqual(first);
    expect(scoreEvent(structuredClone(before))).toEqual(first);
  });
});
