import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { appendEpoch, currentEpoch, epochsSince } from "./epoch.ts";
import { loadEventCartridge } from "./load-event.ts";
import { circusCartridge, testDb } from "./test-support.ts";

// The box epoch (#66, ADR-0027): a log of random ids with a reason; the newest is current.

describe("the epoch log", () => {
  it("a new database has a `created` epoch", () => {
    const epoch = currentEpoch(testDb());
    expect(epoch.reason).toBe("created");
    expect(epoch.id).toMatch(/\S{8,}/);
    expect(epoch.at).toBeInstanceOf(Date);
  });

  it("an existing database without one gets exactly one at its next open", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { openDb } = await import("./db/open.ts");
    const dir = mkdtempSync(join(tmpdir(), "collator-epoch-"));
    try {
      const first = openDb(join(dir, "c.db"));
      const id = currentEpoch(first).id;
      first.$client.prepare("DELETE FROM box_epochs").run();
      first.$client.close();
      const again = openDb(join(dir, "c.db"));
      expect(currentEpoch(again).reason).toBe("created");
      expect(currentEpoch(again).id).not.toBe(id);
      expect(
        (
          again.$client.prepare("SELECT count(*) n FROM box_epochs").get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
      again.$client.close();
      expect(currentEpoch(openDb(join(dir, "c.db"))).reason).toBe("created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("appending makes the new epoch current, with its reason", () => {
    const db = testDb();
    const created = currentEpoch(db);
    const restored = appendEpoch(db, "restore");
    expect(restored.id).not.toBe(created.id);
    expect(currentEpoch(db)).toEqual(restored);
    expect(restored.reason).toBe("restore");
  });

  it("epochsSince: the epochs after a known id, oldest first", () => {
    const db = testDb();
    const created = currentEpoch(db);
    const restore = appendEpoch(db, "restore");
    const reset = appendEpoch(db, "reset");
    expect(epochsSince(db, created.id)).toEqual([restore, reset]);
    expect(epochsSince(db, restore.id)).toEqual([reset]);
  });

  it("epochsSince the current id is an empty list", () => {
    const db = testDb();
    expect(epochsSince(db, currentEpoch(db).id)).toEqual([]);
  });

  it("epochsSince an unknown id says so", () => {
    expect(epochsSince(testDb(), "never-heard-of-it")).toEqual({
      unknown: true,
    });
  });
});

describe("the epoch in the API", () => {
  const setup = () => {
    const db = testDb();
    const result = loadEventCartridge(db, circusCartridge());
    if (!result.ok) throw new Error(result.issues.join("\n"));
    return { db, app: createApp({ db }) };
  };

  it("GET /api/event includes the epoch's id and reason", async () => {
    const { db, app } = setup();
    const body = (await (await app.request("/api/event")).json()) as {
      epoch: unknown;
    };
    const { id, reason } = currentEpoch(db);
    expect(body.epoch).toEqual({ id, reason });
  });

  it("every /api answer carries x-box-epoch, errors and the Official routes included", async () => {
    const { db, app } = setup();
    const id = currentEpoch(db).id;
    for (const path of [
      "/api/health",
      "/api/event",
      "/api/roster",
      "/api/official/me", // refused: no email
      "/api/nope",
    ]) {
      const res = await app.request(path);
      expect(res.headers.get("x-box-epoch"), path).toBe(id);
    }
    const put = await app.request("/api/groups/g1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Troop 1" }),
    });
    expect(put.headers.get("x-box-epoch")).toBe(id);
  });

  it("the header follows a new epoch", async () => {
    const { db, app } = setup();
    const next = appendEpoch(db, "reset");
    const res = await app.request("/api/health");
    expect(res.headers.get("x-box-epoch")).toBe(next.id);
  });

  it("GET /api/epochs?since= answers current, the epochs since, and unknown", async () => {
    const { db, app } = setup();
    const created = currentEpoch(db);
    const restore = appendEpoch(db, "restore");
    const get = async (since: string) =>
      (await (await app.request(`/api/epochs?since=${since}`)).json()) as {
        current: { id: string; reason: string };
        since: { id: string; reason: string }[] | null;
        unknown: boolean;
      };
    expect(await get(created.id)).toEqual({
      current: { id: restore.id, reason: "restore" },
      since: [{ id: restore.id, reason: "restore" }],
      unknown: false,
    });
    expect(await get(restore.id)).toMatchObject({ since: [], unknown: false });
    expect(await get("old-box")).toMatchObject({ since: null, unknown: true });
  });

  it("GET /api/epochs without since is a 400", async () => {
    const { app } = setup();
    expect((await app.request("/api/epochs")).status).toBe(400);
  });
});
