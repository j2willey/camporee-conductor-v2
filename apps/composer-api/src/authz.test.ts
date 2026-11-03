import { describe, expect, it } from "vitest";
import { atLeast } from "./authz.ts";

describe("atLeast", () => {
  it("ranks owner over editor over viewer", () => {
    expect(atLeast("owner", "editor")).toBe(true);
    expect(atLeast("editor", "editor")).toBe(true);
    expect(atLeast("viewer", "editor")).toBe(false);
    expect(atLeast("editor", "owner")).toBe(false);
    expect(atLeast("viewer", "viewer")).toBe(true);
  });
});
