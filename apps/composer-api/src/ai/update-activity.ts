import type { Activity } from "@camporee-conductor/schema";
import { z } from "zod";
import { completeJson } from "./json.ts";
import type { AiProvider } from "./provider.ts";
import { checkedProposal, suppliesFrom } from "./theme-activity.ts";

/**
 * AI update with a prompt (ADR-0030 notes, #103 PR 4; v1's `update-game`): free-text instructions for one Activity's
 * title and text. Scoring fields are left alone, as in v1.
 */

const keep = <T extends z.ZodType>(schema: T) => schema.nullable();

/** The AI's answer: each part, or null to leave it as it is (v1 left those keys out). */
export const UpdatedActivitySchema = z.strictObject({
  title: keep(z.string()),
  objective: keep(z.string()),
  story: keep(z.string()),
  description: keep(z.string()),
  rules: keep(z.array(z.string())),
  timeAndScoring: keep(z.string()),
  notes: keep(z.string()),
  staffing: keep(z.string()),
  setup: keep(z.string()),
  reset: keep(z.string()),
  supplies: keep(
    z.array(
      z.strictObject({
        group: z.string(),
        item: z.string(),
        quantity: z.string(),
      }),
    ),
  ),
});
export type UpdatedActivity = z.infer<typeof UpdatedActivitySchema>;

const TEXT_KEYS = [
  "objective",
  "story",
  "description",
  "timeAndScoring",
  "notes",
  "staffing",
  "setup",
  "reset",
] as const;

/** The Activity's title and text, as the model sees it when the editor sends the current text. */
function currentText(activity: Activity) {
  const { content } = activity;
  return {
    title: activity.title,
    objective: content.objective,
    story: content.story,
    description: content.description,
    rules: content.rules,
    timeAndScoring: content.timeAndScoring,
    notes: content.notes,
    staffing: content.staffing,
    setup: content.setup,
    reset: content.reset,
    supplies: content.supplies.map((s) => ({
      group: s.group ?? "",
      item: s.item,
      quantity: s.quantity ?? "",
    })),
  };
}

export async function updateActivity(
  ai: AiProvider,
  activity: Activity,
  instruction: string,
  includeContent: boolean,
): Promise<Activity> {
  const answer = await completeJson(
    ai,
    {
      system:
        "You are a game designer's assistant for youth outdoor-skills competitions (ages 11 to 17, G-rated), " +
        "where teams rotate through stations. You update one activity's text as the organizer asks. For each " +
        "part, give the new text, or null to leave it as it is. Markdown is fine in the text sections.",
      prompt:
        `The organizer asks: "${instruction.trim()}"` +
        (includeContent
          ? `\n\nThe activity's current text, as JSON:\n${JSON.stringify(currentText(activity), null, 2)}`
          : ""),
    },
    UpdatedActivitySchema,
  );
  return updatedProposal(activity, answer);
}

/** The stored Activity with each part the AI changed; null leaves it. Checked like a themed proposal. */
export function updatedProposal(
  activity: Activity,
  answer: UpdatedActivity,
): Activity {
  const content = { ...activity.content };
  for (const key of TEXT_KEYS) {
    const value = answer[key];
    if (value !== null) content[key] = value;
  }
  if (answer.rules !== null) content.rules = answer.rules;
  if (answer.supplies !== null)
    content.supplies = suppliesFrom(answer.supplies);
  return checkedProposal(activity, {
    ...activity,
    ...(answer.title !== null && { title: answer.title.trim() }),
    content,
  });
}
