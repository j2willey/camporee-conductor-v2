import { beforeEach, describe, expect, it } from "vitest";
import { setSysadmin } from "./admin.ts";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { testDb } from "./test-support.ts";

/** The profile (ADR-0032 notes, #104 PR 2): a display name and an organizer name, each user's own. */

const ANN = "ann@example.com";
const BOB = "bob@example.com";
const ADMIN = "ada@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;

async function call(who: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { [DEV_USER_HEADER]: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(path, {
    method,
    headers,
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    json: (text ? JSON.parse(text) : null) as Record<string, unknown>,
  };
}

const saveProfile = (who: string, body: unknown) =>
  call(who, "PUT", "/api/me", body);

beforeEach(async () => {
  db = testDb();
  app = createApp({ db, auth: devAuth(), authConfig: { adapter: "dev" } });
  await call(BOB, "GET", "/api/me");
  await call(ADMIN, "GET", "/api/me");
  setSysadmin(db, ADMIN, true);
});

describe("PUT /api/me", () => {
  it("saves your display name and organizer name, trimmed, and /api/me returns them", async () => {
    expect((await call(ANN, "GET", "/api/me")).json).toMatchObject({
      displayName: null,
      organizerName: null,
    });
    const res = await saveProfile(ANN, {
      displayName: "  Ann Smith ",
      organizerName: "Coyote Creek District",
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      displayName: "Ann Smith",
      organizerName: "Coyote Creek District",
    });
    expect((await call(ANN, "GET", "/api/me")).json).toMatchObject({
      email: ANN,
      displayName: "Ann Smith",
      organizerName: "Coyote Creek District",
    });
  });

  it("clears a name sent empty", async () => {
    await saveProfile(ANN, { displayName: "Ann", organizerName: "Coyote" });
    expect(
      (await saveProfile(ANN, { displayName: " ", organizerName: "" })).json,
    ).toEqual({ displayName: null, organizerName: null });
  });

  it("refuses a name over 100 characters, and anything else", async () => {
    expect(
      (
        await saveProfile(ANN, {
          displayName: "x".repeat(101),
          organizerName: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await saveProfile(ANN, {
          displayName: "Ann",
          organizerName: "",
          sysadmin: true,
        })
      ).status,
    ).toBe(400);
  });
});

describe("where the names show", () => {
  beforeEach(async () => {
    await saveProfile(ANN, {
      displayName: "Ann Smith",
      organizerName: "Coyote Creek District",
    });
  });

  it("an Organization's members list shows the display name", async () => {
    const org = (
      await call(ANN, "POST", "/api/organizations", {
        name: "Coyote Creek",
        slug: "coyote-creek",
      })
    ).json["id"] as string;
    await call(ANN, "POST", `/api/organizations/${org}/members`, {
      email: BOB,
      role: "viewer",
    });
    const members = (
      await call(BOB, "GET", `/api/organizations/${org}/members`)
    ).json as unknown as { email: string; displayName: string | null }[];
    expect(members).toEqual([
      expect.objectContaining({ email: ANN, displayName: "Ann Smith" }),
      expect.objectContaining({ email: BOB, displayName: null }),
    ]);
  });

  it("the admin users list shows both names, and searches them", async () => {
    const list = async (q: string) =>
      (
        (
          await call(
            ADMIN,
            "GET",
            `/api/admin/users?q=${encodeURIComponent(q)}`,
          )
        ).json as unknown as {
          users: {
            email: string;
            displayName: string | null;
            organizerName: string | null;
          }[];
        }
      ).users;
    expect(await list("smith")).toEqual([
      expect.objectContaining({
        email: ANN,
        displayName: "Ann Smith",
        organizerName: "Coyote Creek District",
      }),
    ]);
    expect((await list("coyote")).map((u) => u.email)).toEqual([ANN]);
    expect((await list("bob")).map((u) => u.email)).toEqual([BOB]);
    // % and _ are literal: "a_b" matches a_b, not axb.
    await call("a_b@example.com", "GET", "/api/me");
    await call("axb@example.com", "GET", "/api/me");
    expect((await list("a_b")).map((u) => u.email)).toEqual([
      "a_b@example.com",
    ]);
  });
});
