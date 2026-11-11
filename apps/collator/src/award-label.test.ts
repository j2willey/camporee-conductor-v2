import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import type { AwardLabelSchema } from "@camporee-conductor/schema";
import { createApp } from "./app.ts";
import type { Db } from "./db/open.ts";
import { OFFICIAL_EMAIL_HEADER } from "./headers.ts";
import { loadEventCartridge } from "./load-event.ts";
import { circusCartridge, DIRECTOR_EMAIL, testDb } from "./test-support.ts";

// Award sticker label settings (ADR-0027, #43 PR 3): the Event's label until an Official saves another; append-only,
// latest wins.

type Label = z.infer<typeof AwardLabelSchema>;
const OFFICIAL = "lead.judge@example.com";

let db: Db;
let app: ReturnType<typeof createApp>;

const load = (
  editEvent?: (event: Record<string, unknown>) => Record<string, unknown>,
) => {
  const result = loadEventCartridge(
    db,
    circusCartridge(editEvent ? { editEvent } : {}),
  );
  if (!result.ok) throw new Error(result.issues.join("\n"));
};

beforeEach(() => {
  db = testDb();
  app = createApp({ db });
});

const style = { font: "Arial, sans-serif", size: "12pt", bold: false };
const label = (over: Partial<Label> = {}): Label => ({
  line1: "Camporee",
  line2: "Circus",
  syncFonts: true,
  styles: { line1: style, line2: style, activityName: style, winner: style },
  ...over,
});

const get = () =>
  app.request("/api/official/award-label", {
    headers: { [OFFICIAL_EMAIL_HEADER]: OFFICIAL },
  });
const put = (id: string, body: unknown, email = OFFICIAL) =>
  app.request(`/api/official/award-label/${id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      [OFFICIAL_EMAIL_HEADER]: email,
    },
    body: JSON.stringify(body),
  });
const save = (id: string, l: unknown = label(), at = "2027-05-15T10:00:00Z") =>
  put(id, { label: l, clientCreatedAt: at });

describe("GET /api/official/award-label", () => {
  it("is the Event's label until one is saved", async () => {
    load();
    const view = (await (await get()).json()) as {
      label: Label;
      source: string;
    };
    expect(view.source).toBe("event");
    expect(view.label.line1).toBe("Coyote Creek Camporee 2026");
    expect(view.label.line2).toBe("The Circus");
    expect(view.label.styles.line1).toEqual({
      font: "Georgia, serif",
      size: "10pt",
      bold: true,
    });
  });

  it("is a default from the Event's name when the Event has no label", async () => {
    load((event) => {
      const presentation = { ...(event["presentation"] as object) } as Record<
        string,
        unknown
      >;
      delete presentation["awardLabel"];
      return { ...event, presentation };
    });
    const view = (await (await get()).json()) as { label: Label };
    expect(view.label).toMatchObject({
      line2: "",
      syncFonts: true,
      styles: {
        winner: { font: "Arial, sans-serif", size: "10pt", bold: false },
      },
    });
    expect(view.label.line1.length).toBeGreaterThan(0);
  });

  it("needs an Official", async () => {
    load();
    expect((await app.request("/api/official/award-label")).status).toBe(401);
  });
});

describe("PUT /api/official/award-label/:id", () => {
  beforeEach(() => load());

  it("records a save (201), and the newest wins, with who saved it", async () => {
    expect((await save("a")).status).toBe(201);
    expect((await save("b", label({ line2: "Newer" }))).status).toBe(201);
    const view = (await (await get()).json()) as Record<string, unknown>;
    expect(view).toMatchObject({
      source: "box",
      savedBy: OFFICIAL,
      label: { line2: "Newer" },
    });
    expect(typeof view["savedAt"]).toBe("string");
  });

  it("names the Official by name when the list has one", async () => {
    await put(
      "a",
      { label: label(), clientCreatedAt: "2027-05-15T10:00:00Z" },
      DIRECTOR_EMAIL,
    );
    expect(await (await get()).json()).toMatchObject({
      savedBy: "Pat Director",
    });
  });

  it("answers a repeat with 200 and a conflict with 409", async () => {
    await save("a");
    expect((await save("a")).status).toBe(200);
    const other = await save("a", label({ line1: "Other" }));
    expect(other.status).toBe(409);
    expect(await (await get()).json()).toMatchObject({
      label: { line1: "Camporee" },
    });
  });

  it("refuses a font that isn't on the list, in plain words", async () => {
    const bad = label({
      styles: {
        line1: { ...style, font: "Papyrus" },
        line2: style,
        activityName: style,
        winner: style,
      },
    });
    const res = await save("a", bad);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/Papyrus/);
  });

  it.each(["5pt", "37pt", "12px", "12", "big", "1.5pt"])(
    "refuses the size %s",
    async (size) => {
      const bad = label({
        styles: {
          line1: style,
          line2: style,
          activityName: style,
          winner: { ...style, size },
        },
      });
      expect((await save("a", bad)).status).toBe(400);
    },
  );

  it("accepts the ends of the size range", async () => {
    for (const [id, size] of [
      ["a", "6pt"],
      ["b", "36pt"],
    ] as const) {
      const l = label({
        styles: {
          line1: { ...style, size },
          line2: style,
          activityName: style,
          winner: style,
        },
      });
      expect((await save(id, l)).status).toBe(201);
    }
  });

  it("refuses a label of the wrong shape, and a bad time", async () => {
    expect((await save("a", { line1: "x" })).status).toBe(400);
    expect((await save("b", label(), "yesterday")).status).toBe(400);
    expect((await put("c", { label: label() })).status).toBe(400);
  });
});
