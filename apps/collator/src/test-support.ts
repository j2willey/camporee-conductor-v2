import { readdirSync, readFileSync } from "node:fs";
import {
  exportCartridge,
  type CartridgeProfile,
  type EventBundle,
} from "@camporee-conductor/cartridge";
import { openDb, type Db } from "./db/open.ts";

// The Circus 2026 design fixture plus an Officials list: what the Composer exports for event day.
const FIXTURE = new URL(
  "../../../packages/schema/fixtures/circus-2026/",
  import.meta.url,
);
const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));

export const CIRCUS_EVENT_ID = read("event.json")["id"] as string;
/** Some other Event, for "a different cartridge" cases. */
export const OTHER_EVENT_ID = "0196cfa2-4c00-7000-8000-0000000000e1";

export const DIRECTOR_EMAIL = "director@example.com";

type Doc = Record<string, unknown>;

/**
 * The Circus 2026 bundle; `eventId` swaps in another Event id to make a different Event. `editActivity`
 * changes a copy of each Activity document, for test cases the fixture doesn't have (the fixture itself
 * never changes).
 */
export function circusBundle({
  eventId = CIRCUS_EVENT_ID,
  editActivity = (activity) => activity,
}: {
  eventId?: string;
  editActivity?: (activity: Doc) => Doc;
} = {}): EventBundle {
  return {
    event: {
      ...read("event.json"),
      id: eventId,
      ...(eventId !== CIRCUS_EVENT_ID && { slug: "some-other-event" }),
    },
    commonFieldSets: [read("common-fields.json")],
    activities: readdirSync(new URL("activities/", FIXTURE))
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => editActivity(read(`activities/${f}`))),
    officials: {
      schemaVersion: "4.0",
      kind: "officials",
      id: "0196cfa2-4c00-7000-8000-000000000200",
      slug: "circus-officials",
      title: "Circus Officials",
      eventId,
      officials: [
        { email: DIRECTOR_EMAIL, name: "Pat Director", role: "director" },
        { email: "lead.judge@example.com", role: "official" },
      ],
    },
  };
}

export function circusCartridge({
  eventId,
  profile = "event-day",
  editActivity,
}: {
  eventId?: string;
  profile?: CartridgeProfile;
  editActivity?: (activity: Doc) => Doc;
} = {}): Uint8Array {
  return exportCartridge(
    circusBundle({
      ...(eventId !== undefined && { eventId }),
      ...(editActivity && { editActivity }),
    }),
    profile,
    { exportedAt: new Date("2027-05-10T18:00:00Z") },
  );
}

/**
 * An `editActivity` that changes the own fields (not Common Fields) of the Activity with this id: `edit`
 * gets a copy of them and returns the new list.
 */
export function editFields(
  activityId: string,
  edit: (fields: Doc[]) => Doc[],
): (activity: Doc) => Doc {
  return (activity) => {
    if (activity["id"] !== activityId) return activity;
    const scoring = activity["scoring"] as { fields: Doc[] };
    return {
      ...activity,
      scoring: { ...scoring, fields: edit(structuredClone(scoring.fields)) },
    };
  };
}

/** A fresh in-memory Collator database. */
export const testDb = (): Db => openDb(":memory:");

// Circus 2026 ids used by the tests.
/** Clown Car: a Patrol Games Activity, so Team-level, with the Patrol Games Common Fields. */
export const CLOWN_CAR = {
  id: activityIdOf("clown-car"),
  /** One of the Activity's own fields. */
  ownField: "scouts_balanced",
  /** A field from the Competition's `before` Common Fields (ADR-0020). */
  commonField: "p_flag",
};
/** The High Wire Fire Act: Team-level, with one field only Officials enter (`audience: "official"`). */
export const HIGH_WIRE = {
  id: activityIdOf("the-high-wire-fire-act"),
  judgeField: "matches_used",
  officialField: "field_1777494221037",
};
/** Showtime in the Center Ring: Team-level; its `points` number field has no min or max. */
export const SHOWTIME = {
  id: activityIdOf("showtime-in-the-center-ring"),
  unrangedField: "points",
};
/** A Troop Challenges Activity: Group-level. */
export const GROUP_ACTIVITY = activityIdOf("campsite-all-around");

function activityIdOf(slug: string): string {
  return read(`activities/${slug}.json`)["id"] as string;
}
