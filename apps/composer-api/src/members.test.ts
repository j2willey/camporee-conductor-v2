import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import {
  devAuth,
  DEV_EMAIL_VERIFIED_HEADER,
  DEV_USER_HEADER,
} from "./auth/dev.ts";
import type { Db } from "./db/open.ts";
import { auditLog } from "./db/schema.ts";
import { testDb } from "./test-support.ts";

/** An Organization's members: list, change role, remove (ADR-0021, #101 PR 1). */

const ANN = "ann@example.com"; // owner
const ED = "ed@example.com"; // editor
const BOB = "bob@example.com"; // viewer
const EVE = "eve@example.com"; // not a member

let db: Db;
let app: ReturnType<typeof createApp>;
let org: string;

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
    json: (text ? JSON.parse(text) : null) as unknown,
  };
}
type Member = { userId: string; email: string; role: string };
const members = async (who = ANN) =>
  (await call(who, "GET", `/api/organizations/${org}/members`))
    .json as Member[];
const idOf = async (email: string) =>
  (await members()).find((m) => m.email === email)?.userId ?? "";
const setRole = async (who: string, email: string, role: string) =>
  call(
    who,
    "PATCH",
    `/api/organizations/${org}/members/${encodeURIComponent(await idOf(email))}`,
    { role },
  );
const remove = async (who: string, email: string) =>
  call(
    who,
    "DELETE",
    `/api/organizations/${org}/members/${encodeURIComponent(await idOf(email))}`,
  );
const actions = () =>
  db
    .select()
    .from(auditLog)
    .all()
    .map((r) => r.action);

beforeEach(async () => {
  db = testDb();
  app = createApp({
    db,
    auth: devAuth(),
    authConfig: { adapter: "dev" },
    now: () => new Date("2026-11-12T10:00:00Z"),
  });
  const res = await call(ANN, "POST", "/api/organizations", {
    name: "Coyote Creek",
    slug: "coyote-creek",
  });
  org = (res.json as { id: string }).id;
  for (const [who, role] of [
    [ED, "editor"],
    [BOB, "viewer"],
  ] as const) {
    await call(who, "GET", "/api/me");
    await call(ANN, "POST", `/api/organizations/${org}/members`, {
      email: who,
      role,
    });
  }
  await call(EVE, "GET", "/api/me");
});

describe("GET /api/organizations/:orgId/members", () => {
  it("lists every member by email for any member, owners first", async () => {
    expect(
      (await members(BOB)).map(({ email, role }) => [email, role]),
    ).toEqual([
      [ANN, "owner"],
      [ED, "editor"],
      [BOB, "viewer"],
    ]);
    expect(
      (await call(EVE, "GET", `/api/organizations/${org}/members`)).status,
    ).toBe(404);
  });

  it("audits adding a member", () => {
    expect(actions()).toEqual(["member.add", "member.add"]);
  });
});

describe("changing a role", () => {
  it("lets an owner change anyone's role, with an audit row", async () => {
    const res = await setRole(ANN, ED, "owner");
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ email: ED, role: "owner" });
    expect((await members()).find((m) => m.email === ED)?.role).toBe("owner");
    expect(actions().at(-1)).toBe("member.role");
    // With a second owner, the first may step down.
    expect((await setRole(ANN, ANN, "editor")).status).toBe(200);
  });

  it("refuses to demote the last owner", async () => {
    const res = await setRole(ANN, ANN, "editor");
    expect(res.status).toBe(409);
    expect(res.json).toEqual({
      error: "An Organization needs at least one owner.",
    });
  });

  it("is for owners only, and only for members", async () => {
    expect((await setRole(ED, BOB, "editor")).status).toBe(403);
    expect(
      (
        await call(ANN, "PATCH", `/api/organizations/${org}/members/nobody`, {
          role: "editor",
        })
      ).status,
    ).toBe(404);
    expect((await setRole(ANN, BOB, "boss")).status).toBe(400);
  });
});

describe("removing a member", () => {
  it("lets an owner remove a member, with an audit row", async () => {
    const res = await remove(ANN, BOB);
    expect(res.status).toBe(200);
    expect((await members()).map((m) => m.email)).toEqual([ANN, ED]);
    expect(actions().at(-1)).toBe("member.remove");
    // Bob can no longer see the Organization.
    expect(
      (await call(BOB, "GET", `/api/organizations/${org}/members`)).status,
    ).toBe(404);
  });

  it("refuses to remove the last owner, even themselves", async () => {
    expect((await remove(ANN, ANN)).status).toBe(409);
    await setRole(ANN, ED, "owner");
    expect((await remove(ANN, ANN)).status).toBe(200);
  });

  it("is for owners only", async () => {
    expect((await remove(ED, BOB)).status).toBe(403);
  });
});

describe("pending invites (#35)", () => {
  const NEW = "newcomer@example.com";
  const invite = (who: string, email: string, role: string) =>
    call(who, "POST", `/api/organizations/${org}/members`, { email, role });
  type Invite = { email: string; role: string };
  const invites = async (who = ANN) =>
    call(who, "GET", `/api/organizations/${org}/invites`);
  const revoke = (who: string, email: string) =>
    call(
      who,
      "DELETE",
      `/api/organizations/${org}/invites/${encodeURIComponent(email)}`,
    );
  const unverifiedSignIn = (email: string) =>
    app.request("/api/me", {
      headers: {
        [DEV_USER_HEADER]: email,
        [DEV_EMAIL_VERIFIED_HEADER]: "false",
      },
    });

  it("invites an email no one has signed in with, and says so", async () => {
    const res = await invite(ANN, "NewComer@Example.com", "editor");
    expect(res.status).toBe(201);
    expect(res.json).toEqual({ invited: true, email: NEW, role: "editor" });
    const list = await invites();
    expect(list.status).toBe(200);
    expect(
      (list.json as Invite[]).map(({ email, role }) => [email, role]),
    ).toEqual([[NEW, "editor"]]);
    expect(actions().at(-1)).toBe("member.invite");
  });

  it("updates the role when the same email is invited again", async () => {
    await invite(ANN, NEW, "editor");
    const again = await invite(ANN, NEW, "viewer");
    expect(again.status).toBe(200);
    expect((await invites()).json).toMatchObject([{ email: NEW, role: "viewer" }]);
  });

  it("turns into a membership at the first sign-in with that verified email", async () => {
    await invite(ANN, NEW, "editor");
    expect((await call(NEW, "GET", "/api/me")).status).toBe(200);
    expect(
      (await members()).find((m) => m.email === NEW)?.role,
    ).toBe("editor");
    expect((await invites()).json).toEqual([]);
    expect(actions().at(-1)).toBe("member.add");
    // The new member can open the Organization.
    expect(
      (await call(NEW, "GET", `/api/organizations/${org}/members`)).status,
    ).toBe(200);
  });

  it("never turns into a membership for an unverified email", async () => {
    await invite(ANN, NEW, "editor");
    expect((await unverifiedSignIn(NEW)).status).toBe(403);
    expect((await members()).map((m) => m.email)).not.toContain(NEW);
    expect((await invites()).json).toMatchObject([{ email: NEW }]);
  });

  it("can be revoked by an owner, and then gives nothing", async () => {
    await invite(ANN, NEW, "editor");
    expect((await revoke(ANN, NEW)).status).toBe(200);
    expect((await invites()).json).toEqual([]);
    expect(actions().at(-1)).toBe("member.uninvite");
    await call(NEW, "GET", "/api/me");
    expect((await members()).map((m) => m.email)).not.toContain(NEW);
    expect((await revoke(ANN, NEW)).status).toBe(404);
  });

  it("is for owners only: inviting, listing and revoking", async () => {
    expect((await invite(ED, NEW, "viewer")).status).toBe(403);
    await invite(ANN, NEW, "viewer");
    expect((await invites(ED)).status).toBe(403);
    expect((await revoke(ED, NEW)).status).toBe(403);
  });
});
