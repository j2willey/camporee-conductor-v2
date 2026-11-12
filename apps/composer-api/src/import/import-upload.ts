import {
  CartridgeManifestSchema,
  importV1,
  loadCartridge,
  v1ImportOptions,
  V1ImportError,
} from "@camporee-conductor/cartridge";
import { strFromU8, unzipSync } from "fflate";
import { HTTPException } from "hono/http-exception";
import { requireRole } from "../authz.ts";
import type { Db } from "../db/open.ts";
import { audit } from "../documents/save.ts";
import { ImportError, importEvent } from "./import-event.ts";
import { leftoverActivities } from "./leftover-activities.ts";
import { CartridgeReadError, readV1Zip } from "./read-v1-cartridge.ts";

export interface UploadResult {
  eventId: string;
  title: string;
  /** A v2 design cartridge, or a v1 Composer export. */
  source: "cartridge" | "v1";
  created: number;
  updated: number;
  /** v1 only: unfinished games left out, and why. */
  skipped: { game: string; reason: string }[];
  /** v1 only: what else didn't come across. */
  notes: string[];
  /** v1 only: Activities an earlier import left that the cartridge no longer has (kept, unlisted). */
  leftovers: { slug: string; title: string }[];
}

/**
 * Imports an uploaded zip into an Organization (#100 PR 2), the browser's `import-event` / `import-v1`: a v2
 * **design** cartridge (it has `manifest.json`) through `loadCartridge`, or a v1 Composer export (it has
 * `camporee.json`) through `importV1`, without an overlay. Event-day cartridges are refused: they're for the box,
 * and leave out disabled Activities, so importing one would drop them from the design. Editors and owners.
 * All or nothing; any problem is a 422 naming the file and each problem, one per line.
 */
export function importUpload(
  db: Db,
  {
    organizationId,
    userId,
    name,
    bytes,
    now,
  }: {
    organizationId: string;
    userId: string;
    name: string;
    bytes: Uint8Array;
    now: Date;
  },
): UploadResult {
  requireRole(db, organizationId, userId, "editor");
  const refuse = (issues: string[]): never => {
    throw new HTTPException(422, { message: issues.join("\n") });
  };
  let names: string[];
  try {
    names = Object.keys(unzipSync(bytes));
  } catch {
    return refuse([
      `${name}: not a zip file, so neither a cartridge nor a v1 export`,
    ]);
  }

  try {
    let result: UploadResult;
    if (names.includes("manifest.json")) {
      result = importCartridge(db, organizationId, name, bytes, now, refuse);
    } else if (names.some((n) => /^([^/]+\/)?camporee\.json$/.test(n))) {
      result = importV1Zip(db, organizationId, name, bytes, now);
    } else {
      return refuse([
        `${name}: no manifest.json (a cartridge) or camporee.json (a v1 export)`,
      ]);
    }
    audit(db, {
      at: now,
      userId,
      organizationId,
      action: "event.import",
      documentKind: "event",
      documentId: result.eventId,
      detail: {
        source: result.source,
        file: name,
        created: result.created,
        updated: result.updated,
      },
    });
    return result;
  } catch (error) {
    if (error instanceof ImportError || error instanceof V1ImportError) {
      return refuse(error.issues.map((i) => `${name}: ${i}`));
    }
    if (error instanceof CartridgeReadError) return refuse([error.message]);
    throw error;
  }
}

function importCartridge(
  db: Db,
  organizationId: string,
  name: string,
  bytes: Uint8Array,
  now: Date,
  refuse: (issues: string[]) => never,
): UploadResult {
  const files = unzipSync(bytes, { filter: (f) => f.name === "manifest.json" });
  let profile: unknown;
  try {
    profile = CartridgeManifestSchema.safeParse(
      JSON.parse(strFromU8(files["manifest.json"] ?? new Uint8Array())),
    ).data?.profile;
  } catch {
    profile = undefined;
  }
  if (profile === "event-day") {
    refuse([
      `${name}: this is an "event-day" cartridge, which goes to the box. Import the Event's design cartridge instead.`,
    ]);
  }
  const load = loadCartridge(bytes, { profile: "design" });
  if (!load.ok) return refuse(load.issues.map((i) => `${name}: ${i}`));
  const { eventId, created, updated } = importEvent(
    db,
    organizationId,
    load.raw,
    now,
  );
  return {
    eventId,
    title: load.bundle.event.title,
    source: "cartridge",
    created,
    updated,
    skipped: [],
    notes: load.notes,
    leftovers: [],
  };
}

function importV1Zip(
  db: Db,
  organizationId: string,
  name: string,
  bytes: Uint8Array,
  now: Date,
): UploadResult {
  const cartridge = readV1Zip(bytes, name);
  const result = importV1(cartridge, {}, { strict: false });
  const { eventId, created, updated } = importEvent(
    db,
    organizationId,
    {
      event: result.event,
      activities: result.activities,
      commonFieldSets: [result.commonFieldSet],
      ...(result.officials && { officials: result.officials }),
    },
    now,
  );
  return {
    eventId,
    title: result.event.title,
    source: "v1",
    created,
    updated,
    skipped: result.skipped.map(({ game, reason }) => ({ game, reason })),
    notes: result.notes,
    leftovers: leftoverActivities(
      db,
      organizationId,
      cartridge,
      v1ImportOptions(cartridge, {}),
    ),
  };
}
