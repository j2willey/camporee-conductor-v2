import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
  isActivityEnabled,
  OfficialsSchema,
  TemplateSchema,
  type Activity,
  type CommonFieldSet,
  type Event,
  type Officials,
  type Template,
} from "@camporee-conductor/schema";
import type { z } from "zod";

/** One Event and every document it references, as read from a cartridge or a directory (ADR-0012). */
export interface EventBundle {
  event: unknown;
  activities: unknown[];
  commonFieldSets: unknown[];
  /** The Event's Officials: event-day cartridges only (ADR-0027 item 5). */
  officials?: unknown;
}

export interface CheckedBundle {
  event: Event;
  activities: Activity[];
  commonFieldSets: CommonFieldSet[];
  officials?: Officials;
}

export type BundleCheck =
  | {
      ok: true;
      /** Parsed by `packages/schema` (defaults applied): for reading. */
      bundle: CheckedBundle;
      /** The documents exactly as given: for storing (ADR-0012: no defaults added). */
      raw: EventBundle;
    }
  | { ok: false; issues: string[] };

/**
 * The rules every Event bundle must pass, wherever it's loaded: the Composer's import and the Collator's
 * cartridge load use this one function (issue #8). Each document validates; the Event lists exactly the
 * Activities in the bundle; every Common Field set the Event uses is there. All problems are reported,
 * one line each, naming the document.
 */
export function checkEventBundle(bundle: EventBundle): BundleCheck {
  return checkBundle(bundle, EventSchema, "event") as BundleCheck;
}

/** A Template, with the documents it references: no Officials, ever (ADR-0031 rule 4). */
export interface CheckedTemplateBundle {
  /** The Template, under the bundle's `event` key: Event-shaped (ADR-0017). */
  event: Template;
  activities: Activity[];
  commonFieldSets: CommonFieldSet[];
}

export type TemplateBundleCheck =
  | { ok: true; bundle: CheckedTemplateBundle; raw: EventBundle }
  | { ok: false; issues: string[] };

/**
 * The Event bundle rules for a Template (ADR-0031 item 7, #102 PR 4): the main document must pass the Template
 * schema (so no contacts), and the bundle never holds Officials. Problems name the Template.
 */
export function checkTemplateBundle(bundle: EventBundle): TemplateBundleCheck {
  const check = checkBundle(bundle, TemplateSchema, "template");
  if (bundle.officials === undefined) return check as TemplateBundleCheck;
  const officials =
    "officials: Officials are never in a Template (ADR-0031 rule 4)";
  return {
    ok: false,
    issues: [...(check.ok ? [] : check.issues), officials],
  };
}

/** The shared rules, with the main document's schema and the kind its problems are named by. */
function checkBundle(
  bundle: EventBundle,
  mainSchema: typeof EventSchema | typeof TemplateSchema,
  mainKind: "event" | "template",
): BundleCheck | TemplateBundleCheck {
  const issues: string[] = [];
  const parse = <S extends z.ZodType>(
    schema: S,
    kind: string,
    raw: unknown,
    fallbackName: string,
  ): z.infer<S> | undefined => {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    const name = slugOf(raw) ?? fallbackName;
    for (const issue of result.error.issues) {
      issues.push(
        `${kind} ${name}: ${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
      );
    }
    return undefined;
  };

  // Event-shaped either way (ADR-0017): the rules below read the same fields.
  const event = parse(mainSchema, mainKind, bundle.event, mainKind) as
    Event | undefined;
  const activities = bundle.activities.map((raw, i) =>
    parse(ActivitySchema, "activity", raw, `activities[${i}]`),
  );
  const sets = bundle.commonFieldSets.map((raw, i) =>
    parse(
      CommonFieldSetSchema,
      "common-field-set",
      raw,
      `common-field-sets[${i}]`,
    ),
  );

  const officials =
    bundle.officials === undefined || mainKind === "template"
      ? undefined
      : parse(OfficialsSchema, "officials", bundle.officials, "officials");

  if (event) {
    if (officials && officials.eventId !== event.id) {
      issues.push(
        `officials ${officials.slug}: eventId: not this Event (${event.slug})`,
      );
    }
    // Ids as given, so an invalid Activity isn't also reported as missing.
    const activityIds = new Set(bundle.activities.map(idOf));
    const listed = new Set(event.activities.map((a) => a.activityId));
    for (const id of listed) {
      if (!activityIds.has(id)) {
        issues.push(
          `${mainKind} ${event.slug}: activities: no Activity ${id} in the bundle`,
        );
      }
    }
    for (const activity of activities) {
      if (activity && !listed.has(activity.id)) {
        issues.push(
          `activity ${activity.slug}: not listed in the ${mainKind === "event" ? "Event" : "Template"}`,
        );
      }
    }
    const setIds = new Set(bundle.commonFieldSets.map(idOf));
    event.competitions.forEach((competition, i) => {
      const setId = competition.commonFields?.setId;
      if (setId && !setIds.has(setId)) {
        issues.push(
          `${mainKind} ${event.slug}: competitions.${i}.commonFields.setId: no Common Field set ${setId} in the bundle`,
        );
      }
    });
    issues.push(...commonFieldIssues(event, activities, sets, mainKind));
  }

  if (issues.length > 0 || !event) return { ok: false, issues };
  return {
    ok: true,
    bundle: {
      event,
      activities: activities.filter((a): a is Activity => a !== undefined),
      commonFieldSets: sets.filter((s): s is CommonFieldSet => s !== undefined),
      ...(officials && { officials }),
    },
    raw: bundle,
  };
}

/**
 * Common Fields must resolve at runtime (ADR-0020, #99): each Competition's before/after ids are in its set,
 * none twice; every Competition uses the same set (a cartridge holds one); and no Activity has a field with
 * the id of a Common Field its Competition applies, so no Activity ever contains a Common Field. Sets that
 * are missing or invalid are reported elsewhere and skipped here.
 */
function commonFieldIssues(
  event: Event,
  activities: readonly (Activity | undefined)[],
  sets: readonly (CommonFieldSet | undefined)[],
  mainKind: "event" | "template",
): string[] {
  const issues: string[] = [];
  const byId = new Map(
    sets.filter((s) => s !== undefined).map((s) => [s.id, s]),
  );
  const firstSetId = event.competitions.find((c) => c.commonFields)
    ?.commonFields?.setId;
  const applied = new Map<string, { slug: string; ids: Set<string> }>();
  event.competitions.forEach((competition, i) => {
    const ref = competition.commonFields;
    if (!ref) return;
    const where = `${mainKind} ${event.slug}: competitions.${i}.commonFields`;
    if (ref.setId !== firstSetId) {
      issues.push(
        `${where}.setId: every Competition must use the same Common Field set (${firstSetId})`,
      );
    }
    const set = byId.get(ref.setId);
    const seen = new Set<string>();
    for (const position of ["before", "after"] as const) {
      ref[position].forEach((id, j) => {
        if (set && !set.fields.some((f) => f.id === id)) {
          issues.push(
            `${where}.${position}.${j}: the Common Field set has no field ${id}`,
          );
        } else if (seen.has(id)) {
          issues.push(`${where}.${position}.${j}: ${id} is listed twice`);
        }
        seen.add(id);
      });
    }
    applied.set(competition.id, { slug: competition.slug, ids: seen });
  });
  const competitionOf = new Map(
    event.activities.map((a) => [a.activityId, a.competitionId]),
  );
  for (const activity of activities) {
    if (!activity) continue;
    const common = applied.get(competitionOf.get(activity.id) ?? "");
    if (!common) continue;
    activity.scoring.fields.forEach((field, j) => {
      if (common.ids.has(field.id)) {
        issues.push(
          `activity ${activity.slug}: scoring.fields.${j}.id: ${field.id} is a Common Field of ${common.slug}, applied at runtime; it can't be an Activity field too`,
        );
      }
    });
  }
  return issues;
}

const stringProp = (raw: unknown, key: string): string | undefined => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
const slugOf = (raw: unknown) => stringProp(raw, "slug");
const idOf = (raw: unknown) => stringProp(raw, "id");

/**
 * The bundle without the Event's disabled Activities (ADR-0029 item 9): their entries leave the Event's list
 * and their documents leave the bundle, so the Collator never sees them. Everything else is as given. Call it on
 * a bundle that passed `checkEventBundle`. `left` names the Activities left out, by slug.
 */
export function withoutDisabledActivities(bundle: EventBundle): {
  bundle: EventBundle;
  left: string[];
} {
  const event = bundle.event as {
    activities: { activityId: string; enabled?: boolean }[];
  };
  const disabled = new Set(
    event.activities
      .filter((entry) => !isActivityEnabled(entry))
      .map((entry) => entry.activityId),
  );
  if (disabled.size === 0) return { bundle, left: [] };
  const left = bundle.activities
    .filter((doc) => disabled.has(idOf(doc) ?? ""))
    .map((doc) => slugOf(doc) ?? idOf(doc) ?? "?")
    .sort();
  return {
    bundle: {
      ...bundle,
      event: {
        ...event,
        activities: event.activities.filter((e) => !disabled.has(e.activityId)),
      },
      activities: bundle.activities.filter(
        (doc) => !disabled.has(idOf(doc) ?? ""),
      ),
    },
    left,
  };
}

/**
 * The bundle without personal data (ADR-0031 rule 4): the Event's `contacts` and its Officials document go.
 * Every export other than the Event's own design and event-day cartridges calls this: Templates, library
 * documents, single-Activity exports and demo data (#102, #103). The bundle given is left alone.
 */
export function stripPersonalData(bundle: EventBundle): EventBundle {
  const event =
    typeof bundle.event === "object" && bundle.event !== null
      ? Object.fromEntries(
          Object.entries(bundle.event).filter(([key]) => key !== "contacts"),
        )
      : bundle.event;
  return {
    event,
    activities: bundle.activities,
    commonFieldSets: bundle.commonFieldSets,
  };
}
