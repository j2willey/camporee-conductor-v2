import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { V1ImportError } from "./import-v1.ts";
import { importV1, parseV1Overlay, type V1Overlay } from "./overlay.ts";
import type { V1Camporee, V1Cartridge, V1Game, V1Input } from "./types.ts";

const FIXTURE = new URL(
  "../../../schema/fixtures/circus-2026/",
  import.meta.url,
);
const text = (path: string): string =>
  readFileSync(new URL(path, FIXTURE), "utf8");
const json = (path: string): unknown => JSON.parse(text(path));

const circus = (): V1Cartridge => ({
  camporee: json("v1-source/camporee.json") as V1Camporee,
  presets: json("v1-source/presets.json") as V1Input[],
  games: readdirSync(new URL("v1-source/games/", FIXTURE))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => json(`v1-source/games/${f}`) as V1Game),
});
const overlay = (): V1Overlay => parseV1Overlay(json("overlay.json"));

/** A document as the fixture files store it. */
const file = (doc: unknown) => `${JSON.stringify(doc, null, 2)}\n`;

const refusal = (run: () => unknown): string[] => {
  try {
    run();
  } catch (e) {
    if (e instanceof V1ImportError) return e.issues;
    throw e;
  }
  throw new Error("expected a refusal");
};

describe("Circus 2026: the v1 cartridge + overlay.json = the design fixture", () => {
  const result = importV1(circus(), overlay());

  it("reproduces event.json and common-fields.json byte for byte", () => {
    expect(file(result.event)).toBe(text("event.json"));
    expect(file(result.commonFieldSet)).toBe(text("common-fields.json"));
  });

  it("reproduces every Activity file byte for byte, and no others", () => {
    const names = readdirSync(new URL("activities/", FIXTURE)).sort();
    expect(result.activities.map((a) => `${a.slug}.json`)).toEqual(names);
    for (const activity of result.activities) {
      expect(file(activity)).toBe(text(`activities/${activity.slug}.json`));
    }
  });

  it("leaves nothing skipped, and no notes once the overlay fixes {{ten_essentials_item}}", () => {
    expect(result.skipped).toEqual([]);
    expect(result.notes).toEqual([]);
  });
});

describe("overlays that don't fit the cartridge are refused, by name", () => {
  it("rejects an unknown key, so a typo can't silently do nothing", () => {
    expect(refusal(() => parseV1Overlay({ primaryMetric: {} }))).toEqual([
      'overlay: Unrecognized key: "primaryMetric"',
    ]);
  });

  it("rejects a primary metric on a field the game doesn't have", () => {
    const stale = overlay();
    stale.primaryMetrics = {
      "3-ring-circus": { field: "total_time", direction: "lower-wins" },
    };
    expect(refusal(() => importV1(circus(), stale))).toEqual([
      "overlay: primaryMetrics.3-ring-circus: no field total_time",
    ]);
  });

  it("rejects a Competition, an Award's Competition, a replaced game or a Common Field that isn't there", () => {
    const stale: V1Overlay = {
      competitions: {
        "squad-games": { programGuide: { listActivities: false } },
      },
      awards: [
        {
          slug: "gold",
          label: "Gold",
          competition: "club-games",
          rule: { type: "manual" },
          replacesGame: "no-such-game",
        },
      ],
      commonFields: { p_flags: { placeholder: "0-5" } },
    };
    expect(refusal(() => importV1(circus(), stale))).toEqual([
      "overlay: competitions.squad-games: no such Competition",
      "overlay: awards.gold: no Competition club-games",
      "overlay: awards.gold: replacesGame: no game no-such-game in the cartridge",
      "overlay: commonFields.p_flags: no such Common Field",
    ]);
  });

  it("ignores a primary metric for a game that was left out (designs are unfinished until April)", () => {
    const cartridge = circus();
    for (const game of cartridge.games) {
      if (game.id === "circus-line") game.scoring_model.inputs = [];
    }
    const result = importV1(cartridge, overlay());
    expect(result.skipped.map((s) => s.game)).toEqual(["circus-line"]);
    expect(result.notes).toEqual([]);
    expect(result.activities.map((a) => a.slug)).not.toContain("circus-line");
  });
});

describe("importV1 without an overlay", () => {
  it("is the plain import with the default names", () => {
    const result = importV1(circus());
    expect(result.event.slug).toBe("coyote-creek-district-camporee-2026");
    expect(result.activities.map((a) => a.slug)).toContain("top-dog");
    expect(result.event).not.toHaveProperty("awards");
  });
});
