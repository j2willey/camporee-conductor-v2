// One-time transcode of the Circus 2026 v1 cartridge (schema 3.0) into v4 documents.
// Not a general v1 importer (issue #2). Kept so the fixtures are reproducible; see
// fixtures/circus-2026/TRANSCODE-NOTES.md for everything that didn't map cleanly.
// Run: node packages/schema/scripts/transcode-circus-2026.ts
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { ActivitySchema, type Activity } from "../src/activity.ts";
import { SCHEMA_VERSION } from "../src/common.ts";
import {
  CommonFieldSetSchema,
  type CommonFieldSet,
} from "../src/common-field-set.ts";
import { EventSchema, type Competition, type Event } from "../src/event.ts";
import type { ScoringField } from "../src/field.ts";

// --- v1 shapes: only the parts this transcode reads -------------------------

interface V1Input {
  id: string;
  label: string;
  type: ScoringField["type"];
  kind: ScoringField["kind"];
  audience: "judge" | "admin";
  sortOrder?: number;
  weight: number;
  required?: boolean;
  config?: {
    min?: number;
    max?: number;
    placeholder?: string;
    defaultValue?: number | string | boolean;
    options?: string[];
  };
}

interface V1Game {
  id: string;
  league: string;
  library_uuid: string;
  library_title: string;
  variables?: Record<string, string>;
  content: Record<string, string | string[] | undefined>;
  scoring_model: { method: "points_desc" | "timed_asc"; inputs: V1Input[] };
}

interface V1Camporee {
  meta: {
    title: string;
    theme: string;
    year: number;
    director: string;
    camporeeId: string;
    theme_colors: { main: string; header: string; accent: string };
    awards_config: {
      line1: string;
      line2: string;
      sync: boolean;
      styles: Record<
        "1" | "2" | "3" | "4",
        { font: string; size: string; bold: boolean }
      >;
    };
  };
  terminology: { unit: string; subunit: string; member: string; event: string };
  leagues: {
    id: string;
    label: string;
    tier: "unit" | "subunit";
    registration: "registered" | "open";
  }[];
  type_defaults: Record<string, { prefix: string[]; suffix: string[] }>;
  playlist: { gameId: string; order: number }[];
}

// --- helpers -----------------------------------------------------------------

const SOURCE = new URL("../fixtures/circus-2026/v1-source/", import.meta.url);
const OUT = new URL("../fixtures/circus-2026/", import.meta.url);

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(path, SOURCE), "utf8")) as T;

/**
 * Deterministic UUID v7, so re-running the transcode doesn't churn ids. The timestamp is
 * fixed at the transcode date; the remaining bits come from a hash of `key`.
 */
function fixtureUuid7(key: string): string {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(Date.UTC(2026, 9, 30), 0, 6);
  createHash("sha256")
    .update(`circus-2026:${key}`)
    .digest()
    .copy(bytes, 6, 0, 10);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6); // version 7
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8); // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const text = (value: string | string[] | undefined): string =>
  typeof value === "string" ? value : "";

/**
 * v1 free-text supplies → structured list. Splits "item: quantity" on the last colon.
 * A line ending in ":" is a group heading for the lines after it; an indented line starting
 * with "(" continues the previous item.
 */
function parseSupplies(suppliesText: string): Activity["content"]["supplies"] {
  const supplies: Activity["content"]["supplies"] = [];
  let group: string | undefined;
  for (const raw of suppliesText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const previous = supplies.at(-1);
    if (/^\s/.test(raw) && line.startsWith("(") && previous) {
      previous.item = `${previous.item} ${line}`;
      continue;
    }
    if (line.endsWith(":")) {
      group = line.slice(0, -1).trim();
      continue;
    }
    const colon = line.lastIndexOf(":");
    const item = colon === -1 ? line : line.slice(0, colon).trim();
    const quantity = colon === -1 ? "" : line.slice(colon + 1).trim();
    supplies.push({
      ...(group ? { group } : {}),
      item,
      ...(quantity ? { quantity } : {}),
    });
  }
  return supplies;
}

/** v1 input or preset → v4 scoring field. */
function toField(input: V1Input, index: number): ScoringField {
  const config: NonNullable<ScoringField["config"]> = {};
  const c = input.config ?? {};
  if (c.min !== undefined) config.min = c.min;
  if (c.max !== undefined) config.max = c.max;
  if (c.placeholder !== undefined) config.placeholder = c.placeholder;
  if (c.options !== undefined) config.options = c.options;
  if (c.defaultValue !== undefined) {
    // v1 stored booleans as defaults on some number fields; v4 requires a number.
    const numeric = input.type === "number" || input.type === "stopwatch";
    config.defaultValue =
      numeric && typeof c.defaultValue === "boolean"
        ? Number(c.defaultValue)
        : c.defaultValue;
  }
  const field: ScoringField = {
    // v1's Composer generated some ids with a trailing space ("field_1778195167953 ").
    id: input.id.trim(),
    label: input.label,
    type: input.type,
    kind: input.kind,
    audience: input.audience === "admin" ? "official" : "judge",
    // Some v1 inputs have no sortOrder; v1 used array position.
    sortOrder: input.sortOrder ?? (index + 1) * 10,
    weight: input.weight,
  };
  if (input.required !== undefined) field.required = input.required;
  if (Object.keys(config).length > 0) field.config = config;
  return field;
}

const CUSTOM_SECTIONS = [
  ["instructions", "Instructions"],
  ["scoring_notes", "Scoring Notes"],
  ["references", "References"],
] as const;

function toActivity(game: V1Game): Activity {
  const c = game.content;
  const customSections = CUSTOM_SECTIONS.filter(([key]) =>
    text(c[key]).trim(),
  ).map(([key, title]) => ({ title, body: text(c[key]) }));
  const tags = Array.isArray(c["tags"]) ? c["tags"] : [];
  const legacy: NonNullable<Activity["legacy"]> = { v1Id: game.id };
  if (game.library_uuid) legacy.v1LibraryUuid = game.library_uuid;
  if (game.library_title) legacy.v1LibraryTitle = game.library_title;

  const activity: Activity = {
    schemaVersion: SCHEMA_VERSION,
    kind: "activity",
    id: fixtureUuid7(`activity:${game.id}`),
    slug: game.id,
    title: text(c["title"]),
    scoringType: game.league === "exhibition" ? "exhibition" : "ranked",
    content: {
      story: text(c["story"]),
      objective: text(c["challenge"]),
      description: text(c["description"]),
      rules: (Array.isArray(c["rules"]) ? c["rules"] : [])
        .map((r) => r.trim())
        .filter((r) => r.length > 0),
      timeAndScoring: text(c["time_and_scoring"]),
      setup: text(c["setup"]),
      reset: text(c["reset"]),
      staffing: text(c["staffing"]),
      supplies: parseSupplies(text(c["supplies_text"])),
      notes: text(c["notes"]),
    },
    scoring: {
      direction:
        game.scoring_model.method === "timed_asc"
          ? "lower-wins"
          : "higher-wins",
      fields: game.scoring_model.inputs.map(toField),
    },
    legacy,
  };
  if (customSections.length > 0)
    activity.content.customSections = customSections;
  if (game.variables && Object.keys(game.variables).length > 0) {
    activity.variables = game.variables;
  }
  if (tags.length > 0) activity.tags = tags;
  return ActivitySchema.parse(activity);
}

// v1 admin presets replaced by the ADR-0019 pipeline (Official Final Ranking, placement
// points), and the bracket preset (no Circus game uses bracket mode).
const DROPPED_PRESETS = new Set([
  "off_score",
  "final_rank",
  "overall_points",
  "bracket_result",
]);

function toCommonFieldSet(presets: V1Input[]): CommonFieldSet {
  const fields = presets
    .filter((p) => !DROPPED_PRESETS.has(p.id))
    .map((p, i) => {
      const field = toField(p, i);
      // v1 bug: the label said {{ten_essentials_item}} but every game defines `ten_essentials`,
      // so v1 printed "10 Essentials: ___". Use the variable name the games actually define.
      field.label = field.label.replace(
        "{{ten_essentials_item}}",
        "{{ten_essentials}}",
      );
      if (field.config?.placeholder) {
        field.config.placeholder = field.config.placeholder.replace(
          "{{ten_essentials_item}}",
          "{{ten_essentials}}",
        );
      }
      return field;
    });
  return CommonFieldSetSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: "common-field-set",
    id: fixtureUuid7("common-field-set"),
    slug: "circus-2026-common-fields",
    title: "Circus 2026 Common Fields",
    fields,
    legacy: { v1Id: "presets.json" },
  });
}

function toEvent(
  camporee: V1Camporee,
  games: V1Game[],
  set: CommonFieldSet,
): Event {
  const keptFieldIds = new Set(set.fields.map((f) => f.id));
  const competitions: Competition[] = camporee.leagues.map((league) => {
    const defaults = camporee.type_defaults[league.id] ?? {
      prefix: [],
      suffix: [],
    };
    const before = defaults.prefix.filter((id) => keptFieldIds.has(id));
    const after = defaults.suffix.filter((id) => keptFieldIds.has(id));
    const competition: Competition = {
      id: fixtureUuid7(`competition:${league.id}`),
      slug: league.id,
      label: league.label,
      level: league.tier === "unit" ? "group" : "team",
      registration: league.registration,
      divisions: [],
      legacy: { v1Id: league.id },
    };
    if (before.length > 0 || after.length > 0) {
      competition.commonFields = { setId: set.id, before, after };
    }
    return competition;
  });

  const competitionIdByLeague = new Map(
    camporee.leagues.map((l) => [l.id, fixtureUuid7(`competition:${l.id}`)]),
  );
  const leagueByGame = new Map(games.map((g) => [g.id, g.league]));
  const { meta } = camporee;
  const styles = meta.awards_config.styles;

  return EventSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: "event",
    id: fixtureUuid7("event"),
    slug: "coyote-creek-camporee-2026",
    title: meta.title,
    theme: meta.theme,
    year: meta.year,
    organizerName: meta.director,
    terminology: {
      pack: "scouting",
      labels: {
        group: camporee.terminology.unit,
        team: camporee.terminology.subunit,
        participant: camporee.terminology.member,
        event: camporee.terminology.event,
      },
    },
    presentation: {
      themeColors: meta.theme_colors,
      awardLabel: {
        line1: meta.awards_config.line1,
        line2: meta.awards_config.line2,
        syncFonts: meta.awards_config.sync,
        styles: {
          line1: styles["1"],
          line2: styles["2"],
          activityName: styles["3"],
          winner: styles["4"],
        },
      },
    },
    competitions,
    activities: camporee.playlist.map((entry) => ({
      activityId: fixtureUuid7(`activity:${entry.gameId}`),
      competitionId: competitionIdByLeague.get(
        leagueByGame.get(entry.gameId) ?? "",
      ),
      sortOrder: entry.order,
    })),
    legacy: { v1Id: meta.camporeeId },
  });
}

// --- main ----------------------------------------------------------------------

const camporee = readJson<V1Camporee>("camporee.json");
const presets = readJson<V1Input[]>("presets.json");
const games = readdirSync(new URL("games/", SOURCE))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => readJson<V1Game>(`games/${f}`));

const set = toCommonFieldSet(presets);
const activities = games.map(toActivity);
const event = toEvent(camporee, games, set);

const write = (path: string, doc: unknown): void => {
  writeFileSync(new URL(path, OUT), `${JSON.stringify(doc, null, 2)}\n`);
};
mkdirSync(new URL("activities/", OUT), { recursive: true });
write("event.json", event);
write("common-fields.json", set);
for (const activity of activities)
  write(`activities/${activity.slug}.json`, activity);
console.log(
  `wrote event, common field set and ${activities.length} activities`,
);
