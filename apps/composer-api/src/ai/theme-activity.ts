import {
  ActivitySchema,
  type Activity,
  type Event,
} from "@camporee-conductor/schema";
import { z } from "zod";
import { proposalIssues } from "./allowed-changes.ts";
import { completeJson } from "./json.ts";
import { AiError, type AiProvider } from "./provider.ts";

/**
 * Theme one Activity (ADR-0030 notes, #103 PR 3; v1's `theme-game`). The AI answers only what it may change, and
 * `themedProposal` puts that onto the stored Activity, so ids, types, limits and the field list can't drift.
 */

/** The AI's answer: a title, the content sections, and a label and placeholder per field id. "" means none. */
export const ThemedActivitySchema = z.strictObject({
  title: z.string(),
  content: z.strictObject({
    story: z.string(),
    objective: z.string(),
    description: z.string(),
    rules: z.array(z.string()),
    timeAndScoring: z.string(),
    setup: z.string(),
    reset: z.string(),
    staffing: z.string(),
    notes: z.string(),
    supplies: z.array(
      z.strictObject({
        group: z.string(),
        item: z.string(),
        quantity: z.string(),
      }),
    ),
  }),
  fields: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      placeholder: z.string(),
    }),
  ),
});
export type ThemedActivity = z.infer<typeof ThemedActivitySchema>;

/** What the model is told: the Event's theme and Introduction (v1's "Camporee context"), never personal data. */
export function themeContext(event: Event): string {
  return [
    `Theme: ${event.theme?.trim() || "none"}`,
    `Introduction: ${event.introduction?.trim() || "none"}`,
  ].join("\n");
}

/** The Activity as the model sees it: the parts it may change, and each field's id and type for context. */
function activityForPrompt(activity: Activity) {
  return {
    title: activity.title,
    content: {
      story: activity.content.story,
      objective: activity.content.objective,
      description: activity.content.description,
      rules: activity.content.rules,
      timeAndScoring: activity.content.timeAndScoring,
      setup: activity.content.setup,
      reset: activity.content.reset,
      staffing: activity.content.staffing,
      notes: activity.content.notes,
      supplies: activity.content.supplies.map((s) => ({
        group: s.group ?? "",
        item: s.item,
        quantity: s.quantity ?? "",
      })),
    },
    fields: activity.scoring.fields.map((f) => ({
      id: f.id,
      type: f.type,
      label: f.label,
      placeholder: f.config?.placeholder ?? "",
    })),
  };
}

export async function themeActivity(
  ai: AiProvider,
  context: string,
  activity: Activity,
  instruction?: string,
): Promise<Activity> {
  const answer = await completeJson(
    ai,
    {
      system:
        "You are the creative lead for youth outdoor-skills competitions (ages 11 to 17), where teams rotate " +
        "through stations. You turn a plain skills activity into a themed adventure. Keep it G-rated, inspiring " +
        "and age-appropriate, and keep the skill, the rules' meaning and the scoring exactly as they are.",
      prompt:
        `The event:\n${context}\n\n` +
        `The activity, as JSON:\n${JSON.stringify(activityForPrompt(activity), null, 2)}\n\n` +
        "Rewrite it for the event's theme:\n" +
        "- a themed title;\n" +
        "- every content section in the theme's voice (Markdown is fine). Keep empty sections empty;\n" +
        "- supplies: keep each real item, adding a themed name in parentheses where it fits, e.g. " +
        '"Matches (Dragon Breath Sparks)";\n' +
        "- each scoring field: a themed label, and a placeholder (or an empty string). Keep every field id " +
        "exactly as given; never add or remove fields." +
        (instruction?.trim()
          ? `\n\nThe organizer also asks: "${instruction.trim()}"`
          : ""),
    },
    ThemedActivitySchema,
  );
  return themedProposal(activity, answer);
}

const blankToUndefined = (value: string) => value.trim() || undefined;

/**
 * The stored Activity with the AI's wording put on it. A field id the answer doesn't know is ignored; a blank label
 * or placeholder keeps the old one. The result must be a valid Activity that changes only what AI may (ADR-0030
 * item 4), or it's an AiError, never shown.
 */
export function themedProposal(
  activity: Activity,
  answer: ThemedActivity,
): Activity {
  const byId = new Map(answer.fields.map((f) => [f.id, f]));
  const proposal: Activity = {
    ...activity,
    title: answer.title.trim() || activity.title,
    content: {
      ...activity.content,
      ...answer.content,
      supplies: suppliesFrom(answer.content.supplies),
    },
    scoring: {
      ...activity.scoring,
      fields: activity.scoring.fields.map((field) => {
        const themed = byId.get(field.id);
        if (!themed) return field;
        const label = themed.label.trim() || field.label;
        const placeholder = themed.placeholder.trim();
        return {
          ...field,
          label,
          ...(placeholder && {
            config: { ...field.config, placeholder },
          }),
        };
      }),
    },
  };
  return checkedProposal(activity, proposal);
}

/** Supplies as the AI answers them ("" for no group or quantity), as the schema wants them (left out). */
export function suppliesFrom(
  supplies: { group: string; item: string; quantity: string }[],
): Activity["content"]["supplies"] {
  return supplies.map((s) => {
    const group = blankToUndefined(s.group);
    const quantity = blankToUndefined(s.quantity);
    return {
      ...(group && { group }),
      item: s.item,
      ...(quantity && { quantity }),
    };
  });
}

/**
 * `proposal`, if it's a valid Activity that changes only what AI may (ADR-0030 item 4); otherwise an AiError, so it's
 * never shown. Returned exactly as built: the schema's parse would add defaults (a field's weight) the stored
 * Activity may not spell out.
 */
export function checkedProposal(
  activity: Activity,
  proposal: Activity,
): Activity {
  const valid = ActivitySchema.safeParse(proposal);
  if (
    !valid.success ||
    proposalIssues("activity", activity, proposal).length > 0
  ) {
    throw new AiError("The AI's answer didn't fit the Activity. Try again.");
  }
  return proposal;
}
