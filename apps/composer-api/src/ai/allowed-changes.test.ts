import { describe, expect, it } from "vitest";
import { readEventBundle } from "../import/read-event-bundle.ts";
import { CIRCUS_2026 } from "../test-support.ts";
import { proposalIssues } from "./allowed-changes.ts";

/**
 * What an AI proposal may change (ADR-0030 item 4, amended 2026-11-12): a structural diff against the current
 * document. One test for each allowed and each refused path, on real Circus 2026 documents.
 */

type Json = Record<string, unknown>;
const bundle = readEventBundle(CIRCUS_2026);
const EVENT = bundle.event as Json;
const ACTIVITY = (bundle.activities as Json[]).find((a) =>
  ((a["scoring"] as { fields: Json[] }).fields ?? []).some(
    (f) => (f["config"] as Json | undefined)?.["placeholder"] !== undefined,
  ),
) as Json;

/** A copy of `doc` with `path` (dot-separated; numbers index arrays) set to `value`, or removed for `undefined`. */
function changed(doc: Json, path: string, value: unknown): Json {
  const copy = structuredClone(doc);
  const keys = path.split(".");
  let at: Record<string, unknown> = copy;
  for (const key of keys.slice(0, -1)) {
    at[key] ??= {};
    at = at[key] as Record<string, unknown>;
  }
  const last = keys.at(-1) ?? "";
  if (value === undefined) Reflect.deleteProperty(at, last);
  else at[last] = value;
  return copy;
}

const fields = (doc: Json) => (doc["scoring"] as { fields: Json[] }).fields;
const withPlaceholder = fields(ACTIVITY).findIndex(
  (f) => (f["config"] as Json | undefined)?.["placeholder"] !== undefined,
);
const withoutConfig = fields(ACTIVITY).findIndex(
  (f) => f["config"] === undefined,
);

describe("an Event proposal", () => {
  it("is unchanged: no issues", () => {
    expect(proposalIssues("event", EVENT, structuredClone(EVENT))).toEqual([]);
  });

  it.each([
    ["title", "Big Top Camporee"],
    ["theme", "Under the Big Top"],
    ["introduction", "Welcome to the Big Top!"],
  ])("may change %s", (path, value) => {
    expect(proposalIssues("event", EVENT, changed(EVENT, path, value))).toEqual(
      [],
    );
  });

  it("may add or remove the theme and the introduction", () => {
    const bare = changed(
      changed(EVENT, "theme", undefined),
      "introduction",
      undefined,
    );
    expect(proposalIssues("event", bare, EVENT)).toEqual([]);
    expect(proposalIssues("event", EVENT, bare)).toEqual([]);
  });

  it.each([
    ["id", "0196cfa2-4c00-7000-8000-00000000beef"],
    ["slug", "other"],
    ["kind", "template"],
    ["schemaVersion", 99],
    ["year", 2099],
    ["startDate", "2099-01-01"],
    ["endDate", "2099-01-02"],
    ["organizerName", "Someone Else"],
    ["venue", { name: "Elsewhere" }],
    ["contacts", [{ role: "Director", name: "Pat" }]],
    ["terminology.pack", "other"],
    ["presentation.themeColors.main", "#000000"],
    ["competitions.0.label", "Renamed"],
    ["competitions.0.commonFields", undefined],
    ["activities", []],
    ["activities.0.sortOrder", 99],
    ["awards", []],
    ["tieNumbering", "strict"],
    ["programGuide", { skills: ["Knots"] }],
    ["lineage", { parentId: "0196cfa2-4c00-7000-8000-00000000beef" }],
    ["legacy", undefined],
  ])("refuses a change to %s", (path, value) => {
    const issues = proposalIssues("event", EVENT, changed(EVENT, path, value));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toContain(path.split(".")[0]);
  });
});

describe("an Activity proposal", () => {
  it("is unchanged: no issues", () => {
    expect(
      proposalIssues("activity", ACTIVITY, structuredClone(ACTIVITY)),
    ).toEqual([]);
  });

  it("may change its title", () => {
    expect(
      proposalIssues(
        "activity",
        ACTIVITY,
        changed(ACTIVITY, "title", "Lion Tamer"),
      ),
    ).toEqual([]);
  });

  it.each(Object.keys(ACTIVITY["content"] as Json))(
    "may change content.%s",
    (key) => {
      const value = (ACTIVITY["content"] as Json)[key];
      const other = Array.isArray(value)
        ? []
        : typeof value === "string"
          ? `${value} (themed)`
          : value;
      expect(
        proposalIssues(
          "activity",
          ACTIVITY,
          changed(ACTIVITY, `content.${key}`, other),
        ),
      ).toEqual([]);
    },
  );

  it("may add a custom section", () => {
    expect(
      proposalIssues(
        "activity",
        ACTIVITY,
        changed(ACTIVITY, "content.customSections", [
          { title: "Ringmaster's Notes", body: "Crack the whip." },
        ]),
      ),
    ).toEqual([]);
  });

  it("may reword a field's label", () => {
    expect(
      proposalIssues(
        "activity",
        ACTIVITY,
        changed(ACTIVITY, "scoring.fields.0.label", "Big Top Points"),
      ),
    ).toEqual([]);
  });

  it("may reword, add or remove a field's placeholder", () => {
    const at = `scoring.fields.${withPlaceholder}.config.placeholder`;
    expect(
      proposalIssues(
        "activity",
        ACTIVITY,
        changed(ACTIVITY, at, "0-5 peanuts"),
      ),
    ).toEqual([]);
    expect(
      proposalIssues("activity", ACTIVITY, changed(ACTIVITY, at, undefined)),
    ).toEqual([]);
    if (withoutConfig >= 0) {
      expect(
        proposalIssues(
          "activity",
          ACTIVITY,
          changed(ACTIVITY, `scoring.fields.${withoutConfig}.config`, {
            placeholder: "Seconds on the high wire",
          }),
        ),
      ).toEqual([]);
    }
  });

  it.each([
    ["id", "0196cfa2-4c00-7000-8000-00000000beef"],
    ["slug", "other"],
    ["kind", "event"],
    ["schemaVersion", 99],
    ["scoringType", "exhibition"],
    ["tags", ["#other"]],
    ["variables", { ten_essentials: "x" }],
    ["lineage", { parentId: "0196cfa2-4c00-7000-8000-00000000beef" }],
    ["legacy", { v1Id: "x" }],
    ["scoring.fields.0.id", "renamed_field"],
    ["scoring.fields.0.type", "text"],
    ["scoring.fields.0.kind", "not-the-same-kind"],
    ["scoring.fields.0.audience", "official"],
    ["scoring.fields.0.sortOrder", 999],
    ["scoring.fields.0.weight", 7],
    ["scoring.fields.0.required", true],
    ["scoring.fields.0.primary", { direction: "sideways" }],
    ["scoring.fields.0.config.min", -5],
    ["scoring.fields.0.config.max", 500],
    ["scoring.fields.0.config.defaultValue", 3],
    ["scoring.fields.0.config.options", ["a", "b"]],
    ["scoring.fields.0.legacy", { v1Weight: 9 }],
  ])("refuses a change to %s", (path, value) => {
    const issues = proposalIssues(
      "activity",
      ACTIVITY,
      changed(ACTIVITY, path, value),
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("\n")).toContain(path.split(".").slice(0, 2).join("."));
  });

  it("refuses adding, removing or reordering fields", () => {
    const list = fields(ACTIVITY);
    expect(list.length).toBeGreaterThan(1);
    const extra = { ...list[0], id: "extra_field", sortOrder: 999 };
    for (const proposed of [
      [...list, extra],
      list.slice(1),
      [...list].reverse(),
    ]) {
      expect(
        proposalIssues(
          "activity",
          ACTIVITY,
          changed(ACTIVITY, "scoring.fields", proposed),
        ).length,
      ).toBeGreaterThan(0);
    }
  });

  it("names each refused path once, and says why", () => {
    const issues = proposalIssues(
      "activity",
      ACTIVITY,
      changed(changed(ACTIVITY, "slug", "x"), "scoringType", "exhibition"),
    );
    expect(issues).toEqual([
      "scoringType: an AI proposal can't change this",
      "slug: an AI proposal can't change this",
    ]);
  });
});
