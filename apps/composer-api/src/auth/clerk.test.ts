import { describe, expect, it } from "vitest";
import { primaryEmailOf } from "./clerk.ts";

const user = (verification: { status: string } | null) => ({
  primaryEmailAddress: { emailAddress: "Ann@Example.com", verification },
});

describe("primaryEmailOf (Clerk user → email)", () => {
  it("is verified only when Clerk says the primary email is verified", () => {
    expect(primaryEmailOf(user({ status: "verified" }))).toEqual({
      email: "ann@example.com",
      emailVerified: true,
    });
    for (const status of ["unverified", "failed", "expired", "transferable"]) {
      expect(primaryEmailOf(user({ status }))?.emailVerified).toBe(false);
    }
    expect(primaryEmailOf(user(null))?.emailVerified).toBe(false);
  });

  it("is null without a primary email", () => {
    expect(primaryEmailOf({ primaryEmailAddress: null })).toBeNull();
  });
});
