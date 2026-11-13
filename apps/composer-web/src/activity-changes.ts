import type { Activity } from "@camporee-conductor/schema";
import type { ProposedChange } from "./pages/ProposalReview.tsx";

type Content = Activity["content"];

/** The content sections in the Activity page's order, with its labels. */
const SECTIONS: { key: keyof Content; label: string }[] = [
  { key: "story", label: "Background (story)" },
  { key: "objective", label: "The Objective" },
  { key: "description", label: "Instructions" },
  { key: "rules", label: "Rules & Constraints" },
  { key: "timeAndScoring", label: "Scoring Overview" },
  { key: "notes", label: "Notes & Background" },
  { key: "customSections", label: "Custom sections" },
  { key: "setup", label: "Setup Instructions" },
  { key: "reset", label: "Station Reset" },
  { key: "staffing", label: "Staffing" },
  { key: "supplies", label: "Supplies" },
];

function asText(key: keyof Content, value: Content[keyof Content]): string {
  if (value === undefined) return "";
  if (key === "rules")
    return (value as string[]).map((r) => `• ${r}`).join("\n");
  if (key === "supplies") {
    return (value as Content["supplies"])
      .map(
        (s) =>
          `• ${s.group ? `${s.group}: ` : ""}${s.item}${s.quantity ? ` (${s.quantity})` : ""}`,
      )
      .join("\n");
  }
  if (key === "customSections") {
    return (value as NonNullable<Content["customSections"]>)
      .map((s) => `${s.title}\n${s.body}`)
      .join("\n\n");
  }
  return String(value);
}

/**
 * What an Activity proposal changes, for the review (ADR-0030 item 3, #103 PR 3): the title, each content section,
 * and each field's label and placeholder, in the Activity page's reading order. Only what differs is listed.
 */
export function activityChanges(
  before: Activity,
  after: Activity,
): ProposedChange[] {
  const changes: ProposedChange[] = [];
  const add = (label: string, a: string, b: string) => {
    if (a !== b) changes.push({ label, before: a, after: b });
  };
  add("Title", before.title, after.title);
  for (const { key, label } of SECTIONS) {
    add(
      label,
      asText(key, before.content[key]),
      asText(key, after.content[key]),
    );
  }
  const afterById = new Map(after.scoring.fields.map((f) => [f.id, f]));
  for (const field of before.scoring.fields) {
    const next = afterById.get(field.id);
    if (!next) continue;
    add(`Field ${field.id}: label`, field.label, next.label);
    add(
      `Field ${field.id}: placeholder`,
      field.config?.placeholder ?? "",
      next.config?.placeholder ?? "",
    );
  }
  return changes;
}
