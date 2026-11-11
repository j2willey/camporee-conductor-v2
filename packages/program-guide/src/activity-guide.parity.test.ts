import { readdirSync, readFileSync } from "node:fs";
import {
  ActivitySchema,
  EventSchema,
  type Activity,
} from "@camporee-conductor/schema";
import { describe, expect, it } from "vitest";
import {
  buildActivityGuide,
  renderActivityGuidesHtml,
} from "./activity-guide.ts";

// ADR-0028 item 6: no printed 2026 guides survive, so every non-empty v1 content value of every Circus 2026
// game must appear, in the same part, in the v2 guide.
const FIXTURE = new URL("../../schema/fixtures/circus-2026/", import.meta.url);
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, FIXTURE), "utf8"));
const circus = EventSchema.parse(readJson("event.json"));
const activities = readdirSync(new URL("activities/", FIXTURE)).map((file) =>
  ActivitySchema.parse(readJson(`activities/${file}`)),
);

type V1Content = Record<string, unknown>;
const v1Content = (activity: Activity): V1Content =>
  (
    readJson(`v1-source/games/${activity.legacy?.v1Id}.json`) as {
      content: V1Content;
    }
  ).content;

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Rendered HTML as plain text: tags gone, the few entities decoded, whitespace collapsed. */
const htmlToText = (html: string): string =>
  squash(
    html
      .replace(/<(br|\/p|\/li|\/h[1-6]|\/td|\/th|\/caption|\/tr)\b[^>]*>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&"),
  );

/** A v1 Markdown value as the plain text a reader sees: markers and list bullets gone. */
const markdownToText = (markdown: string): string =>
  squash(
    markdown
      .split("\n")
      .map((line) =>
        line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\s+/, ""),
      )
      .join(" ")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, "$1"),
  );

const strings = (value: unknown): string[] =>
  typeof value === "string" && value.trim() !== ""
    ? [value]
    : Array.isArray(value)
      ? value.filter(
          (v): v is string => typeof v === "string" && v.trim() !== "",
        )
      : [];

const partTexts = (activity: Activity) => {
  const html = renderActivityGuidesHtml(circus, [
    buildActivityGuide(circus, activity),
  ]);
  const parts = Object.fromEntries(
    ["script", "playbook", "logistics"].map((kind) => {
      const match = new RegExp(
        `<section class="part part-${kind}">([\\s\\S]*?)</section>\\s*(?=<section class="part|<footer|</article)`,
      ).exec(html);
      if (!match) throw new Error(`no ${kind} part in ${activity.title}`);
      return [kind, htmlToText(match[1] ?? "")];
    }),
  );
  const heading = /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? "";
  return { ...parts, title: htmlToText(heading) } as Record<
    "script" | "playbook" | "logistics" | "title",
    string
  >;
};

/** Which part of the guide each v1 content key must land in. */
const WHERE: Record<string, "script" | "playbook" | "logistics" | "title"> = {
  title: "title",
  story: "script",
  challenge: "script",
  description: "script",
  rules: "script",
  time_and_scoring: "playbook",
  notes: "playbook",
  scoring_notes: "playbook",
  references: "playbook",
  instructions: "playbook",
  reset: "playbook",
  staffing: "logistics",
  setup: "logistics",
};

describe("Activity guides keep every v1 Game Guide value (ADR-0028 item 6)", () => {
  it("covers every Activity of the Circus 2026 design", () => {
    expect(activities.length).toBeGreaterThanOrEqual(30);
  });

  it.each(activities.map((a) => [a.title, a] as const))(
    "%s",
    (_title, activity) => {
      const content = v1Content(activity);
      const texts = partTexts(activity);
      const missing: string[] = [];
      for (const [key, part] of Object.entries(WHERE)) {
        for (const value of strings(content[key])) {
          const needle = markdownToText(value);
          if (!texts[part].includes(needle)) {
            missing.push(`${key} (in ${part}): ${needle.slice(0, 60)}`);
          }
        }
      }
      // Supplies are checked against the imported items; the import's own tests cover the text-to-items step.
      for (const supply of activity.content.supplies) {
        if (!texts.logistics.includes(supply.item)) {
          missing.push(`supply (in logistics): ${supply.item}`);
        }
      }
      expect(missing).toEqual([]);
    },
  );
});
