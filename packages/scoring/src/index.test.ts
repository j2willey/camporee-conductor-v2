import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("scoring package", () => {
  it("is wired into the workspace test pipeline", () => {
    expect(PACKAGE_NAME).toBe("@camporee-conductor/scoring");
  });
});
