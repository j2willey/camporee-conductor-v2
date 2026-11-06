// The answer key (#46): the Circus 2026 v1 cartridge, imported mechanically, must match the hand-made
// design fixture, except for differences TRANSCODE-NOTES.md explains. Each allowed difference is listed
// here; anything else fails.
import { readdirSync, readFileSync } from "node:fs";
import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
  type Activity,
  type Event,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import { importV1Cartridge, type V1ImportOptions } from "./import-v1.ts";
import type { V1Camporee, V1Cartridge, V1Game, V1Input } from "./types.ts";

const FIXTURE = new URL(
  "../../../schema/fixtures/circus-2026/",
  import.meta.url,
);
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));

const v1 = (): V1Cartridge => ({
  camporee: read("v1-source/camporee.json") as V1Camporee,
  presets: read("v1-source/presets.json") as V1Input[],
  games: readdirSync(new URL("v1-source/games/", FIXTURE))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => read(`v1-source/games/${f}`) as V1Game),
});

/** The names the hand transcode chose for this fixture (packages/cartridge/scripts/transcode-circus-2026.ts). */
const CIRCUS: V1ImportOptions = {
  idNamespace: "circus-2026",
  idTimestamp: Date.UTC(2026, 9, 30),
  eventSlug: "coyote-creek-camporee-2026",
  commonFieldSet: {
    slug: "circus-2026-common-fields",
    title: "Circus 2026 Common Fields",
  },
};

const design = {
  event: EventSchema.parse(read("event.json")),
  set: CommonFieldSetSchema.parse(read("common-fields.json")),
  activities: readdirSync(new URL("activities/", FIXTURE))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ActivitySchema.parse(read(`activities/${f}`))),
};

const imported = importV1Cartridge(v1(), CIRCUS);
const importedBySlug = new Map(imported.activities.map((a) => [a.slug, a]));

/** A copy of a design Activity without its primary-metric marks (TRANSCODE-NOTES "Added: primary metrics"). */
const withoutPrimary = (activity: Activity): Activity => ({
  ...activity,
  scoring: {
    fields: activity.scoring.fields.map((field) => {
      const copy = { ...field };
      delete copy.primary;
      return copy;
    }),
  },
});

describe("Circus 2026: the v1 cartridge imported vs the design fixture", () => {
  it('imports one Activity more: top-dog, which the design made an Award ("Changed: Top Dog")', () => {
    expect(imported.activities.map((a) => a.slug)).toEqual(
      [...design.activities.map((a) => a.slug), "top-dog"].sort(),
    );
  });

  it('matches every design Activity exactly, apart from the 10 primary metrics ("Added: primary metrics")', () => {
    const differing: string[] = [];
    for (const activity of design.activities) {
      const expected = withoutPrimary(activity);
      if (JSON.stringify(expected) !== JSON.stringify(activity)) {
        differing.push(activity.slug);
      }
      expect(importedBySlug.get(activity.slug)).toEqual(expected);
    }
    expect(differing).toEqual([
      "3-ring-circus",
      "circus-line",
      "ducks-in-a-row",
      "pioneering-train-performance",
      "setting-up-the-big-top",
      "sports-land-skis",
      "the-a-frame-trapeze",
      "the-barrel-of-monkeys-caravan",
      "the-high-wire-fire-act",
      "the-tumbled-trapeze-rescue",
    ]);
  });

  it('matches the design\'s Common Fields, apart from two v1 data fixes ("Fixed or normalized")', () => {
    const fields = imported.commonFieldSet.fields;
    const pFlag = fields.find((f) => f.id === "p_flag");
    const tenEss = fields.find((f) => f.id === "ten_ess");
    // As v1 has them:
    expect(pFlag?.config?.placeholder).toBe("0-10 Points");
    expect(tenEss?.label).toContain("{{ten_essentials_item}}");
    // With the two fixes, everything matches:
    const fixed = {
      ...imported.commonFieldSet,
      fields: fields.map((f) => {
        if (f.id === "p_flag") {
          return { ...f, config: { ...f.config, placeholder: "0-5 Points" } };
        }
        const swap = (s: string) =>
          s.replace("{{ten_essentials_item}}", "{{ten_essentials}}");
        return {
          ...f,
          label: swap(f.label),
          ...(f.config && {
            config: {
              ...f.config,
              ...(f.config.placeholder !== undefined && {
                placeholder: swap(f.config.placeholder),
              }),
            },
          }),
        };
      }),
    };
    expect(fixed).toEqual(design.set);
  });

  it("matches the design's Event, apart from Top Dog, the Award and the Program Guide settings", () => {
    const expected: Partial<Event> = structuredClone(design.event);
    // "Changed: Top Dog": v1 lists it as a Troop Challenge at order 28; the design has the Award instead.
    delete expected.awards;
    const troop = design.event.competitions.find(
      (c) => c.slug === "troop-challenges",
    );
    const topDog = importedBySlug.get("top-dog");
    expected.activities = [
      ...design.event.activities,
      {
        activityId: topDog?.id ?? "",
        competitionId: troop?.id ?? "",
        sortOrder: 28,
      },
    ];
    // "Added: Program Guide settings".
    delete expected.programGuide;
    expected.competitions = design.event.competitions.map((c) => {
      const copy = { ...c };
      delete copy.programGuide;
      return copy;
    });
    const bySortOrder = (e: Partial<Event>) => ({
      ...e,
      activities: [...(e.activities ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder,
      ),
    });
    expect(bySortOrder(imported.event)).toEqual(bySortOrder(expected));
  });

  it("notes only the v1 {{ten_essentials_item}} bug, which the design fixed", () => {
    expect(imported.notes).toHaveLength(1);
    expect(imported.notes[0]).toMatch(
      /^Common Field ten_ess uses \{\{ten_essentials_item\}\}, which 18 Activities in Patrol Games don't define: /,
    );
  });

  it("takes the June 18 reclassifications from the v1 data as given: they're design, not import", () => {
    const game = v1().games.find((g) => g.id === "3-ring-circus");
    expect(
      game?.scoring_model.inputs.find((i) => i.id === "hand_breaks")?.kind,
    ).toBe("metric");
    expect(
      importedBySlug
        .get("3-ring-circus")
        ?.scoring.fields.find((f) => f.id === "hand_breaks")?.kind,
    ).toBe("metric");
  });
});

describe("Circus 2026 in the shape of v1's exported zip", () => {
  // exportCamporee writes no library fields, adds `enabled` to the playlist, and writes bracketMode
  // only when it's true (public/js/apps/composer.js).
  const zipShaped = (): V1Cartridge => {
    const cartridge = v1();
    cartridge.camporee.playlist = cartridge.camporee.playlist.map((e) => ({
      ...e,
      enabled: true,
    }));
    cartridge.games = cartridge.games.map((game) => {
      const copy = { ...game };
      delete copy.library_uuid;
      delete copy.library_title;
      if (!copy.bracketMode) delete copy.bracketMode;
      return copy;
    });
    return cartridge;
  };

  it("imports the same documents, without the library origin in legacy", () => {
    const fromZip = importV1Cartridge(zipShaped(), CIRCUS);
    expect(fromZip.event).toEqual(imported.event);
    expect(fromZip.commonFieldSet).toEqual(imported.commonFieldSet);
    expect(fromZip.activities).toEqual(
      imported.activities.map((a) => {
        const legacy = { ...a.legacy };
        delete legacy.v1LibraryUuid;
        delete legacy.v1LibraryTitle;
        return { ...a, legacy };
      }),
    );
  });
});
