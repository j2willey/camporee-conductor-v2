// Regenerates the two Circus 2026 fixtures in packages/schema/fixtures from their v1 cartridges, using the
// general v1 importer (issue #46) plus the Circus-only design choices v1 can't express. Re-running it gives
// byte-identical output. See fixtures/circus-2026/TRANSCODE-NOTES.md.
//   circus-2026/         design: the v3 cartridge with Jim's post-event corrections
//   circus-2026-as-run/  as run: the schema 2.9 cartridge the event laptop ran
// Run: node packages/cartridge/scripts/transcode-circus-2026.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
  type Activity,
  type CommonFieldSet,
  type Event,
} from "@camporee-conductor/schema";
import {
  importV1Cartridge,
  stableUuid7,
  type V1Camporee,
  type V1Cartridge,
  type V1Game,
  type V1ImportOptions,
  type V1Input,
} from "../src/index.ts";

const FIXTURES = new URL("../../schema/fixtures/", import.meta.url);
const ID_TIMESTAMP = Date.UTC(2026, 9, 30);

// --- Circus-only design choices (not import rules) ------------------------------------------------

/** v1 modelled Top Dog as a Troop Challenge; it's really an Award (#3). */
const TOP_DOG = "top-dog";

/**
 * Measured Activities: v1 game id → the field listed as its primary metric, and its direction
 * (ADR-0019, Jim 2026-11-02). Not jugglers: its scoring is still TBD.
 */
const PRIMARY_METRICS: Record<
  string,
  { fieldId: string; direction: "lower-wins" | "higher-wins" }
> = {
  "3-ring-circus": { fieldId: "elapsed_time", direction: "lower-wins" },
  "circus-line": { fieldId: "elapsed_time", direction: "lower-wins" },
  "ducks-in-a-row": { fieldId: "total_turns", direction: "lower-wins" },
  "pioneering-train-performance": {
    fieldId: "elapsed_time",
    direction: "lower-wins",
  },
  "setting-up-the-big-top": {
    fieldId: "elapsed_time",
    direction: "lower-wins",
  },
  "sports-land-skis": { fieldId: "elapsed_time", direction: "lower-wins" },
  "the-a-frame-trapeze": { fieldId: "elapsed_time", direction: "lower-wins" },
  "the-barrel-of-monkeys-caravan": {
    fieldId: "elapsed_time",
    direction: "lower-wins",
  },
  "the-high-wire-fire-act": { fieldId: "base_time", direction: "lower-wins" },
  "the-tumbled-trapeze-rescue": {
    fieldId: "elapsed_time",
    direction: "lower-wins",
  },
};

/**
 * The skills the 2026 Program Guide promised units, authored up front (#5, Jim 2026-11-06). Wording
 * lightly normalized from the guide's list.
 */
const PROGRAM_GUIDE_SKILLS = [
  "Fire starting",
  "First aid",
  "Campfire entertainment",
  "Tent assembly",
  "Cooking",
  "Map and compass",
  "Color guard presentation",
  "Fitness",
  "Pioneering",
  "Lashings",
  "Teamwork",
  "Problem solving",
];

/** Competitions whose Activities the guide doesn't list: it publishes before they're final (#5). */
const GUIDE_HIDES_ACTIVITIES = new Set(["patrol-games"]);

/** Two v1 data bugs the design fixes (TRANSCODE-NOTES "Fixed or normalized"). */
function fixCommonFields(set: CommonFieldSet): CommonFieldSet {
  const swap = (s: string) =>
    s.replace("{{ten_essentials_item}}", "{{ten_essentials}}");
  return CommonFieldSetSchema.parse({
    ...set,
    fields: set.fields.map((field) => {
      const fixed = { ...field, label: swap(field.label) };
      if (field.config) {
        fixed.config = { ...field.config };
        if (fixed.config.placeholder !== undefined) {
          fixed.config.placeholder = swap(fixed.config.placeholder);
        }
        // v1 said "0-10 Points", but judges scored with max 5.
        if (field.id === "p_flag") fixed.config.placeholder = "0-5 Points";
      }
      return fixed;
    }),
  });
}

function markPrimaryMetrics(activity: Activity): Activity {
  const primary = PRIMARY_METRICS[activity.slug];
  if (!primary) return activity;
  if (!activity.scoring.fields.some((f) => f.id === primary.fieldId)) {
    throw new Error(
      `primary metric ${activity.slug} ${primary.fieldId} not found`,
    );
  }
  return ActivitySchema.parse({
    ...activity,
    scoring: {
      fields: activity.scoring.fields.map((f) =>
        f.id === primary.fieldId
          ? { ...f, primary: { direction: primary.direction } }
          : f,
      ),
    },
  });
}

function designEvent(event: Event, topDogId: string): Event {
  const troop = event.competitions.find((c) => c.slug === "troop-challenges");
  if (!troop) throw new Error("no troop-challenges Competition");
  return EventSchema.parse({
    ...event,
    competitions: event.competitions.map((c) =>
      GUIDE_HIDES_ACTIVITIES.has(c.slug)
        ? { ...c, programGuide: { listActivities: false } }
        : c,
    ),
    activities: event.activities.filter((e) => e.activityId !== topDogId),
    // Top Dog's own rule: "top 25% of troops by aggregate score, round up".
    awards: [
      {
        id: stableUuid7("circus-2026", `award:${TOP_DOG}`, ID_TIMESTAMP),
        slug: TOP_DOG,
        label: "Top Dog",
        competitionId: troop.id,
        scope: "event",
        rule: { type: "top-percent", percent: 25 },
      },
    ],
    programGuide: { skills: PROGRAM_GUIDE_SKILLS },
  });
}

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

function write(
  dir: URL,
  documents: { event: Event; set: CommonFieldSet; activities: Activity[] },
) {
  const out = (path: string, doc: unknown): void => {
    writeFileSync(new URL(path, dir), `${JSON.stringify(doc, null, 2)}\n`);
  };
  mkdirSync(new URL("activities/", dir), { recursive: true });
  out("event.json", documents.event);
  out("common-fields.json", documents.set);
  for (const activity of documents.activities) {
    out(`activities/${activity.slug}.json`, activity);
  }
}

const options = (
  namespace: string,
  eventSlug: string,
  setSlug: string,
  setTitle: string,
): V1ImportOptions => ({
  idNamespace: namespace,
  idTimestamp: ID_TIMESTAMP,
  eventSlug,
  commonFieldSet: { slug: setSlug, title: setTitle },
});

// Design: the general import, then the Circus design choices.
const DESIGN_DIR = new URL("circus-2026/", FIXTURES);
const designCartridge = readCartridge(DESIGN_DIR);
const design = importV1Cartridge(
  designCartridge,
  options(
    "circus-2026",
    "coyote-creek-camporee-2026",
    "circus-2026-common-fields",
    "Circus 2026 Common Fields",
  ),
);
const topDog = design.activities.find((a) => a.slug === TOP_DOG);
if (!topDog) throw new Error("no top-dog game in the design cartridge");
const designActivities = design.activities
  .filter((a) => a.slug !== TOP_DOG)
  .map(markPrimaryMetrics);
write(DESIGN_DIR, {
  event: designEvent(design.event, topDog.id),
  set: fixCommonFields(design.commonFieldSet),
  activities: designActivities,
});
console.log(
  `circus-2026: wrote event, common field set and ${designActivities.length} activities`,
);

// As run: the general import of the upgraded 2.9 cartridge, with v1's data bugs left as run, except the
// Common Field fixes, which only change labels and placeholders (never scores).
const AS_RUN_DIR = new URL("circus-2026-as-run/", FIXTURES);
const asRun = importV1Cartridge(
  upgradeFrom29(readCartridge(AS_RUN_DIR), designCartridge.camporee),
  options(
    "circus-2026-as-run",
    "coyote-creek-camporee-2026-as-run",
    "circus-2026-as-run-common-fields",
    "Circus 2026 Common Fields (as run)",
  ),
);
write(AS_RUN_DIR, {
  event: asRun.event,
  set: fixCommonFields(asRun.commonFieldSet),
  activities: asRun.activities,
});
console.log(
  `circus-2026-as-run: wrote event, common field set and ${asRun.activities.length} activities`,
);
