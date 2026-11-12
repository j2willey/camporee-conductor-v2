import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { devAuth, DEV_USER_HEADER } from "./auth/dev.ts";
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
    expect((await members(BOB)).map(({ email, role }) => [email, role])).toEqual([
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
