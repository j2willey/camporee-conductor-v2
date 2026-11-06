import { createHash } from "node:crypto";
import { SCHEMA_VERSION, Slug, Uuid7 } from "@camporee-conductor/schema";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import {
  checkEventBundle,
  type CheckedBundle,
  type EventBundle,
} from "./bundle.ts";
import { unresolvedVariables } from "./v1/import-v1.ts";

// The cartridge (issue #8, ADR-0012, ADR-0015): one zip holding an Event's documents, laid out like the
// fixture folders, plus manifest.json. Profiles: "design" (the Event's design, for the Composer and
// Templates) and "event-day" (what the Collator loads: the design plus the Officials, ADR-0027 item 5).
//
//   manifest.json            format, versions, profile, Event, each file's sha256
//   event.json               the Event, exactly as stored (ADR-0012)
//   common-fields.json       its Common Field set
//   activities/<slug>.json   each Activity the Event lists
//   officials.json           event-day only
//   assets/<sha256>.<ext>    when documents reference assets (none until #7)

export const CARTRIDGE_FORMAT = "camporee-conductor-cartridge";
/** The zip layout and manifest. Bump when they change; documents carry their own schemaVersion. */
export const CARTRIDGE_FORMAT_VERSION = 1;

export const CartridgeProfileSchema = z.enum(["design", "event-day"]);
export type CartridgeProfile = z.infer<typeof CartridgeProfileSchema>;

export const CartridgeManifestSchema = z.strictObject({
  format: z.literal(CARTRIDGE_FORMAT),
  formatVersion: z.int().positive(),
  schemaVersion: z.string(),
  profile: CartridgeProfileSchema,
  event: z.strictObject({ id: Uuid7, slug: Slug, title: z.string() }),
  exportedAt: z.iso.datetime(),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
});
export type CartridgeManifest = z.infer<typeof CartridgeManifestSchema>;

/** The cartridge can't be exported; `issues` says why, one line each. */
export class CartridgeError extends Error {
  override name = "CartridgeError";
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`cartridge refused:\n${issues.join("\n")}`);
    this.issues = issues;
  }
}

const NEEDS_DIRECTOR =
  "officials: an event-day cartridge needs at least one Director, who signs in on the Collator (ADR-0027 item 5)";

const hasDirector = (bundle: CheckedBundle): boolean =>
  bundle.officials?.officials.some((o) => o.role === "director") ?? false;

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const documentFile = (doc: unknown): Uint8Array =>
  strToU8(`${JSON.stringify(doc, null, 2)}\n`);

/**
 * An Event's cartridge as zip bytes. Documents are written exactly as given (pretty-printed); the same
 * bundle and `exportedAt` always give the same bytes. A design cartridge never holds Officials; an
 * event-day cartridge must have a Director among them.
 */
export function exportCartridge(
  bundle: EventBundle,
  profile: CartridgeProfile,
  { exportedAt }: { exportedAt: Date },
): Uint8Array {
  const check = checkEventBundle(bundle);
  if (!check.ok) throw new CartridgeError(check.issues);
  const issues: string[] = [];
  if (bundle.commonFieldSets.length > 1) {
    issues.push(
      "common fields: more than one Common Field set isn't supported yet",
    );
  }
  if (profile === "event-day" && !hasDirector(check.bundle)) {
    issues.push(NEEDS_DIRECTOR);
  }
  if (issues.length > 0) throw new CartridgeError(issues);

  const { event, activities } = check.bundle;
  const contents: Record<string, Uint8Array> = {
    "event.json": documentFile(bundle.event),
  };
  const [set] = bundle.commonFieldSets;
  if (set !== undefined) contents["common-fields.json"] = documentFile(set);
  activities.forEach((activity, i) => {
    contents[`activities/${activity.slug}.json`] = documentFile(
      bundle.activities[i],
    );
  });
  if (profile === "event-day") {
    contents["officials.json"] = documentFile(bundle.officials);
  }

  const manifest: CartridgeManifest = {
    format: CARTRIDGE_FORMAT,
    formatVersion: CARTRIDGE_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    profile,
    event: { id: event.id, slug: event.slug, title: event.title },
    exportedAt: exportedAt.toISOString(),
    files: Object.keys(contents)
      .sort()
      .map((path) => ({
        path,
        sha256: sha256(contents[path] ?? new Uint8Array()),
      })),
  };
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const path of ["manifest.json", ...Object.keys(contents).sort()]) {
    const data =
      path === "manifest.json" ? documentFile(manifest) : contents[path];
    if (data) entries[path] = [data, { mtime: exportedAt }];
  }
  return zipSync(entries);
}

export type CartridgeLoad =
  | {
      ok: true;
      manifest: CartridgeManifest;
      /** Parsed by `packages/schema`: for reading. */
      bundle: CheckedBundle;
      /** The documents exactly as in the cartridge: for storing. */
      raw: EventBundle;
      /** Worth knowing, not wrong: e.g. a Common Field {{variable}} an Activity doesn't define. */
      notes: string[];
    }
  | { ok: false; issues: string[] };

/**
 * Reads and checks a cartridge: the contract the Collator loads by (issue #8, #40). Everything must hold,
 * or nothing loads: the manifest (format, versions, the expected profile), every file exactly as listed
 * (sha256; nothing missing, nothing extra), every document valid, and the same bundle rules as the
 * Composer's import. All problems are reported, one line each, naming the file.
 */
export function loadCartridge(
  bytes: Uint8Array,
  { profile }: { profile: CartridgeProfile },
): CartridgeLoad {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { ok: false, issues: ["not a zip file"] };
  }
  const fail = (issues: string[]): CartridgeLoad => ({ ok: false, issues });

  // 1. The manifest: what this is, and whether this reader understands it.
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) {
    return fail([
      "manifest.json: missing, so not a Camporee Conductor cartridge (a v1 cartridge? Import it in the Composer first)",
    ]);
  }
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(manifestBytes));
  } catch {
    return fail(["manifest.json: not valid JSON"]);
  }
  const parsed = CartridgeManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map(
        (i) =>
          `manifest: ${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`,
      ),
    );
  }
  const manifest = parsed.data;
  if (manifest.formatVersion !== CARTRIDGE_FORMAT_VERSION) {
    return fail([
      `manifest: formatVersion ${manifest.formatVersion} isn't supported; this Collator reads version ${CARTRIDGE_FORMAT_VERSION}`,
    ]);
  }
  const major = SCHEMA_VERSION.split(".")[0];
  if (manifest.schemaVersion.split(".")[0] !== major) {
    return fail([
      `manifest: schemaVersion ${manifest.schemaVersion} isn't supported; this Collator reads ${major}.x`,
    ]);
  }
  if (manifest.profile !== profile) {
    return fail([
      `manifest: this is a "${manifest.profile}" cartridge; the Collator needs the "${profile}" profile. Export the ${profile} cartridge from the Composer.`,
    ]);
  }

  // 2. Integrity: every file exactly as listed. A cartridge is all or nothing.
  const issues: string[] = [];
  const listed = new Map(manifest.files.map((f) => [f.path, f.sha256]));
  for (const [path, expected] of listed) {
    const data = files[path];
    if (!data) issues.push(`${path}: listed in the manifest but missing`);
    else if (sha256(data) !== expected) {
      issues.push(
        `${path}: doesn't match the manifest's sha256 (changed or damaged)`,
      );
    }
  }
  const present = Object.keys(files).filter(
    (n) => n !== "manifest.json" && !n.endsWith("/"),
  );
  for (const path of present.sort()) {
    if (!listed.has(path)) issues.push(`${path}: not listed in the manifest`);
  }
  if (profile === "design" && "officials.json" in files) {
    issues.push(
      "officials.json: Officials are never in a design cartridge (ADR-0027 item 5)",
    );
  }
  if (issues.length > 0) return fail(issues);

  // 3. The documents, by the same rules as the Composer's import.
  const json = (path: string): unknown => {
    const data = files[path];
    if (!data) return undefined;
    try {
      return JSON.parse(strFromU8(data));
    } catch {
      issues.push(`${path}: not valid JSON`);
      return undefined;
    }
  };
  const activityPaths = present
    .filter((p) => p.startsWith("activities/") && p.endsWith(".json"))
    .sort();
  const raw: EventBundle = {
    event: json("event.json"),
    commonFieldSets:
      "common-fields.json" in files ? [json("common-fields.json")] : [],
    activities: activityPaths.map(json),
    ...("officials.json" in files && { officials: json("officials.json") }),
  };
  if (issues.length > 0) return fail(issues);
  const check = checkEventBundle(raw);
  if (!check.ok) return fail(check.issues);
  const { bundle } = check;
  if (bundle.event.id !== manifest.event.id) {
    issues.push("manifest: event.id doesn't match event.json");
  }
  if (profile === "event-day" && !hasDirector(bundle)) {
    issues.push(NEEDS_DIRECTOR);
  }
  if (issues.length > 0) return fail(issues);

  const [set] = bundle.commonFieldSets;
  const notes = set
    ? unresolvedVariables(bundle.event, set, bundle.activities)
    : [];
  return { ok: true, manifest, bundle, raw, notes };
}
