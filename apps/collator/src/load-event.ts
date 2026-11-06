import {
  checkEventBundle,
  loadCartridge,
  type CartridgeManifest,
  type CheckedBundle,
  type EventBundle,
} from "@camporee-conductor/cartridge";
import { desc } from "drizzle-orm";
import type { Db } from "./db/open.ts";
import {
  cartridgeLoads,
  eventDocuments,
  groups,
  scoreEntries,
  teams,
  type EventDocumentKind,
} from "./db/schema.ts";

export type EventLoad =
  | {
      ok: true;
      event: CartridgeManifest["event"];
      /** Worth knowing, not wrong (from `loadCartridge`). */
      notes: string[];
    }
  | { ok: false; issues: string[] };

/**
 * Loads an event-day cartridge onto the box (issue #40, ADR-0015). Everything `loadCartridge` checks
 * must hold, or nothing changes. Loading the same Event again replaces its design and keeps the roster
 * and scores. A different Event is refused while the box holds any roster or scores: they'd be lost,
 * and resetting the box is an Official's action (#42).
 */
export function loadEventCartridge(db: Db, bytes: Uint8Array): EventLoad {
  const load = loadCartridge(bytes, { profile: "event-day" });
  if (!load.ok) return load;
  const { manifest, raw } = load;

  const current = currentLoad(db);
  if (current && current.eventId !== manifest.event.id && holdsEventData(db)) {
    return {
      ok: false,
      issues: [
        `cartridge: it's for a different Event (${manifest.event.slug}) than the one loaded, and the box ` +
          `holds roster or scores for that one. Resetting the box comes with the Officials' tools (#42).`,
      ],
    };
  }

  const docs: { id: string; kind: EventDocumentKind; doc: unknown }[] = [
    { id: manifest.event.id, kind: "event", doc: raw.event },
    ...load.bundle.commonFieldSets.map((set, i) => ({
      id: set.id,
      kind: "common-field-set" as const,
      doc: raw.commonFieldSets[i],
    })),
    ...load.bundle.activities.map((activity, i) => ({
      id: activity.id,
      kind: "activity" as const,
      doc: raw.activities[i],
    })),
    ...(load.bundle.officials
      ? [
          {
            id: load.bundle.officials.id,
            kind: "officials" as const,
            doc: raw.officials,
          },
        ]
      : []),
  ];

  db.transaction((tx) => {
    tx.delete(eventDocuments).run();
    for (const { id, kind, doc } of docs) {
      tx.insert(eventDocuments)
        .values({ id, kind, json: JSON.stringify(doc) })
        .run();
    }
    tx.insert(cartridgeLoads)
      .values({
        eventId: manifest.event.id,
        manifest: JSON.stringify(manifest),
        loadedAt: new Date(),
      })
      .run();
  });
  return { ok: true, event: manifest.event, notes: load.notes };
}

export interface LoadedEvent {
  manifest: CartridgeManifest;
  /** Parsed by `packages/schema`: for reading. */
  bundle: CheckedBundle;
}

/** The Event on the box, or undefined before any cartridge is loaded. */
export function loadedEvent(db: Db): LoadedEvent | undefined {
  const current = currentLoad(db);
  if (!current) return undefined;
  const raw: EventBundle = {
    event: undefined,
    activities: [],
    commonFieldSets: [],
  };
  for (const row of db.select().from(eventDocuments).all()) {
    const doc: unknown = JSON.parse(row.json);
    if (row.kind === "event") raw.event = doc;
    else if (row.kind === "activity") raw.activities.push(doc);
    else if (row.kind === "common-field-set") raw.commonFieldSets.push(doc);
    else raw.officials = doc;
  }
  // These documents passed the same check when the cartridge was loaded.
  const check = checkEventBundle(raw);
  if (!check.ok) {
    throw new Error(
      `the loaded Event no longer checks:\n${check.issues.join("\n")}`,
    );
  }
  return {
    manifest: JSON.parse(current.manifest) as CartridgeManifest,
    bundle: check.bundle,
  };
}

function currentLoad(db: Db) {
  return db
    .select()
    .from(cartridgeLoads)
    .orderBy(desc(cartridgeLoads.seq))
    .limit(1)
    .get();
}

function holdsEventData(db: Db): boolean {
  return [groups, teams, scoreEntries].some(
    (table) => db.select().from(table).limit(1).get() !== undefined,
  );
}
