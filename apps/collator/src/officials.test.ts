import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { addedOfficials, eventDocuments } from "./db/schema.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadedEvent, loadEventCartridge } from "./load-event.ts";
import { addOfficial, officialsOf } from "./officials.ts";
import {
  circusCartridge,
  DIRECTOR_EMAIL,
  OTHER_EVENT_ID,
  testDb,
} from "./test-support.ts";

// Adding an Official on the box's console (#42 PR 5, ADR-0027 item 5).

const LEAD = "lead.judge@example.com";
const NEW = "new.person@example.com";

let db: Db;
beforeEach(() => {
  db = testDb();
});

const load = () => {
  const result = loadEventCartridge(db, circusCartridge());
  if (!result.ok) throw new Error(result.issues.join("\n"));
};
const effective = () => {
  const event = loadedEvent(db);
  if (!event) throw new Error("no event");
  return officialsOf(db, event.bundle);
};
const find = (email: string) => effective().find((o) => o.email === email);
const me = (email: string) =>
  createApp({ db }).request("/api/official/me", {
    headers: { [OFFICIAL_EMAIL_HEADER]: email },
  });

describe("addOfficial", () => {
  it("lets a new email through the Official gate, as an official by default", async () => {
    load();
    expect((await me(NEW)).status).toBe(403);
    const result = addOfficial(db, {
      email: "  New.Person@Example.com ",
      name: "Nia",
    });
    expect(result).toMatchObject({
      ok: true,
      status: "added",
      official: { email: NEW, name: "Nia", role: "official", source: "box" },
    });
    const res = await me(NEW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: NEW,
      role: "official",
      name: "Nia",
    });
  });

  it("adds a Director when asked", async () => {
    load();
    addOfficial(db, { email: NEW, role: "director" });
    expect(await (await me(NEW)).json()).toMatchObject({ role: "director" });
  });

  it("updates the name of a cartridge Official, keeping the role", () => {
    load();
    const result = addOfficial(db, { email: DIRECTOR_EMAIL, name: "Patricia" });
    expect(result).toMatchObject({ ok: true, status: "updated" });
    expect(find(DIRECTOR_EMAIL)).toMatchObject({
      name: "Patricia",
      role: "director",
      source: "box",
    });
    expect(effective().filter((o) => o.email === DIRECTOR_EMAIL)).toHaveLength(
      1,
    );
  });

  it("keeps the current name when none is given", () => {
    load();
    addOfficial(db, { email: DIRECTOR_EMAIL, role: "official" });
    expect(find(DIRECTOR_EMAIL)).toMatchObject({
      name: "Pat Director",
      role: "official",
    });
  });

  it("makes an existing Official a Director", async () => {
    load();
    expect(find(LEAD)?.role).toBe("official");
    addOfficial(db, { email: LEAD, role: "director" });
    expect(find(LEAD)).toMatchObject({ role: "director", source: "box" });
    expect(await (await me(LEAD)).json()).toMatchObject({ role: "director" });
  });

  it("the newest addition for an email wins", () => {
    load();
    addOfficial(db, { email: NEW, name: "One", role: "director" });
    const second = addOfficial(db, { email: NEW, name: "Two" });
    expect(second).toMatchObject({ ok: true, status: "updated" });
    expect(find(NEW)).toMatchObject({ name: "Two", role: "director" });
    expect(db.select().from(addedOfficials).all()).toHaveLength(2);
  });

  it("refuses an invalid email, and adds nothing", () => {
    load();
    const result = addOfficial(db, { email: "not an email" });
    expect(result).toMatchObject({ ok: false });
    expect(db.select().from(addedOfficials).all()).toEqual([]);
  });

  it("refuses when no Event is loaded", () => {
    const result = addOfficial(db, { email: NEW });
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no Event/i),
    });
    expect(db.select().from(addedOfficials).all()).toEqual([]);
  });

  it("ignores additions made for another Event id", () => {
    load();
    db.insert(addedOfficials)
      .values({
        eventId: OTHER_EVENT_ID,
        email: NEW,
        name: "Elsewhere",
        role: "director",
        addedAt: new Date(),
      })
      .run();
    expect(find(NEW)).toBeUndefined();
  });

  it("marks cartridge Officials as such, and leaves the cartridge document alone", () => {
    load();
    const before = db.select().from(eventDocuments).all();
    addOfficial(db, { email: DIRECTOR_EMAIL, name: "Patricia" });
    addOfficial(db, { email: NEW });
    expect(db.select().from(eventDocuments).all()).toEqual(before);
    expect(find(LEAD)).toMatchObject({ source: "cartridge" });
    expect(find(LEAD)?.addedAt).toBeUndefined();
    expect(find(NEW)?.addedAt).toBeInstanceOf(Date);
  });
});
