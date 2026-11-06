// Regenerates the two Circus 2026 fixtures in packages/schema/fixtures from their v1 cartridges: the general
// v1 importer (issue #46) plus each fixture's overlay.json, the Circus-only design choices v1 can't express.
// Re-running it gives byte-identical output. See fixtures/circus-2026/TRANSCODE-NOTES.md.
//   circus-2026/         design: the v3 cartridge with Jim's post-event corrections
//   circus-2026-as-run/  as run: the schema 2.9 cartridge the event laptop ran
// Run: node packages/cartridge/scripts/transcode-circus-2026.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  importV1,
  parseV1Overlay,
  type V1Camporee,
  type V1Cartridge,
  type V1Game,
  type V1Input,
} from "../src/index.ts";

const FIXTURES = new URL("../../schema/fixtures/", import.meta.url);

// --- reading the v1 cartridges ----------------------------------------------------------------------

const readJson = <T>(dir: URL, path: string): T =>
  JSON.parse(readFileSync(new URL(`v1-source/${path}`, dir), "utf8")) as T;

function readCartridge(dir: URL): V1Cartridge {
  return {
    camporee: readJson<V1Camporee>(dir, "camporee.json"),
    presets: readJson<V1Input[]>(dir, "presets.json"),
    games: readdirSync(new URL("v1-source/games/", dir))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => readJson<V1Game>(dir, `games/${f}`)),
  };
}

/**
 * Schema 2.9 game `type` → v3 league id, the mapping v1's own schema-v3 migration used (5888d22).
 * Only the as-run cartridge needs this.
 */
const LEAGUE_BY_TYPE: Record<string, string> = {
  patrol: "patrol-games",
  troop: "troop-challenges",
  exhibition: "exhibition",
};

/**
 * The as-run cartridge is schema 2.9: no leagues or terminology, games typed instead of in a league, and
 * type_defaults keyed by type. Fill it in from the design cartridge, as v1's migration would have.
 */
function upgradeFrom29(
  cartridge: V1Cartridge,
  design: V1Camporee,
): V1Cartridge {
  const camporee = cartridge.camporee as V1Camporee & Partial<V1Camporee>;
  return {
    ...cartridge,
    camporee: {
      ...camporee,
      terminology: design.terminology,
      leagues: design.leagues,
      type_defaults: Object.fromEntries(
        Object.entries(camporee.type_defaults).map(([type, value]) => [
          LEAGUE_BY_TYPE[type] ?? type,
          value,
        ]),
      ),
    },
    games: cartridge.games.map((game) => {
      const { type, ...rest } = game as V1Game & { type: string };
      return { ...rest, league: LEAGUE_BY_TYPE[type] ?? type };
    }),
  };
}

// --- main -------------------------------------------------------------------------------------------

function write(dir: URL, cartridge: V1Cartridge): void {
  const overlay = parseV1Overlay(
    JSON.parse(readFileSync(new URL("overlay.json", dir), "utf8")),
  );
  const { event, commonFieldSet, activities, skipped } = importV1(
    cartridge,
    overlay,
  );
  if (skipped.length > 0)
    throw new Error(`skipped: ${JSON.stringify(skipped)}`);
  const out = (path: string, doc: unknown): void => {
    writeFileSync(new URL(path, dir), `${JSON.stringify(doc, null, 2)}\n`);
  };
  mkdirSync(new URL("activities/", dir), { recursive: true });
  out("event.json", event);
  out("common-fields.json", commonFieldSet);
  for (const activity of activities) {
    out(`activities/${activity.slug}.json`, activity);
  }
  console.log(
    `${dir.pathname}: wrote event, common field set and ${activities.length} activities`,
  );
}

// Design: the v1 cartridge + overlay.json (Top Dog, primary metrics, Program Guide, Common Field fixes).
const DESIGN_DIR = new URL("circus-2026/", FIXTURES);
const designCartridge = readCartridge(DESIGN_DIR);
write(DESIGN_DIR, designCartridge);

// As run: the schema 2.9 cartridge, upgraded, + its overlay.json (naming and the Common Field fixes,
// which change labels and placeholders, never scores).
const AS_RUN_DIR = new URL("circus-2026-as-run/", FIXTURES);
write(
  AS_RUN_DIR,
  upgradeFrom29(readCartridge(AS_RUN_DIR), designCartridge.camporee),
);
