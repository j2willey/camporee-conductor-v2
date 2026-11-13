import type { Event } from "@camporee-conductor/schema";
import { z } from "zod";
import { completeJson } from "./json.ts";
import type { AiProvider } from "./provider.ts";

/**
 * Brainstorm (ADR-0030 notes, #103 PR 2): theme ideas, and v1's three Introduction options. Each takes an optional
 * "refine" instruction, as v1 did.
 */

export const ThemeIdeasSchema = z.strictObject({
  ideas: z.array(z.strictObject({ theme: z.string(), why: z.string() })),
});
export type ThemeIdeas = z.infer<typeof ThemeIdeasSchema>;

/** v1's three options (`brainstorm-theme`): action-oriented, lore-heavy, skill-focused. */
export const IntroductionOptionsSchema = z.strictObject({
  action: z.string(),
  lore: z.string(),
  skill: z.string(),
});
export type IntroductionOptions = z.infer<typeof IntroductionOptionsSchema>;

/**
 * What the model is told about the Event: its design only (ADR-0030 item 5). Title, year, theme, the pack's words
 * for its people, and its Competitions' and Activities' names. Never contacts, Officials, the organizer's name or
 * the venue.
 */
export function eventBrief(event: Event, activityTitles: string[]): string {
  const labels = event.terminology.labels ?? {};
  const words = Object.entries(labels)
    .filter(([, word]) => word)
    .map(([role, word]) => `${role}: ${word}`);
  return [
    `Event: ${event.title}${event.year ? ` (${event.year})` : ""}`,
    `Theme: ${event.theme?.trim() || "none yet"}`,
    `Kind of event: ${event.terminology.pack}${words.length > 0 ? ` (${words.join(", ")})` : ""}`,
    `Competitions: ${event.competitions.map((c) => c.label).join(", ") || "none yet"}`,
    `Activities: ${activityTitles.join(", ") || "none yet"}`,
  ].join("\n");
}

const refine = (instruction: string | undefined) =>
  instruction?.trim()
    ? `\n\nThe organizer also asks: "${instruction.trim()}"`
    : "";

export function suggestThemes(
  ai: AiProvider,
  brief: string,
  instruction?: string,
): Promise<ThemeIdeas> {
  return completeJson(
    ai,
    {
      system:
        "You are a creative event planner for youth outdoor-skills competitions, where teams rotate through " +
        "stations. Suggest themes: a short, catchy theme name, and one sentence on why it suits this event.",
      prompt: `${brief}\n\nSuggest five distinct themes for this event.${refine(instruction)}`,
    },
    ThemeIdeasSchema,
  );
}

export function writeIntroductions(
  ai: AiProvider,
  brief: string,
  instruction?: string,
): Promise<IntroductionOptions> {
  return completeJson(
    ai,
    {
      system:
        "You are a creative writer for youth outdoor-skills competitions, where teams rotate through stations. " +
        "You write the Introduction: the welcome text at the start of the event's program guide.",
      prompt:
        `${brief}\n\nWrite three distinct options for the Introduction, each 3 to 5 sentences:\n` +
        "- action: an action-oriented option that excites the participants;\n" +
        "- lore: a lore-heavy option that leans into the theme's storytelling;\n" +
        "- skill: a skill-focused option on the outdoor skills they'll use." +
        refine(instruction),
    },
    IntroductionOptionsSchema,
  );
}
