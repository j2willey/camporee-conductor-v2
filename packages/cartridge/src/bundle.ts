import {
  ActivitySchema,
  CommonFieldSetSchema,
  EventSchema,
  isActivityEnabled,
  OfficialsSchema,
  type Activity,
  type CommonFieldSet,
  type Event,
  type Officials,
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

  const event = parse(EventSchema, "event", bundle.event, "event");
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
    bundle.officials === undefined
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
          `event ${event.slug}: activities: no Activity ${id} in the bundle`,
        );
      }
    }
    for (const activity of activities) {
      if (activity && !listed.has(activity.id)) {
        issues.push(`activity ${activity.slug}: not listed in the Event`);
      }
    }
    const setIds = new Set(bundle.commonFieldSets.map(idOf));
    event.competitions.forEach((competition, i) => {
      const setId = competition.commonFields?.setId;
      if (setId && !setIds.has(setId)) {
        issues.push(
          `event ${event.slug}: competitions.${i}.commonFields.setId: no Common Field set ${setId} in the bundle`,
        );
      }
    });
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
