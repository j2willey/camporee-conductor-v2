import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
  SCHEMA_VERSION,
  type Activity,
  type CommonFieldSet,
  type Competition,
  type Event,
  type ScoringField,
} from "@camporee-conductor/schema";
import type { z } from "zod";
import { stableUuid7 } from "./stable-id.ts";
import type { V1Camporee, V1Cartridge, V1Game, V1Input } from "./types.ts";

/** How ids, slugs and the Common Field set are named. `defaultV1ImportOptions` gives the usual ones. */
export interface V1ImportOptions {
  /** Keeps ids distinct between events and stable across re-imports of the same event. */
  idNamespace: string;
  /** The UUID v7 timestamp, fixed so re-importing gives the same ids (ms since the epoch). */
  idTimestamp: number;
  eventSlug: string;
  commonFieldSet: { slug: string; title: string };
}

/** The cartridge can't be imported; `issues` says why, one line per problem, naming the game. */
export class V1ImportError extends Error {
  override name = "V1ImportError";
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`v1 import refused:\n${issues.join("\n")}`);
    this.issues = issues;
  }
}

/** Parses `value` with `schema`, or records each problem as "<name>: <path>: <message>". */
function check<S extends z.ZodType>(
  schema: S,
  value: unknown,
  name: string,
  issues: string[],
): z.infer<S> | undefined {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    issues.push(`${name}: ${path}${issue.message}`);
  }
  return undefined;
}

export interface V1ImportResult {
  event: Event;
  commonFieldSet: CommonFieldSet;
  /** Sorted by slug. */
  activities: Activity[];
  /** What didn't come across, in plain words. Never contains contact details. */
  notes: string[];
}

/**
 * The usual options for a v1 event: ids namespaced by its v1 id and timestamped 1 January of its year,
 * so every re-import of the same event gets the same ids; slugs from its title.
 */
export function defaultV1ImportOptions(
  meta: V1Camporee["meta"],
): V1ImportOptions {
  const eventSlug = slugify(meta.title);
  return {
    idNamespace: `v1:${meta.camporeeId}`,
    idTimestamp: Date.UTC(meta.year, 0, 1),
    eventSlug,
    commonFieldSet: {
      slug: `${eventSlug}-common-fields`,
      title: `${meta.title} Common Fields`,
    },
  };
}

/**
 * v1 Official-only presets that v2's scoring pipeline replaces (Official Final Ranking, placement
 * points: ADR-0019), and the bracket preset (v2 has no bracket mode).
 */
const DROPPED_PRESETS = new Set([
  "off_score",
  "final_rank",
  "overall_points",
  "bracket_result",
]);

/** v1 content keys that become custom sections when they have text. */
const CUSTOM_SECTIONS = [
  ["instructions", "Instructions"],
  ["scoring_notes", "Scoring Notes"],
  ["references", "References"],
] as const;

/**
 * A v1 cartridge (schema 3.0) → v2 documents (issue #46). Mechanical only: every rule here holds for
 * any v1 event. Event-specific design choices v1 can't express (Awards, primary metrics, Program Guide
 * settings) are applied after this. See fixtures/circus-2026/TRANSCODE-NOTES.md for each rule's reason.
 */
export function importV1Cartridge(
  cartridge: V1Cartridge,
  options: V1ImportOptions,
): V1ImportResult {
  const { camporee, presets, games } = cartridge;
  const id = (key: string) =>
    stableUuid7(options.idNamespace, key, options.idTimestamp);
  const notes: string[] = [];

  const gameById = new Map(games.map((g) => [g.id, g]));
  const playlist = camporee.playlist.filter((entry) => entry.enabled !== false);
  const disabled = camporee.playlist.filter((e) => e.enabled === false);
  if (disabled.length > 0) {
    notes.push(
      `Skipped ${count(disabled.length, "game")} the v1 playlist disables: ${disabled.map((e) => e.gameId).join(", ")}.`,
    );
  }
  const issues: string[] = [];
  for (const entry of playlist) {
    if (!gameById.has(entry.gameId)) {
      issues.push(`playlist: no game file for ${entry.gameId}`);
    }
  }
  const listed = new Set(camporee.playlist.map((e) => e.gameId));
  const unlisted = games.filter((g) => !listed.has(g.id));
  if (unlisted.length > 0) {
    notes.push(
      `Skipped ${count(unlisted.length, "game file")} not in the v1 playlist: ${unlisted.map((g) => g.id).join(", ")}.`,
    );
  }
  const leagueIds = new Set(camporee.leagues.map((l) => l.id));
  for (const entry of playlist) {
    const game = gameById.get(entry.gameId);
    if (game && !leagueIds.has(game.league)) {
      issues.push(
        `game ${game.id}: league "${game.league}" isn't one of the cartridge's leagues`,
      );
    }
  }
  if (issues.length > 0) throw new V1ImportError(issues);

  const commonFieldSet = check(
    CommonFieldSetSchema,
    toCommonFieldSet(presets, id, options),
    "common fields",
    issues,
  );
  const activities = playlist
    .map((entry) => gameById.get(entry.gameId))
    .filter((g): g is V1Game => g !== undefined)
    .map((game) =>
      check(
        ActivitySchema,
        toActivity(game, id),
        `activity ${game.id}`,
        issues,
      ),
    )
    .filter((a): a is Activity => a !== undefined)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (!commonFieldSet || issues.length > 0) throw new V1ImportError(issues);
  const event = check(
    EventSchema,
    toEvent(camporee, playlist, gameById, commonFieldSet, id, options),
    "event",
    issues,
  );
  if (!event) throw new V1ImportError(issues);

  if (camporee.officials && camporee.officials.length > 0) {
    notes.push(
      `Dropped ${count(camporee.officials.length, "Official")} from the v1 cartridge: v2 doesn't import them yet (#39).`,
    );
  }
  if (cartridge.assetNames && cartridge.assetNames.length > 0) {
    notes.push(
      `Skipped ${count(cartridge.assetNames.length, "asset")}: v2 has no asset import yet (#7).`,
    );
  }
  notes.push(...unresolvedVariables(event, commonFieldSet, activities));
  return { event, commonFieldSet, activities, notes };
}

function toCommonFieldSet(
  presets: V1Input[],
  id: (key: string) => string,
  options: V1ImportOptions,
): CommonFieldSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "common-field-set",
    id: id("common-field-set"),
    slug: options.commonFieldSet.slug,
    title: options.commonFieldSet.title,
    fields: presets
      .filter((p) => !DROPPED_PRESETS.has(p.id))
      .map((p, i) => toField(p, i)),
    legacy: { v1Id: "presets.json" },
  };
}

function toEvent(
  camporee: V1Camporee,
  playlist: V1Camporee["playlist"],
  gameById: Map<string, V1Game>,
  set: CommonFieldSet,
  id: (key: string) => string,
  options: V1ImportOptions,
): Event {
  const keptFieldIds = new Set(set.fields.map((f) => f.id));
  const competitions: Competition[] = camporee.leagues.map((league) => {
    const defaults = camporee.type_defaults[league.id] ?? {
      prefix: [],
      suffix: [],
    };
    const before = defaults.prefix.filter((f) => keptFieldIds.has(f));
    const after = defaults.suffix.filter((f) => keptFieldIds.has(f));
    const competition: Competition = {
      id: id(`competition:${league.id}`),
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

  const { meta, terminology } = camporee;
  const styles = meta.awards_config.styles;
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "event",
    id: id("event"),
    slug: options.eventSlug,
    title: meta.title,
    theme: meta.theme,
    year: meta.year,
    organizerName: meta.director,
    terminology: {
      pack: "scouting",
      labels: {
        group: terminology.unit,
        team: terminology.subunit,
        participant: terminology.member,
        event: terminology.event,
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
    activities: playlist.map((entry) => ({
      activityId: id(`activity:${entry.gameId}`),
      competitionId: id(`competition:${gameById.get(entry.gameId)?.league}`),
      sortOrder: entry.order,
    })),
    // v1 always numbered ties densely; recorded rather than left to the default (ADR-0019).
    tieNumbering: "dense",
    legacy: { v1Id: meta.camporeeId },
  };
}

function toActivity(game: V1Game, id: (key: string) => string): Activity {
  const c = game.content;
  const customSections = CUSTOM_SECTIONS.filter(([key]) =>
    text(c[key]).trim(),
  ).map(([key, title]) => ({ title, body: text(c[key]) }));
  const tags = Array.isArray(c["tags"]) ? c["tags"] : [];
  const legacy: NonNullable<Activity["legacy"]> = {
    v1Id: game.id,
    v1ScoringMethod: game.scoring_model.method,
  };
  if (game.library_uuid) legacy.v1LibraryUuid = game.library_uuid;
  if (game.library_title) legacy.v1LibraryTitle = game.library_title;

  const activity: Activity = {
    schemaVersion: SCHEMA_VERSION,
    kind: "activity",
    id: id(`activity:${game.id}`),
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
    scoring: { fields: game.scoring_model.inputs.map(toField) },
    legacy,
  };
  if (customSections.length > 0)
    activity.content.customSections = customSections;
  if (game.variables && Object.keys(game.variables).length > 0) {
    activity.variables = game.variables;
  }
  if (tags.length > 0) activity.tags = tags;
  return activity;
}

/** A v1 input or preset → a v2 scoring field. */
function toField(input: V1Input, index: number): ScoringField {
  const config: NonNullable<ScoringField["config"]> = {};
  const c = input.config ?? {};
  if (c.min !== undefined) config.min = c.min;
  if (c.max !== undefined) config.max = c.max;
  if (c.placeholder !== undefined) config.placeholder = c.placeholder;
  if (c.options !== undefined) config.options = c.options;
  if (c.defaultValue !== undefined) {
    // v1 stored booleans as defaults on some number fields; v2 needs a number.
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
    // v1 never applied weight in any total or ranking, so its results used 1. Kept for reference only.
    weight: 1,
    legacy: { v1Weight: input.weight },
  };
  if (input.required !== undefined) field.required = input.required;
  if (Object.keys(config).length > 0) field.config = config;
  return field;
}

/**
 * v1 free-text supplies → a structured list. Splits "item: quantity" on the last colon. A line ending
 * in ":" is a group heading for the lines after it; an indented line starting with "(" continues the
 * item above.
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

/** One note per Common Field and {{variable}} that some of a Competition's Activities don't define. */
function unresolvedVariables(
  event: Event,
  set: CommonFieldSet,
  activities: Activity[],
): string[] {
  const fieldById = new Map(set.fields.map((f) => [f.id, f]));
  const activityById = new Map(activities.map((a) => [a.id, a]));
  const notes: string[] = [];
  for (const competition of event.competitions) {
    const used = [
      ...(competition.commonFields?.before ?? []),
      ...(competition.commonFields?.after ?? []),
    ];
    const members = event.activities
      .filter((e) => e.competitionId === competition.id)
      .map((e) => activityById.get(e.activityId))
      .filter((a): a is Activity => a !== undefined);
    for (const fieldId of used) {
      const field = fieldById.get(fieldId);
      if (!field) continue;
      const tokens = new Set(
        [field.label, field.config?.placeholder ?? ""].flatMap((s) =>
          [...s.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(
            (m) => m[1] ?? "",
          ),
        ),
      );
      for (const token of tokens) {
        const lacking = members.filter((a) => !(token in (a.variables ?? {})));
        if (lacking.length === 0) continue;
        const verb = lacking.length === 1 ? "doesn't" : "don't";
        notes.push(
          `Common Field ${fieldId} uses {{${token}}}, which ${count(lacking.length, "Activity", "Activities")} in ${competition.label} ${verb} define: ${lacking.map((a) => a.slug).join(", ")}.`,
        );
      }
    }
  }
  return notes;
}

const text = (value: string | string[] | undefined): string =>
  typeof value === "string" ? value : "";

const count = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** "Spring Field Day 2027" → "spring-field-day-2027". */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
