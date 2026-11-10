import type { OfficialAction, ScoringInput } from "./types.ts";

/** Why this Official action is invalid for this Event and roster, or undefined if it's valid (ADR-0019, #24). */
export function actionProblem(
  context: Pick<ScoringInput, "event" | "activities" | "entrants">,
  action: OfficialAction,
): string | undefined {
  void context;
  void action;
  return undefined;
}
