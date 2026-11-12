import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  checkEventBundle,
  checkTemplateBundle,
  stripPersonalData,
  type EventBundle,
} from "./bundle.ts";
import {
  CartridgeError,
  exportCartridge,
  exportTemplateCartridge,
  loadCartridge,
  type CartridgeManifest,
  type CartridgeProfile,
} from "./cartridge.ts";

// The Circus 2026 design fixture plus an Officials list, as the Composer holds them.
const FIXTURE = new URL("../../schema/fixtures/circus-2026/", import.meta.url);
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));
const eventId = (read("event.json") as { id: string }).id;
const officials = (
  list: unknown[] = [
    { email: "director@example.com", name: "Pat Director", role: "director" },
    { email: "lead.judge@example.com", role: "official" },
  ],
) => ({
  schemaVersion: "4.0",
  kind: "officials",
  id: "0196cfa2-4c00-7000-8000-000000000200",
  slug: "coyote-creek-camporee-2026-officials",
  title: "Coyote Creek District Camporee 2026 Officials",
  eventId,
  officials: list,
});
const circus = (): EventBundle => ({
  event: read("event.json"),
  commonFieldSets: [read("common-fields.json")],
  activities: readdirSync(new URL("activities/", FIXTURE))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => read(`activities/${f}`)),
  officials: officials(),
});

const EXPORTED_AT = new Date("2027-05-10T18:00:00Z");
const exported = (profile: CartridgeProfile, bundle = circus()) =>
  exportCartridge(bundle, profile, { exportedAt: EXPORTED_AT });

const files = (zip: Uint8Array) => unzipSync(zip);
const manifestOf = (zip: Uint8Array): CartridgeManifest =>
  JSON.parse(strFromU8(files(zip)["manifest.json"] ?? new Uint8Array()));

/** The CartridgeError issues from `run`. */
const refusal = (run: () => unknown): string[] => {
  try {
    run();
  } catch (e) {
    if (e instanceof CartridgeError) return e.issues;
    throw e;
  }
  throw new Error("expected a refusal");
};
const loadIssues = (
  zip: Uint8Array,
  profile: CartridgeProfile = "event-day",
) => {
  const result = loadCartridge(zip, { profile });
  return result.ok ? [] : result.issues;
};

/** Re-zips `zip` after `edit` changes its files (to fake tampering or older/newer formats). */
const rezip = (
  zip: Uint8Array,
  edit: (files: Record<string, Uint8Array>) => void,
): Uint8Array => {
  const contents = files(zip);
  edit(contents);
  return zipSync(contents);
};
const editManifest = (
  zip: Uint8Array,
  change: (m: Record<string, unknown>) => void,
) =>
  rezip(zip, (f) => {
    const manifest = JSON.parse(
      strFromU8(f["manifest.json"] ?? new Uint8Array()),
    );
    change(manifest);
    f["manifest.json"] = strToU8(JSON.stringify(manifest));
  });

describe("exportCartridge: layout and manifest", () => {
  it("writes the Event, its Common Fields, its Activities and, event-day only, its Officials", () => {
    const names = Object.keys(files(exported("event-day"))).sort();
    expect(names.filter((n) => !n.startsWith("activities/"))).toEqual([
      "common-fields.json",
      "event.json",
      "manifest.json",
      "officials.json",
    ]);
    expect(names.filter((n) => n.startsWith("activities/"))).toHaveLength(33);
    expect(names).toContain("activities/3-ring-circus.json");
  });

  it("never puts Officials in a design cartridge (ADR-0027 item 5, ADR-0026)", () => {
    expect(Object.keys(files(exported("design")))).not.toContain(
      "officials.json",
    );
    expect(manifestOf(exported("design")).profile).toBe("design");
  });

  it("describes itself in manifest.json: format, versions, profile, Event, and each file's sha256", () => {
    const zip = exported("event-day");
    const manifest = manifestOf(zip);
    expect(manifest).toMatchObject({
      format: "camporee-conductor-cartridge",
      formatVersion: 1,
      schemaVersion: "4.0",
      profile: "event-day",
      event: {
        id: eventId,
        slug: "coyote-creek-camporee-2026",
        title: "Coyote Creek District Camporee 2026",
      },
      exportedAt: "2027-05-10T18:00:00.000Z",
    });
    const contents = files(zip);
    expect(manifest.files.map((f) => f.path)).toEqual(
      Object.keys(contents)
        .filter((n) => n !== "manifest.json")
        .sort(),
    );
    for (const { path, sha256 } of manifest.files) {
      expect(
        createHash("sha256")
          .update(contents[path] ?? new Uint8Array())
          .digest("hex"),
      ).toBe(sha256);
    }
  });

  it("writes each document exactly as given, pretty-printed (ADR-0012)", () => {
    const bundle = circus();
    const contents = files(exported("event-day", bundle));
    expect(strFromU8(contents["event.json"] ?? new Uint8Array())).toBe(
      `${JSON.stringify(bundle.event, null, 2)}\n`,
    );
  });

  it("gives the same bytes for the same design and export time", () => {
    expect(exported("event-day")).toEqual(exported("event-day"));
  });
});

describe("exportCartridge: refusals", () => {
  it("refuses an event-day cartridge without a Director: nobody could sign in on the box", () => {
    expect(
      refusal(() =>
        exported("event-day", {
          ...circus(),
          officials: officials([{ email: "a@example.com", role: "official" }]),
        }),
      ),
    ).toEqual([
      "officials: an event-day cartridge needs at least one Director, who signs in on the Collator (ADR-0027 item 5)",
    ]);
    const noOfficials = circus();
    delete noOfficials.officials;
    expect(refusal(() => exported("event-day", noOfficials))).toEqual([
      "officials: an event-day cartridge needs at least one Director, who signs in on the Collator (ADR-0027 item 5)",
    ]);
    expect(() => exported("design", noOfficials)).not.toThrow();
  });

  it("refuses an invalid bundle, with the bundle check's messages", () => {
    const bundle = circus();
    bundle.activities.shift();
    expect(refusal(() => exported("design", bundle))).toEqual([
      expect.stringMatching(
        /^event coyote-creek-camporee-2026: activities: no Activity .+ in the bundle$/,
      ),
    ]);
  });

  it("refuses more than one Common Field set: one per Event for now", () => {
    const bundle = circus();
    bundle.commonFieldSets = [
      ...bundle.commonFieldSets,
      {
        ...(bundle.commonFieldSets[0] as object),
        id: "0196cfa2-4c00-7000-8000-000000000300",
        slug: "other",
      },
    ];
    expect(refusal(() => exported("design", bundle))).toEqual([
      "common fields: more than one Common Field set isn't supported yet",
    ]);
  });
});

describe("loadCartridge: the Collator's checks on load", () => {
  it("round-trips: loading an export gives back the same documents, with no notes", () => {
    const bundle = circus();
    const result = loadCartridge(exported("event-day", bundle), {
      profile: "event-day",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.raw).toEqual(bundle);
    expect(result.bundle.activities).toHaveLength(33);
    expect(result.bundle.officials?.officials).toHaveLength(2);
    expect(result.manifest.profile).toBe("event-day");
    expect(result.notes).toEqual([]);
  });

  it("refuses a design cartridge on the Collator, saying what to export instead", () => {
    expect(loadIssues(exported("design"))).toEqual([
      'manifest: this is a "design" cartridge; the Collator needs the "event-day" profile. Export the event-day cartridge from the Composer.',
    ]);
  });

  it("refuses Officials in a design cartridge", () => {
    const smuggled = rezip(exported("design"), (f) => {
      f["officials.json"] = strToU8(JSON.stringify(officials()));
    });
    expect(loadIssues(smuggled, "design")).toEqual([
      "officials.json: not listed in the manifest",
      "officials.json: Officials are never in a design cartridge (ADR-0027 item 5)",
    ]);
  });

  it("refuses a changed, missing or extra file (a cartridge is all or nothing)", () => {
    const zip = exported("event-day");
    const changed = rezip(zip, (f) => {
      f["activities/jugglers.json"] = strToU8("{}");
    });
    expect(loadIssues(changed)).toEqual([
      "activities/jugglers.json: doesn't match the manifest's sha256 (changed or damaged)",
    ]);
    const missing = rezip(zip, (f) => {
      delete f["activities/jugglers.json"];
    });
    expect(loadIssues(missing)).toEqual([
      "activities/jugglers.json: listed in the manifest but missing",
    ]);
    const extra = rezip(zip, (f) => {
      f["notes.txt"] = strToU8("hello");
    });
    expect(loadIssues(extra)).toEqual([
      "notes.txt: not listed in the manifest",
    ]);
  });

  it("refuses a format or version it doesn't know", () => {
    const zip = exported("event-day");
    expect(
      loadIssues(editManifest(zip, (m) => (m["formatVersion"] = 2))),
    ).toEqual([
      "manifest: formatVersion 2 isn't supported; this Collator reads version 1",
    ]);
    expect(
      loadIssues(editManifest(zip, (m) => (m["schemaVersion"] = "5.0"))),
    ).toEqual([
      "manifest: schemaVersion 5.0 isn't supported; this Collator reads 4.x",
    ]);
    expect(
      loadIssues(editManifest(zip, (m) => (m["format"] = "something-else"))),
    ).toEqual([
      'manifest: format: Invalid input: expected "camporee-conductor-cartridge"',
    ]);
  });

  it("refuses a zip with no manifest, and bytes that aren't a zip", () => {
    const noManifest = rezip(exported("event-day"), (f) => {
      delete f["manifest.json"];
    });
    expect(loadIssues(noManifest)).toEqual([
      "manifest.json: missing, so not a Camporee Conductor cartridge (a v1 cartridge? Import it in the Composer first)",
    ]);
    expect(loadIssues(strToU8("not a zip"))).toEqual(["not a zip file"]);
  });

  it("refuses a manifest that names another Event than event.json", () => {
    const zip = editManifest(exported("event-day"), (m) => {
      (m["event"] as { id: string }).id =
        "0196cfa2-4c00-7000-8000-00000000ffff";
    });
    expect(loadIssues(zip)).toEqual([
      "manifest: event.id doesn't match event.json",
    ]);
  });
});

describe("disabled Activities (ADR-0029 item 9)", () => {
  /** Circus with `3-ring-circus` disabled, and its id. */
  const withDisabled = () => {
    const bundle = circus();
    const activity = bundle.activities.find(
      (a) => (a as { slug: string }).slug === "3-ring-circus",
    ) as { id: string };
    const event = bundle.event as {
      activities: { activityId: string; enabled?: boolean }[];
    };
    for (const entry of event.activities) {
      if (entry.activityId === activity.id) entry.enabled = false;
    }
    return { bundle, id: activity.id };
  };
  const eventJson = (zip: Uint8Array) =>
    JSON.parse(strFromU8(files(zip)["event.json"] ?? new Uint8Array())) as {
      activities: { activityId: string; enabled?: boolean }[];
    };

  it("leaves a disabled Activity out of the event-day cartridge: its file and its Event entry", () => {
    const { bundle, id } = withDisabled();
    const zip = exported("event-day", bundle);
    expect(Object.keys(files(zip))).not.toContain(
      "activities/3-ring-circus.json",
    );
    expect(
      Object.keys(files(zip)).filter((n) => n.startsWith("activities/")),
    ).toHaveLength(32);
    const entries = eventJson(zip).activities;
    expect(entries).toHaveLength(32);
    expect(entries.some((e) => e.activityId === id)).toBe(false);
    expect(loadIssues(zip)).toEqual([]);
  });

  it("keeps it in the design cartridge, marked disabled", () => {
    const { bundle, id } = withDisabled();
    const zip = exported("design", bundle);
    expect(Object.keys(files(zip))).toContain("activities/3-ring-circus.json");
    expect(
      eventJson(zip).activities.find((e) => e.activityId === id),
    ).toMatchObject({
      enabled: false,
    });
  });

  it("drops one on load too, if an event-day cartridge carries it (made by hand or by an older export), with a note", () => {
    const { bundle, id } = withDisabled();
    // Build an event-day cartridge that still holds the disabled Activity: the design layout plus Officials.
    const design = files(exported("design", bundle));
    design["officials.json"] = strToU8(
      `${JSON.stringify(bundle.officials, null, 2)}\n`,
    );
    const manifest = JSON.parse(
      strFromU8(design["manifest.json"] ?? new Uint8Array()),
    );
    manifest.profile = "event-day";
    manifest.files = Object.keys(design)
      .filter((p) => p !== "manifest.json")
      .sort()
      .map((path) => ({
        path,
        sha256: createHash("sha256")
          .update(design[path] ?? new Uint8Array())
          .digest("hex"),
      }));
    design["manifest.json"] = strToU8(JSON.stringify(manifest));
    const result = loadCartridge(zipSync(design), { profile: "event-day" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.activities.map((a) => a.id)).not.toContain(id);
    expect(
      result.bundle.event.activities.map((a) => a.activityId),
    ).not.toContain(id);
    expect(result.raw.activities).toHaveLength(32);
    expect(result.notes).toContain(
      "Left out 1 disabled Activity: 3-ring-circus.",
    );
  });
});

describe("personal data (ADR-0031 rule 4)", () => {
  const CONTACTS = [
    {
      role: "Camporee Director",
      name: "Pat Director",
      email: "pat@example.com",
      phone: "555-0100",
    },
  ];
  const withContacts = (): EventBundle => {
    const bundle = circus();
    bundle.event = { ...(bundle.event as object), contacts: CONTACTS };
    return bundle;
  };
  const eventIn = (zip: Uint8Array) =>
    JSON.parse(strFromU8(unzipSync(zip)["event.json"] ?? new Uint8Array())) as {
      contacts?: unknown;
    };

  it("keeps contacts in the Event's own design and event-day cartridges", () => {
    expect(eventIn(exported("design", withContacts())).contacts).toEqual(
      CONTACTS,
    );
    expect(eventIn(exported("event-day", withContacts())).contacts).toEqual(
      CONTACTS,
    );
  });

  it("stripPersonalData takes out the contacts and the Officials, and changes nothing else", () => {
    const bundle = withContacts();
    const before = structuredClone(bundle);
    const stripped = stripPersonalData(bundle);
    expect(stripped.event).not.toHaveProperty("contacts");
    expect(stripped).not.toHaveProperty("officials");
    expect(stripped.activities).toEqual(bundle.activities);
    expect(stripped.commonFieldSets).toEqual(bundle.commonFieldSets);
    expect({ ...(stripped.event as object), contacts: CONTACTS }).toEqual(
      bundle.event,
    );
    // The bundle given is left alone.
    expect(bundle).toEqual(before);
    // What's left is still a valid design.
    expect(checkEventBundle(stripped).ok).toBe(true);
  });

  it("leaves an Event with no contacts as it was", () => {
    const bundle = circus();
    expect(stripPersonalData(bundle).event).toEqual(bundle.event);
  });
});

describe("Templates (ADR-0031 item 7, #102 PR 4)", () => {
  /** Circus 2026 as a Template: Event-shaped, kind "template", no contacts and no Officials. */
  const template = (): EventBundle => {
    const { officials: _officials, ...bundle } = circus();
    const event = { ...(bundle.event as Record<string, unknown>) };
    delete event["contacts"];
    return { ...bundle, event: { ...event, kind: "template" } };
  };

  describe("checkTemplateBundle", () => {
    it("passes a Template with its Activities and Common Field set", () => {
      const check = checkTemplateBundle(template());
      expect(check.ok).toBe(true);
    });

    it("applies the Event bundle rules, naming the Template", () => {
      const bundle = template();
      bundle.activities = bundle.activities.slice(1);
      const check = checkTemplateBundle(bundle);
      expect(check.ok).toBe(false);
      expect(check.ok ? [] : check.issues).toEqual([
        expect.stringMatching(
          /^template coyote-creek-camporee-2026: activities: no Activity /,
        ),
      ]);
    });

    it("refuses an Event, contacts and Officials", () => {
      const asEvent = checkTemplateBundle(circus());
      expect(asEvent.ok ? [] : asEvent.issues).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/kind/),
          expect.stringMatching(/^officials: .*never in a Template/),
        ]),
      );
      const bundle = template();
      bundle.event = { ...(bundle.event as object), contacts: [] };
      const withContacts = checkTemplateBundle(bundle);
      expect(withContacts.ok).toBe(false);
    });

    it("isn't an Event bundle", () => {
      expect(checkEventBundle(template()).ok).toBe(false);
    });
  });

  describe("exportTemplateCartridge", () => {
    const zipOf = (bundle = template()) =>
      exportTemplateCartridge(bundle, { exportedAt: EXPORTED_AT });

    it("is a design cartridge of the Template, laid out like an Event's", () => {
      const zip = zipOf();
      const manifest = manifestOf(zip);
      const event = read("event.json") as {
        id: string;
        slug: string;
        title: string;
      };
      expect(manifest).toMatchObject({
        profile: "design",
        event: { id: event.id, slug: event.slug, title: event.title },
      });
      const names = Object.keys(files(zip));
      expect(names).toContain("event.json");
      expect(names).toContain("common-fields.json");
      expect(names).not.toContain("officials.json");
      expect(names.filter((n) => n.startsWith("activities/"))).toHaveLength(
        circus().activities.length,
      );
      const doc = JSON.parse(
        strFromU8(files(zip)["event.json"] ?? new Uint8Array()),
      ) as {
        kind: string;
      };
      expect(doc.kind).toBe("template");
      // Every file is listed with its sha256.
      for (const { path, sha256 } of manifest.files) {
        const bytes = files(zip)[path] ?? new Uint8Array();
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
      }
    });

    it("strips personal data first: contacts and Officials never reach the zip", () => {
      const bundle: EventBundle = {
        ...template(),
        officials: officials(),
      };
      bundle.event = {
        ...(bundle.event as object),
        contacts: [
          {
            role: "Director",
            name: "Pat",
            email: "pat@example.com",
            phone: "",
          },
        ],
      };
      const zip = zipOf(bundle);
      const all = Object.values(files(zip)).map(strFromU8).join("\n");
      expect(all).not.toContain("pat@example.com");
      expect(all).not.toContain("director@example.com");
      expect(Object.keys(files(zip))).not.toContain("officials.json");
    });

    it("refuses a bundle that isn't a valid Template", () => {
      const bundle = template();
      bundle.activities = [];
      expect(refusal(() => zipOf(bundle))).toEqual(
        expect.arrayContaining([expect.stringMatching(/^template /)]),
      );
    });
  });
});
