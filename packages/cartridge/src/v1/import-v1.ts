import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
  OfficialSchema,
  OfficialsSchema,
  SCHEMA_VERSION,
  type Activity,
  type CommonFieldSet,
  type Competition,
  type Event,
  type Official,
  type Officials,
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
  /** The v1 cartridge's Officials, for the event-day cartridge only (ADR-0027 item 5). None listed: absent. */
  officials?: Officials;
  /** Unfinished games left out, and why. `strict` turns any of these into a refusal. */
  skipped: SkippedGame[];
  /** What else didn't come across, in plain words. Never contains contact details. */
  notes: string[];
}

export interface SkippedGame {
  /** The v1 game id. */
  game: string;
  reason: string;
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
  { strict = false }: { strict?: boolean } = {},
): V1ImportResult {
  const { camporee, presets, games } = cartridge;
  const id = (key: string) =>
    stableUuid7(options.idNamespace, key, options.idTimestamp);
  const notes: string[] = [];
  const skipped: SkippedGame[] = [];
  const issues: string[] = [];

  // Event-level problems refuse the whole import.
  const gameById = new Map(games.map((g) => [g.id, g]));
  const leagueIds = new Set(camporee.leagues.map((l) => l.id));
  const enabled = camporee.playlist.filter((e) => e.enabled !== false);
  for (const entry of enabled) {
    const game = gameById.get(entry.gameId);
    if (!game) {
      issues.push(`playlist: no game file for ${entry.gameId}`);
    } else if (!leagueIds.has(game.league)) {
      issues.push(
        `game ${game.id}: league "${game.league}" isn't one of the cartridge's leagues`,
      );
    } else if (game.bracketMode) {
      issues.push(
        `game ${game.id}: bracket mode isn't supported in v2; turn it off in v1's Composer`,
      );
    }
  }
  const commonFieldSet = check(
    CommonFieldSetSchema,
    toCommonFieldSet(presets, id, options),
    "common fields",
    issues,
  );
  if (!commonFieldSet || issues.length > 0) throw new V1ImportError(issues);

  const listed = new Set(camporee.playlist.map((e) => e.gameId));
  const unlisted = games.filter((g) => !listed.has(g.id));
  if (unlisted.length > 0) {
    notes.push(
      `Left out ${count(unlisted.length, "game file")} not in the v1 playlist: ${unlisted.map((g) => g.id).join(", ")}.`,
    );
  }

  // Unfinished games are skipped: designs stay unfinished until about April.
  const kept: V1Camporee["playlist"] = [];
  const activities: Activity[] = [];
  for (const entry of enabled) {
    const game = gameById.get(entry.gameId);
    if (!game) continue;
    const problems: string[] = [];
    const activity = check(ActivitySchema, toActivity(game, id), "", problems);
    if (activity) {
      kept.push(entry);
      activities.push(activity);
    } else {
      skipped.push({
        game: game.id,
        reason: `unfinished: ${problems.map((p) => p.replace(/^: /, "")).join("; ")}`,
      });
    }
  }
  // Games v1's playlist disables come across as disabled Activities (ADR-0029 item 9), when they're valid ones:
  // information, never skips, and never refused by strict.
  const disabled = camporee.playlist.filter((e) => e.enabled === false);
  const disabledKept: string[] = [];
  const disabledLeft: string[] = [];
  for (const entry of disabled) {
    const game = gameById.get(entry.gameId);
    const activity =
      game && leagueIds.has(game.league) && !game.bracketMode
        ? check(ActivitySchema, toActivity(game, id), "", [])
        : undefined;
    if (activity) {
      kept.push(entry);
      activities.push(activity);
      disabledKept.push(entry.gameId);
    } else {
      disabledLeft.push(entry.gameId);
    }
  }
  if (disabledKept.length > 0) {
    notes.push(
      `Imported ${count(disabledKept.length, "game")} the v1 playlist disables, as disabled: ${disabledKept.join(", ")}.`,
    );
  }
  if (disabledLeft.length > 0) {
    notes.push(
      `Left out ${count(disabledLeft.length, "disabled game")} that isn't a valid v2 Activity: ${disabledLeft.join(", ")}.`,
    );
  }
  kept.sort((a, b) => a.order - b.order);
  activities.sort((a, b) => a.slug.localeCompare(b.slug));
  if (strict && skipped.length > 0) {
    throw new V1ImportError(
      skipped.map((s) => `strict: ${s.game} would be skipped (${s.reason})`),
    );
  }

  const event = check(
    EventSchema,
    toEvent(camporee, kept, gameById, commonFieldSet, id, options, notes),
    "event",
    issues,
  );
  if (!event) throw new V1ImportError(issues);

  const officials = toOfficials(camporee, event, id, options, notes);
  if (cartridge.assetNames && cartridge.assetNames.length > 0) {
    notes.push(
      `Skipped ${count(cartridge.assetNames.length, "asset")}: v2 has no asset import yet (#7).`,
    );
  }
  notes.push(...unresolvedVariables(event, commonFieldSet, activities));
  return {
    event,
    commonFieldSet,
    activities,
    ...(officials && { officials }),
    skipped,
    notes,
  };
}

/**
 * v1's Officials (the event's owner as "director", collaborators marked Official) → an Officials document.
 * An entry without a valid email can't sign in on the Collator, so it's left out with a note that counts
 * but never names it. The same email twice is one Official, Director if either says so.
 */
function toOfficials(
  camporee: V1Camporee,
  event: Event,
  id: (key: string) => string,
  options: V1ImportOptions,
  notes: string[],
): Officials | undefined {
  const listed = camporee.officials ?? [];
  if (listed.length === 0) return undefined;
  const byEmail = new Map<string, Official>();
  let unusable = 0;
  for (const v1 of listed) {
    const official = OfficialSchema.safeParse({
      email: v1.email?.trim(),
      ...(v1.display_name?.trim() && { name: v1.display_name.trim() }),
      role: v1.role === "director" ? "director" : "official",
    });
    if (!official.success) {
      unusable++;
      continue;
    }
    const key = official.data.email.toLowerCase();
    const seen = byEmail.get(key);
    if (!seen) byEmail.set(key, official.data);
    else if (official.data.role === "director") seen.role = "director";
  }
  if (unusable > 0) {
    notes.push(
      `Left out ${count(unusable, "Official")} with no valid email: they can't sign in on the Collator.`,
    );
  }
  return OfficialsSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    kind: "officials",
    id: id("officials"),
    slug: `${options.eventSlug}-officials`,
    title: `${event.title} Officials`,
    eventId: event.id,
    officials: [...byEmail.values()],
  });
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
  notes: string[],
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
    ...eventDates(meta.dates, notes),
    organizerName: meta.director,
    ...eventDetails(meta),
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
      ...(entry.enabled === false && { enabled: false }),
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
export function unresolvedVariables(
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

/**
 * v1's location, introduction and contacts (ADR-0029 item 8), as given: empty strings stay, missing contact
 * fields become "". Contacts are personal data (ADR-0031 rule 4); they go only into the Event itself.
 */
function eventDetails(
  meta: V1Camporee["meta"],
): Pick<Event, "venue" | "introduction" | "contacts"> {
  return {
    ...(meta.location && {
      venue: {
        name: meta.location.name ?? "",
        address: meta.location.address ?? "",
      },
    }),
    ...(typeof meta.introduction === "string" && {
      introduction: meta.introduction,
    }),
    ...(meta.contacts && {
      contacts: meta.contacts.map((c) => ({
        role: c.role ?? "",
        name: c.name ?? "",
        email: c.email ?? "",
        phone: c.phone ?? "",
      })),
    }),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** v1's `meta.dates`: blank ones left out; one that isn't YYYY-MM-DD, or an end before the start, noted. */
function eventDates(
  dates: V1Camporee["meta"]["dates"],
  notes: string[],
): Pick<Event, "startDate" | "endDate"> {
  const read = (value: string | undefined, which: string) => {
    if (value === undefined || value.trim() === "") return undefined;
    if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))) return value;
    notes.push(
      `Left out v1's ${which} date "${value}": not a date (YYYY-MM-DD).`,
    );
    return undefined;
  };
  const start = read(dates?.start, "start");
  let end = read(dates?.end, "end");
  if (start && end && end < start) {
    notes.push(`Left out v1's end date "${end}": it's before the start date.`);
    end = undefined;
  }
  return {
    ...(start && { startDate: start }),
    ...(end && { endDate: end }),
  };
}
