import { describe, expect, it } from "vitest";
import { devAuth, DEV_EMAIL_VERIFIED_HEADER, DEV_USER_HEADER } from "./dev.ts";

describe("devAuth", () => {
  it("trusts the dev user header", async () => {
    const request = new Request("http://x/", {
      headers: { [DEV_USER_HEADER]: "Alice@Example.com" },
    });
    expect(await devAuth().currentUser(request)).toEqual({
      userId: "dev|alice@example.com",
      email: "alice@example.com",
      emailVerified: true,
    });
  });

  it("can act as an unverified email, to test the API's check", async () => {
    const request = new Request("http://x/", {
      headers: {
        [DEV_USER_HEADER]: "ann@example.com",
        [DEV_EMAIL_VERIFIED_HEADER]: "false",
      },
    });
    expect((await devAuth().currentUser(request))?.emailVerified).toBe(false);
  });

  it("is signed out without the header", async () => {
    expect(await devAuth().currentUser(new Request("http://x/"))).toBeNull();
  });
});
