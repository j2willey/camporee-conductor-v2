import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { FirstLoad } from "./config.ts";
import type { Db } from "./db/open.ts";
import { cartridgeLoads, eventDocuments } from "./db/schema.ts";
import { resetBox } from "./reset.ts";
import { firstLoadLine } from "./server.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadedEvent, loadEventCartridge } from "./load-event.ts";
import {
  CIRCUS_EVENT_ID,
  circusCartridge,
  DIRECTOR_EMAIL,
  OTHER_EVENT_ID,
  testDb,
} from "./test-support.ts";

/** Loading the event-day cartridge from the Official view (ADR-0027, #100 PR 5, provisional). */

let db: Db;
const app = (firstLoad: FirstLoad) => createApp({ db, firstLoad });
const CODE: FirstLoad = { mode: "code", code: "pine-cone", generated: false };

function upload(
  firstLoad: FirstLoad,
  bytes: Uint8Array,
  {
    email,
    setupCode,
    from,
    on = app(firstLoad),
  }: {
    email?: string;
    setupCode?: string;
    /** The address Caddy forwards. */
    from?: string;
    on?: ReturnType<typeof createApp>;
  } = {},
) {
  const form = new FormData();
  form.append(
    "file",
    new File([bytes as Uint8Array<ArrayBuffer>], "circus-event-day.zip"),
  );
  if (setupCode !== undefined) form.append("setupCode", setupCode);
  return on.request("/api/cartridge", {
    method: "POST",
    headers: {
      ...(email && { [OFFICIAL_EMAIL_HEADER]: email }),
      ...(from && { "x-forwarded-for": from }),
    },
    body: form,
  });
}
const body = async (res: Response) =>
  (await res.json()) as {
    error?: string;
    event?: { id: string; title: string };
    notes?: string[];
  };

beforeEach(() => {
  db = testDb();
});

describe("GET /api/box", () => {
  it("says whether an Event is loaded and whether a first load needs the setup code", async () => {
    const res = await app(CODE).request("/api/box");
    expect(await res.json()).toEqual({ event: null, firstLoad: "code" });
    const open = await app({ mode: "open" }).request("/api/box");
    expect(await open.json()).toEqual({ event: null, firstLoad: "open" });
  });
});

describe("POST /api/cartridge on an empty box", () => {
  it("loads with the setup code, and says what loaded", async () => {
    const res = await upload(CODE, circusCartridge(), {
      setupCode: "pine-cone",
    });
    expect(res.status).toBe(200);
    expect((await body(res)).event).toMatchObject({ id: CIRCUS_EVENT_ID });
    expect(loadedEvent(db)?.manifest.event.id).toBe(CIRCUS_EVENT_ID);
  });

  it("refuses a missing or wrong setup code, and loads nothing", async () => {
    for (const setupCode of [undefined, "", "wrong"]) {
      const res = await upload(CODE, circusCartridge(), {
        ...(setupCode !== undefined && { setupCode }),
      });
      expect(res.status).toBe(403);
      expect((await body(res)).error).toBe(
        "Enter the box's setup code: it's in the box's settings (SETUP_CODE), or in its log when it started.",
      );
    }
    expect(loadedEvent(db)).toBeUndefined();
  });

  it("loads with no code when FIRST_LOAD is open (a box with no internet)", async () => {
    const res = await upload({ mode: "open" }, circusCartridge());
    expect(res.status).toBe(200);
  });

  it("refuses a bad cartridge with each problem, and loads nothing", async () => {
    const res = await upload({ mode: "open" }, strToU8("not a zip"));
    expect(res.status).toBe(422);
    expect((await body(res)).error).toBe("not a zip file");
    expect(loadedEvent(db)).toBeUndefined();
  });

  it("refuses a request with no file", async () => {
    const res = await app({ mode: "open" }).request("/api/cartridge", {
      method: "POST",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/cartridge once an Event is loaded", () => {
  beforeEach(() => {
    expect(loadEventCartridge(db, circusCartridge()).ok).toBe(true);
  });

  it("lets the Director load a new version of the same Event", async () => {
    const res = await upload(CODE, circusCartridge(), {
      email: DIRECTOR_EMAIL,
    });
    expect(res.status).toBe(200);
  });

  it("is for a signed-in Director only: the setup code no longer opens it", async () => {
    expect((await upload({ mode: "open" }, circusCartridge())).status).toBe(
      401,
    );
    expect(
      (await upload(CODE, circusCartridge(), { setupCode: "pine-cone" }))
        .status,
    ).toBe(401);
    const official = await upload(CODE, circusCartridge(), {
      email: "lead.judge@example.com",
    });
    expect(official.status).toBe(403);
    expect((await body(official)).error).toBe(
      "Only a Director can load a cartridge.",
    );
    expect(
      (await upload(CODE, circusCartridge(), { email: "nobody@example.com" }))
        .status,
    ).toBe(403);
  });

  it("keeps the rule that a different Event is refused once there are scores or roster", async () => {
    await app(CODE).request("/api/groups/g1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Troop 101" }),
    });
    const res = await upload(
      CODE,
      circusCartridge({ eventId: OTHER_EVENT_ID }),
      { email: DIRECTOR_EMAIL },
    );
    expect(res.status).toBe(422);
    expect((await body(res)).error).toContain("it's for a different Event");
  });
});

describe("hardening the first load (ADR-0027, provisional)", () => {
  it("spends the setup code on the first load: an emptied box doesn't take it again", async () => {
    const box = app(CODE);
    const first = await upload(CODE, circusCartridge(), {
      setupCode: "pine-cone",
      on: box,
    });
    expect(first.status).toBe(200);
    // However the box came to be empty again, the spent code doesn't open it.
    db.delete(cartridgeLoads).run();
    db.delete(eventDocuments).run();
    expect(loadedEvent(db)).toBeUndefined();
    const again = await upload(CODE, circusCartridge(), {
      setupCode: "pine-cone",
      on: box,
    });
    expect(again.status).toBe(403);
    expect((await body(again)).error).toBe(
      "This setup code has loaded a cartridge already. Restart the box for a new one.",
    );
  });

  it("slows down wrong codes from one address, and not from another", async () => {
    const box = app(CODE);
    for (let i = 0; i < 5; i++) {
      const res = await upload(CODE, circusCartridge(), {
        setupCode: "wrong",
        from: "10.0.0.5",
        on: box,
      });
      expect(res.status).toBe(403);
    }
    const blocked = await upload(CODE, circusCartridge(), {
      setupCode: "pine-cone",
      from: "10.0.0.5",
      on: box,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("30");
    expect((await body(blocked)).error).toBe(
      "Too many wrong setup codes. Wait 30 seconds and try again.",
    );
    const other = await upload(CODE, circusCartridge(), {
      setupCode: "pine-cone",
      from: "10.0.0.6",
      on: box,
    });
    expect(other.status).toBe(200);
  });

  it("doesn't reopen after a reset: the Event stays loaded, so only a Director may load", async () => {
    expect(loadEventCartridge(db, circusCartridge()).ok).toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "collator-reset-"));
    const reset = resetBox(
      db,
      { dir, everyMinutes: 5, keep: 10 },
      {
        kind: "scores",
        confirm: "Coyote Creek District Camporee 2026",
        officialEmail: DIRECTOR_EMAIL,
      },
    );
    expect(reset.ok).toBe(true);
    expect(
      (await upload(CODE, circusCartridge(), { setupCode: "pine-cone" }))
        .status,
    ).toBe(401);
    expect((await upload({ mode: "open" }, circusCartridge())).status).toBe(
      401,
    );
  });

  it("says loudly in the log when the first load is open", () => {
    expect(firstLoadLine({ mode: "open" })).toMatch(
      /^WARNING: first load is open/,
    );
    expect(
      firstLoadLine({ mode: "code", code: "X", generated: false }),
    ).not.toContain("X");
  });
});
