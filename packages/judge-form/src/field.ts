import type { ScoringField } from "@camporee-conductor/schema";

/**
 * One field as the form shows it: an Activity's own field or a Common Field, already merged (ADR-0020). The
 * Collator's `JudgeField` has this shape; the Composer's preview builds it from the design.
 */
export interface FormField {
  id: string;
  label: string;
  type: ScoringField["type"];
  required: boolean;
  config: NonNullable<ScoringField["config"]>;
}
